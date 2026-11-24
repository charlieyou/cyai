# Coordinator schedule prompt template

The schedule prompt is the effort's settings and the coordinator's memory. Fill in each section, and delete a section only when it does not apply. Write each decision as an instruction, with its date, time and source, such as "(user, 2026-11-24 15:07 UTC)". Keep the protocol steps short; the skill has the reasoning.

```markdown
Check that the active <effort> worker threads are making real progress, and nudge or correct them if not. Load the coordinating-worker-threads skill.

Base branch: <main, or the branch this effort lands on>.

Tracker: <artifact URL, or "none">.

Threads:
- <role>: <thread ID> (<worktree path, or orb>, branch <branch>, model <model and effort>). Scope: <what it does>. May change: <paths>. Must not change: <paths>. Closing scope (user, <date time>): <when it stops and what happens then>.
- <role>: closed on <date> after <last commit> landed. Don't check it.

Rented machines: <none, or the user's request with its date, provider, poller log, job script, where logs go, and "this request covers one machine only">.

For each active thread:
1. Call get_thread_status. Check its branch (<git -C <worktree> log --oneline origin/main..HEAD and status --short, or git ls-remote origin <branch>>). Check lock holders with `lslocks` on <lock paths>. <Provider list commands.> Call read_thread with context "current" only when something looks off.
2. Decide: real progress (no message); looping or stalled (one concrete next step from its own plan); invented results (correct it with the real tool output); breaking a rule (stop and undo); reported commit (verify and land); errored (tell the user, restart on <model> with a self-contained prompt, update this list; <archive the old thread: yes or no, per the user>); closing scope met (land what cleared the bar, tell dependent threads, remove it here, tell the user).

Rules for workers (user, <date>): <never push main, scope only, locks, report only tool output, never git stash, no weakened tests or tolerances, any rules on how the code should be changed>.

How workers check their work (user, <date>): <tests, linters, reviews, measurements, and how much of each>.

Acceptance bar (user, <date>): <what a change must show to land, and what to reject even when nothing got worse>.

Landing: verify the report against the thread's logs and diff. Rebase onto origin/main in <landing worktree> and run <gate command> <under flock <lock>>, with a monitor on its log. <Extra suites and when to skip them.> <Mechanical repairs the coordinator may make, with the condition.> Known flaky tests: <names and the user's rerun rule>. Check `git merge-base --is-ancestor origin/main HEAD` right before pushing. Pushing (user, <date>): <push each landing / push batches of ... / ask first>. Push, subscribe CI, tell the thread the SHA. One gate at a time in <landing worktree>; queue: <queued commits>.

Other threads that land on main: <thread ID, which paths each side holds, what to tell it and when>.

Then give a short update: one line per thread saying progressing, nudged, corrected, landed or closed. Don't repeat a full report when nothing changed.
```
