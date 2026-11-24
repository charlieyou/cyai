---
name: coordinating-worker-threads
description: "Runs a swarm of long-running Amp worker threads from a coordinator thread and lands their work: splitting the task into scoped workers, a recurring check-in that reads each worker's status, branch and locks and decides whether to nudge, correct, stop, land or restart it, checking workers' claims against their own logs and diffs, rebasing, gating and pushing their commits, carrying the user's rules to them, and running shared infrastructure. Use for any multi-thread effort that runs for hours or days, such as a refactor, migration, feature set, bug sweep or optimization campaign, and when asked to coordinate, supervise, monitor, nudge or babysit worker threads, land their branches, or set up a coordinator schedule. Not for a one-off fan-out of subagents that return a single report."
---

# Coordinating worker threads

A coordinator thread runs a swarm: several worker threads that each work for hours or days on one scoped part of a larger task, in their own git worktree or orb, while the coordinator is the only thread that lands their work. The coordinator owns four things: the user's rules, a recurring check-in, verification and landing, and any shared infrastructure. Workers own their part: they edit, check their own work, commit on their branch, and report a commit SHA with evidence. Workers never push to the shared branch.

The coordinator's own context is compacted many times over a long run, so everything it must remember lives in the schedule prompt (see "Durable state"). Read the schedule prompt at the start of every check-in and treat it as the current protocol.

## Project settings

Everything specific to one effort goes in the schedule prompt, not in this skill: the base branch the work lands on (this skill writes it as `main` and `origin/main`; use the effort's own branch everywhere instead), thread IDs, worktrees or orbs and branches, each worker's scope, held paths, lock files, the landing worktree, the gate command, the acceptance bar, known flaky tests, and closing scopes. When you take over an effort that already has a coordinator schedule, its prompt is the settings. `reference/schedule-prompt.md` is the template for a new one.

## Splitting the work

Give each worker a scope that does not overlap another's: a list of paths it may change, plus paths it must not touch (shared manifests and lockfiles, generated files, paths another worker or coordinator holds). Workers that edit the same files produce conflicts the coordinator has to resolve by hand, so split by path, and sequence work that cannot be split. Size the swarm to the hardware: count CPU and memory per worker against what the host or orb provider has.

If another coordinator also lands on the same branch, agree in writing on which paths each side holds, and record it in the schedule prompt. Tell the other coordinator when a hold is released, and send it every landed SHA it depends on.

## Durable state

The schedule prompt is the coordinator's memory. Each scheduled run reads it as instructions, and after compaction it is the only reliable record.

- Write every user decision into it the same turn, with the UTC date and time and "user" as the source, such as "Closing scope (user, 2026-11-24 15:07 UTC): ...". Write the decision as an instruction to your future self, including what to do when the condition it waits for happens.
- Update it when a thread is restarted (new ID and why), a path changes, a rule is added, or a thread closes. Remove what no longer applies, such as closed threads, so the check-in does not keep acting on them.
- After every `update_schedule`, call `get_schedule` and read the saved prompt back. A malformed update once replaced the whole prompt with a JSON fragment.
- With many short-lived workers, keep the roster in a tracker artifact (one table per wave: worker, thread link, branch, scope, status), but keep rules and user decisions in the schedule prompt.

## Starting a worker

Create each worker with `create_thread` on the model and effort the user named, on the runner or orb provider that has the hardware it needs. Write the model into the schedule prompt; restarts use the same model.
- A worker on a runner (a shared machine) gets its own worktree and branch (`git fetch origin && git worktree add -b <branch> <path> origin/main`) and never touches the main checkout. The coordinator reads the branch from that worktree.
- A worker in an orb has its own checkout. It works on its own branch cut from `origin/main`, such as `<effort>/<wave>-<scope>`, and pushes that branch (never `main`) after every commit, because the coordinator cannot see the orb's disk and a restarted worker starts from what was pushed.

When the work has stages that depend on each other, run it in waves: start the next wave's workers when the paths they need are free and the earlier wave has landed.

The first prompt is self-contained, because a restarted worker must not need its predecessor's history. It states:
- the goal, the worker's scope (paths it may and may not change), and the order of work;
- how it checks its own work: which tests, linters, reviews or measurements, and on which machine;
- the rules: "commit logical commits on your branch; never push to main", for runner workers "never `git stash`" (worktrees share one stash list), "do the work yourself; do not create threads", the locks it must hold, the acceptance bar, and "Report only what a tool actually returned. A subagent's or monitor's result exists only after a message naming it arrives. Never write text that imitates tool, monitor, subagent or user output.";
- the report: `send_thread_message` to the coordinator's thread ID with the commit SHA, the files changed, every check it ran with the decisive output lines (including runs a rerun replaced), the log paths, judgment calls it made, and what it starts on next, then continue without waiting.

A restart prompt adds the current state (commits, running jobs with PIDs and logs, the plan) and, when the restart followed a violation, a short "why this is a new thread" section naming it.

## The check-in

Create one recurring schedule on the coordinator thread (every 15 to 30 minutes) whose prompt holds the full protocol. Load `building-schedules` first. On each run, for each active worker:

1. Call `get_thread_status`. Run `git -C <worktree> log --oneline origin/main..HEAD` and `git -C <worktree> status --short`, or `git ls-remote origin <branch>` for an orb worker. Check who holds each shared lock with `lslocks`. Check any rented machines in every provider's list. Call `read_thread` with context "current" only when something looks off, and ask it a specific question, such as "Did a completion message for subagent X arrive before the claim at message N? Quote it."
2. Decide one of these:
   - Real progress (new edits, commits, check results): send nothing.
   - Looping, stalled, or idle with work left (re-reading the same files, rerunning the same command, polling a lock, auditing without editing): send one concrete next step taken from its own plan.
   - Invented results or false beliefs about its environment (output no tool printed, claims that its tools are disabled): quote the real tool output and tell it to report only what tools return. A third fabrication means restart it.
   - Breaking a rule (out-of-scope edits, pushing, weakening tests): tell it to stop and undo the specific action.
   - Reported a commit you have not landed: verify and land it (below).
   - Errored or gone (context length exceeded, executor error, retries exhausted): tell the user, restart it with a self-contained prompt on the same worktree or branch, and update the thread ID in the schedule prompt. Archive the old thread only if the user approved archiving in the schedule prompt; otherwise leave it and name it in your update.
   - Finished its closing scope: land what cleared the bar, tell the threads that depended on it, remove it from the schedule prompt, and tell the user. When no workers remain, ask the user whether to clear the schedule.
3. End with one line per thread (progressing, nudged, corrected, landed, closed). Do not repeat a full report when nothing changed.

## Verifying a report

A worker's report is a claim. Before acting on it:
- Read the evidence yourself: the test summary lines in its logs, the reviewer's actual result, the numbers its own tools printed. Workers have reported a review as approved before it returned, stated a number the log did not contain, and left out the run a rerun replaced.
- Fetch the branch and check that its head is the SHA the worker reported; workers have force-pushed a different commit after reporting.
- Read the diff: `git diff --name-only origin/main...<sha>` must stay inside the worker's scope and touch no forbidden path. Then read the change itself and check that it does what the task asked rather than what the metric rewards. Workers driven by a linter or a counter have added pass-through re-exports, renaming getters and one-implementation traits that silenced the check while making the code worse.
- Check the rules: no tolerance loosened, no test or coverage dropped, no check disabled.
- When the evidence is a measurement, also check that it measured the committed code (a clean worktree, and a binary or artifact newer than the sources or rebuilt from the commit and compared) and that the baseline is sound (same settings, not stale, no outliers).
- Say in your summary which claims you checked yourself and which come only from the worker.

## Messages to workers

Each message says, in this order: what you verified and from which log, the correction if any, the next step, and whether a reply is expected ("No reply needed until you have a commit ready."). Name exact SHAs and paths. Quote the user's rule from the schedule prompt instead of paraphrasing it. When you are landing a worker's commit, tell it not to amend or rebase that commit until you send the landed SHA, and then to rebase its branch onto it.

## Landing

Read `reference/landing.md` before the first landing in a session. In short: one gate at a time per landing worktree; rebase the reported commit onto `origin/main` there; run the gate with its output in a log and a monitor on that log; read the real check summaries; immediately before pushing, check that `origin/main` is an ancestor of HEAD; push; subscribe to CI for the SHA; tell every affected thread the SHA. Land in batches when the user or another coordinator asks for fewer pushes. Commits that need extra evidence before they land (such as a benchmark on a shared machine) can wait together on a staging branch: keep it rebased on `origin/main`, gate it once when the evidence is in, and push it as one batch. Later waves may start on paths those staged commits do not touch. After a worker's branch lands, mark it landed in the tracker. Delete its remote branch only once the worker has finished and the branch holds no commit that has not landed. A worker that rebases its pushed branch onto the landed SHA may force-push its own branch with `--force-with-lease`.

## Waiting

Wait for gates, test runs and other long jobs with `monitor_start` on the job's log, then end the turn; the monitor message resumes you.
- Empty the job's log before starting it (and before it waits for any lock), and read the log from its first line (`tail -n +1 -F <log>`), so a line written before the monitor started is still seen.
- Filter for the job's done marker and failure lines, and include every way the job can exit.
- Set `timeout_ms` to about twice the job's expected time, including any time it waits for a lock.
- Do not wait with `sleep` loops or repeated `shell_command_status`. Stop the monitor with `monitor_stop` when the job is done.

Write job scripts so that their last line is a unique done marker and each step prints its exit code.

## Shared resources

- When workers share a machine, any job whose timing or resources matter (benchmarks, large test suites, GPU jobs, a shared test database) needs a lock that every such job takes, including the coordinator's gates. Put each lock path and who must hold it in the schedule prompt. If a job holds a lock much longer than its peers, ask the thread why.
- When the user asks for a rented machine, the coordinator alone creates, uses and deletes it. Read `reference/cloud-machines.md` first.

## Gotchas

These each happened at least once:
- A worker fabricated a reviewer's approval, a monitor line and a subagent result. The claimed result had no matching completion message in the transcript.
- A coordinator deleted a rented machine twice while jobs on it were still running, losing the run.
- A restart used a different model from the one the schedule named.
- A landing gate left out a lint step that another coordinator relied on, so two landings left `main` failing it.
- A wrapper script ignored exit codes, so "passed" came from the wrapper and not the tests.
- The landing worktree disappeared between check-ins. Run `git worktree list` when a path fails, and update the path in the schedule prompt.
- The coordinator passed workers a workaround for a tool bug, and the user rejected shaping the repository around the bug; fix the tool instead.
