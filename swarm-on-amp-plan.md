# Agent Swarm on Amp — Plan (v11, simplified)

Status: v11. v7 was a from-scratch rewrite after v6 was judged overbuilt; v8 and v9 apply Oracle reviews of v7 and v8 (v9 approved); v10 replaces the reviewer mode with the built-in `oracle` tool; v11 adds the single-runner execution variant (§10a, S5). v6 is kept at `swarm-on-amp-plan.v6-archive.md` for reference only.

## 1. What Cursor's swarm actually is

From [self-driving codebases](https://cursor.com/blog/self-driving-codebases) and [agent swarm model economics](https://cursor.com/blog/agent-swarm-model-economics):

- Two roles. Planners (frontier model) decompose and delegate; they never code. Workers (cheap model) execute one task each; they never plan.
- A tree. A planner may spawn sub-planners for a slice it fully delegates, or workers for tasks. Recursive.
- One message up. A worker works in its own repo copy and, when done, writes a single handoff that the system delivers to the planner that spawned it as a follow-up message. Workers never talk to other planners or workers. No global synchronization, no cross-talk.
- Planners are "not aware of whether tasks are being picked up or by whom." They keep receiving handoffs, pull the latest repo, and keep planning.
- Prompting handles split-brain, ossification, freshness, and scope. Infrastructure handles the rest: a VCS, a neutral merge agent on conflicts, compile-checked decision references with a reconciler, megafile commit blocking, stacked review lenses, a Field Guide folder, accepted error rate with a final green pass.
- They removed the judge, the separate planner, and the integrator because each was a bottleneck or made agents misbehave. Design learnings: anti-fragile (individual agents fail; others recover), empirical, throughput over per-commit correctness.

Design rule for this plan: if Cursor solved it with a prompt, we solve it with a prompt. Add mechanism only where Amp lacks a primitive Cursor's harness had. Where Cursor had infrastructure we are not building in v1 (decision-reference compiler, reconciler, megafile blocking, stacked lenses), §10 says so explicitly.

## 2. Amp mapping

| Cursor | Amp |
|---|---|
| Planner / worker roles with different models | Modes from one workspace plugin: `createAgent({ model, tools: { include: [...], exclude: ['code_exec', 'tool_search'] } })` + `registerAgentMode` |
| Spawn child in own repo copy | Plugin tool `spawn` → `agent.createThread({ parentThreadID: ctx.thread.id, executor: 'orb' })`; one orb per child |
| Handoff delivered to requesting planner as a follow-up message | Plugin tool `handoff` → `amp.threads.get(await ctx.thread.parentThreadID()).appendUserMessage(report)` |
| Custom VCS | Git. One integration branch `swarm/<run>` per run. Workers rebase and push to it themselves. Unmergeable work is parked on `swarm-wip/<run>/<thread>`. |
| Neutral merge agent | A worker spawned with a merge prompt when a worker reports a conflict it could not resolve. No standing service. |
| Design docs with compile-checked refs + reconciler | `docs/decisions/*.md` written by planners and published with `publish_docs`; prompt rule that code comments cite the decision file. No compiler check, no reconciler in v1. |
| Megafile flag → block + decomposer | Worker reports files > 800 lines in its handoff; planner spawns a decomposition worker. No commit blocking. |
| Stacked review lenses | Two lenses, both the built-in `oracle` tool (read-only, in-thread, frontier model). Lens 1: the worker asks the oracle to review its diff before handing off. Lens 2: the planner may ask the oracle to review a handoff's commits with no worker context. No reviewer threads. |
| Field Guide | `docs/field-guide/index.md`, pulled into every agent via `@docs/field-guide/index.md` in `AGENTS.md`. Line budget by prompt. |
| Accepted error rate + final green pass | Root spawns a "make the branch green" worker at the end. Promotion is a PR opened by the human (Phases 1–2) or by a root-only `open_pr()` tool (Phase 3). |
| Freshness | Amp's built-in compaction; planners rewrite `docs/plans/<thread>.md` each pass rather than appending |
| "Planner unaware of pickup" | Adaptation: planners get `children()` so they can replace dead or overdue children. Amp has no harness-side task queue to do it for them. |

## 3. Architecture

```
human ──spec──▶ ┌─────────────────────────────┐
                │ root planner (swarm-planner) │  frontier model, no shell, edits docs/ only
                └──┬──────────┬───────────┬───┘
            spawn  │          │           │ spawn(swarm-planner, slice)
                   ▼          ▼           ▼
             ┌────────┐ ┌────────┐ ┌─────────────┐
             │ worker │ │ worker │ │ sub-planner │──▶ workers …
             └───┬────┘ └───┬────┘ └──────┬──────┘
                 │ git push swarm/<run>   │ handoff ──▶ root
                 │ handoff ──▶ root
                 ▼
          swarm/<run> integration branch   (final: green-pass worker → human or open_pr() → human merge)
```

Each thread is one orb with its own checkout. Workers push to `swarm/<run>` with `git pull --rebase && git push`; work they cannot land is preserved on `swarm-wip/<run>/<own-thread-id>` and reported in the handoff (rules in §7). Planners never push code; they publish `docs/**` through a plugin tool.

## 4. Roles

| Mode | Model | `tools.include` | Prompt in one line |
|---|---|---|---|
| `swarm-planner` | frontier (e.g. Opus 5.5 / GPT‑6 Sol) | read-only built-ins (`Read`, `Grep`, `Glob`, `finder`), `oracle`, `edit_file`, `create_file`, `spawn`, `children`, `publish_docs`, `handoff`, `open_pr` (Phase 3) | Own your scope. Decide designs yourself; write them to `docs/decisions/` and publish before spawning dependents. Delegate 5–30 tasks per pass. Never write code. Ignore duplicate handoffs. Replace overdue children. |
| `swarm-worker` | cheap (e.g. GPT‑6 Luna / GLM 5.3 Flash) | read-only built-ins, `oracle`, `edit_file`, `create_file`, `apply_patch`, `shell_command`, `handoff` | Do exactly the task. Rebase and push to `swarm/<run>`. Before handing off, ask the oracle to review your diff against the task and decisions; fix material findings. End by calling `handoff` once. No TODOs, no partial implementations. |

Both modes set `exclude: ['code_exec', 'tool_search']`; the docs say those two are granted even with an explicit include list unless excluded. Exact built-in tool names come from `amp plugins show-agent-options --json` (spike S0). Nothing else exists for the mode: no `create_thread`, `send_thread_message`, `wait_for_threads`, `get_thread_status`, `Task`, `ask_user_choice`, `set_schedule`, or other plugins' tools.

Root vs. non-root is not a separate mode. Every planner handler calls `await ctx.thread.parentThreadID()`: `null` means root. `handoff` refuses on the root ("you report to the human in your final message"); `open_pr` refuses on non-root. The run id is the root thread id. Children learn their context from the first line of their spawn message:

```
[swarm run=<root-id> parent=<parent-id> role=<mode> depth=<n> deadlineMin=<m> branch=swarm/<run>]
```

The plugin writes this line; the model never composes it. `session.start` on a child parses it into `~/.swarm/<run>/<thread>/self.json`. `session.start` on a root (planner mode, `parentThreadID()` null) first creates `swarm/<run>` on the remote from the checkout's HEAD if the remote ref is absent. On every swarm thread it then ensures the branch non-destructively: if a rebase or merge is in progress, do nothing; if local `swarm/<run>` does not exist, `git fetch origin && git checkout --track origin/swarm/<run>`; if it exists, `git checkout swarm/<run>` (no `-B`, no reset) and `git branch --set-upstream-to origin/swarm/<run>`. `session.start` also fires when an existing thread is reopened, so it must never discard an unpushed commit or an in-progress docs conflict.

## 5. Plugin tools (four, plus one in Phase 3)

- `spawn({ role, title, instructions, deadlineMin? })` — planner only. `role` is `swarm-planner` or `swarm-worker`. Creates the child thread with `parentThreadID = ctx.thread.id`, labels it `swarm:<run>`, appends the bootstrap line (depth = own depth + 1; default deadline 90 min for workers, 240 for sub-planners) followed by `instructions`, returns the child id. Appends `{id, role, title, spawnedAt, deadlineMin}` to `~/.swarm/<run>/<thread>/children.json` (state is keyed by run and thread so the runner variant, §10a, can share one HOME). Calls are serialized by an in-process async mutex so the caps in §6 are checked and updated atomically. `replaces: <old-child-id>` marks the old entry `replacedBy` (see below).
- `children()` — planner only. First tries `git pull --rebase --autostash origin swarm/<run>` so the planner sees the latest code and decisions; if a rebase is already in progress or the pull conflicts, it leaves the tree as is and reports `refresh: blocked (<files>)`, and still returns child status so recovery is never disabled by a docs conflict. Then returns each `children.json` entry with: live `state.get()` (`idle | running | awaiting-approval | error`), `handoffReceived` (true if this thread's own transcript, read via `ctx.thread.messages({ full: true })`, contains a message starting `[handoff from <child-id>`), `overdue` (now > spawnedAt + deadlineMin and no handoff), and `replacedBy` if the planner has replaced it. Planners call this at the start of every turn.
- `publish_docs()` — planner only. Restricted to `docs/**`. Steps: if a rebase is in progress, `git add docs/` and `git rebase --continue`; else `git add docs/` and commit only if something is staged; then `git pull --rebase origin swarm/<run>`; then `git push origin HEAD:swarm/<run>`. A rebase conflict is left in place (markers in the files) and the tool returns the conflicting paths; the planner edits them with `edit_file` and calls `publish_docs()` again, which continues the rebase. Files that still contain conflict markers are reported again rather than committed. A failed push after a successful commit is retried by calling the tool again (the pending commit is pushed; no new commit is needed). Planners must call it before spawning anything that depends on a decision they just wrote.
- `handoff({ report })` — worker, non-root planner. Appends `[handoff from <id> (<role>): <title>]\n<report>` to the parent thread as a user message. Target comes from `ctx.thread.parentThreadID()`; there is no `to` parameter. Returns an error if the append fails, so the model retries.
- `open_pr({ title, body })` — root only, Phase 3. Runs `gh pr create --base <default> --head swarm/<run>` from the plugin process, never from a model-controlled shell.

Replacing a child is a planner decision recorded by passing `replaces: <old-child-id>` to `spawn`; the old entry gets `replacedBy` and stops counting as live. There is no cancel: an orphaned old child may still push and hand off later; the planner ignores or absorbs that like any duplicate.

That is the whole control plane. No ops branch, no outbox, no job queue, no attempt records.

## 6. Invariants and how each is enforced

| # | Invariant | Enforcement |
|---|---|---|
| 1 | Only planners spawn, and only the two swarm modes | `spawn` is in the planner include list only; `role` is an enum. No mode has `create_thread`/`Task`. |
| 2 | Every non-root swarm thread has exactly one parent; the threads form a tree rooted at the human-created planner | `spawn` always sets `parentThreadID = ctx.thread.id`; children cannot change it. |
| 3 | A child communicates upward only with its parent, and only by handoff | `handoff` resolves its target from `parentThreadID()`; no addressed-message tool exists in any include list. (A sub-planner's downward spawn instructions are not cross-talk.) |
| 4 | A planner communicates only with its own children (by spawning them with instructions) and its parent (by handoff) | No steering or addressed-message tool in v1. Planners replace children instead of steering them. |
| 5 | Planners never write code; workers never touch control-plane files or decisions | `tool.call` hook on `edit_file`, `create_file`, `apply_patch`, and on `shell_command` via `amp.helpers.filesModifiedByToolCall` where it can see the paths: planner writes allowed only under `docs/**`; worker writes rejected under `.amp/**`, `.agents/**`, `AGENTS.md`, `docs/decisions/**`. `reject-and-continue` with a one-line reason. Shell writes the helper cannot see (`cat >`, `python -c`) are prompt policy; best effort by design. |
| 6 | Shell cannot escape the swarm: no Amp CLI, no `gh`, no push except to `swarm/<run>` or `swarm-wip/<run>/<own-thread-id>` | `tool.call` hook on `shell_command` using `amp.helpers.shellCommandFromToolCall`: reject commands matching `\bamp\b`, `\bgh\b`, or `git push` whose refspec is not one of the two allowed refs. Regex, not a sandbox (§10). |
| 7 | Only the root talks to the human; nothing can wait on or query arbitrary threads | `ask_user_choice`, `get_thread_status`, `wait_for_threads`, `send_thread_message` excluded from all modes. Root reports via its final message and the PR. |
| 8 | Fan-out, depth, and spawn count are bounded | `spawn` checks this thread's `children.json` under the mutex: live (not handed off, not replaced) children ≤ 8; total spawns by this planner ≤ 60; `depth` from the bootstrap line ≤ 3. Live-cap exceeded → error "wait for handoffs or replace an overdue child." Total or depth cap exceeded → error "cap reached: report remaining scope as blocked in your handoff" (the planner must not wait; see §7). These caps do not bound tokens per thread. |

Depth/width/count/deadlines are the only numbers; everything else is prompt.

## 7. Failure handling (deliberately simple)

| Failure | What happens | Who recovers |
|---|---|---|
| Worker turn ends without a successful `handoff` | `agent.end` hook on worker threads only: scan the turn's messages with `amp.helpers.toolCallsInMessages`; if no `handoff` call whose result status is `done`, return `continue` once with "Call `handoff` now." If still none, the hook itself appends `[handoff from <id>] ended without a report; last message: …` to the parent. Sub-planners are exempt: their turns end while they wait for their own children, so a forced handoff would mark them resolved and hide dead grandchildren. Their terminal handoff is required by prompt and backstopped by the deadline rule below. | Plugin hook |
| Child errors, orb dies, or sub-planner goes idle with its own dead children | Parent's `children()` shows `error`, or `overdue` with no handoff (an idle sub-planner that never reported is simply overdue). Prompt rule: replace any overdue, unresolved direct child regardless of its state, with `spawn({ replaces })`. Redoing that slice is acceptable. | Parent |
| Parent is idle/paused and nothing wakes it | Handoffs wake it (`appendUserMessage` resumes a paused orb; hard gate S2). For children that die without sending, the human sets one schedule on the root thread (every 30 min, `[swarm-tick] call children() and act on overdue or errored ones`). Each parent down the tree is woken by its own children's handoffs or by its own parent replacing it when it is overdue. | Schedule on root + replacement chain |
| Duplicate or late handoff (including from a replaced child) | Prompt rule: handoffs may repeat or arrive from a child you already replaced; a repeat for a task you already acted on is a no-op, and a late report from a replaced child is informational. | Planner prompt |
| Push conflict | Two cases. Contention (rebase succeeds, push rejected because someone else landed first): retry `pull --rebase && push` up to 3×; if still rejected, push the current tip to the wip ref and hand off as below (no abort, since no rebase is active). Content conflict (rebase stops on a conflicting commit): `git rebase --abort` to restore the full worker tip, then `git push origin HEAD:swarm-wip/<run>/<own-id>`; only after that push succeeds does the handoff say "conflict: my work is on swarm-wip/<run>/<id> at <sha>, base <base-sha>"; if the wip push also fails, the handoff says preservation failed and the parent re-spawns the task. Parent spawns a worker: "You are a neutral merger. Rebase `swarm-wip/<run>/<id>` onto `swarm/<run>`, preserve both intents, push to `swarm/<run>`." | Parent |
| Megafile / broken build left by another worker | Worker reports it in its handoff and stays in scope. Accepted error rate: the branch may be red between passes. | Parent spawns a fix/decompose task; root runs a green pass at the end |
| Split-brain / contradictory designs | Prompt: planners decide, record in `docs/decisions/`, publish, never delegate a design question, never let two subtrees own the same question. When a planner finds contradictory decisions it edits the docs itself, publishes, then delegates the code changes. Workers read `docs/decisions/index.md` before coding. | Planner prompt |
| Cap exhausted | `spawn` errors with "cap reached." Prompt: do not wait; hand off (or, for the root, report) with the unmet scope listed as blocked. | Prompt |
| Root claims done early or late | Prompt: "Done means the human's original goal, as you decomposed it, is met: every required outcome has a successful handoff (replacements count; failed or blocked outcomes are listed as unmet), the green-pass worker reports green, and you have named the branch (Phases 1–2) or `open_pr` returned a URL (Phase 3). If an outcome cannot be met within caps, stop and report it as unmet rather than continuing." The tick re-prompts a root that went idle with running or overdue children. | Prompt + tick |

Nothing here is exactly-once. Recovery is always "replace the child"; §10 states what that may redo.

## 8. Git

- `swarm/<run>` is created by the root's `session.start` from the root checkout's HEAD if the remote ref is absent; root and children check it out with upstream `origin/swarm/<run>` in `session.start`, never resetting an existing local branch (§4).
- Workers commit small and often; push with `git pull --rebase && git push origin HEAD:swarm/<run>`. Unmergeable work goes to `swarm-wip/<run>/<thread>`.
- Planners' only git operations are inside `children()` (pull) and `publish_docs()` (commit docs, push).
- The orb's git identity must not be able to push the default branch (branch protection on the host). This is the one host-side setting we rely on.
- Promotion: `gh` is denied in every shell, so in Phases 1–2 the root's final message names the branch and the human opens the PR. Phase 3 adds root-only `open_pr()`.

## 9. Prompts (where the real design lives)

Written as constraints with numeric ranges, per Cursor's lessons. Each ≤ 60 lines. Drafts in `.amp/plugins/swarm/prompts/`:

- Planner: ownership; "decide designs yourself"; 5–30 tasks per pass with exact deliverables; when to spawn a sub-planner (slice needs > 10 tasks or its own design decisions); publish before spawning dependents; handoff handling and duplicates; replace overdue children; rewrite `docs/plans/<thread>.md` each pass; completion definition from §7; Field Guide curation rules (root only, index ≤ 150 lines).
- Worker: scope discipline; no TODOs/partials; read `docs/decisions/index.md` first; commit/push protocol and the wip fallback; what to put in the handoff (done, deviations, concerns, files > 800 lines, broken things found); licensed breakage ("if you must change a shared interface, do it, leave a `// SWARM-BREAK: <why>` comment, and say so in the handoff").
- Review (inside the worker and planner prompts, not a role): the worker's oracle call reviews the diff against the task and `docs/decisions/`; material findings within the worker's scope are fixed before handoff and remaining ones are listed in the handoff. If the oracle call fails, or a material finding can only be resolved by changing a planner-owned decision, the worker hands off explicitly as blocked, naming the review failure or the unresolved finding and where its work is (pushed commits or wip ref); review success is never a prerequisite for reporting failure, and the planner does not count a blocked handoff as completion. The `agent.end` backstop checks for a handoff, not for an oracle call. The planner calls the oracle on a handoff's commits when the task touched a shared interface or the handoff reports deviations; its brief is the diff and decisions only, not the worker's reasoning, so the two lenses are partly decorrelated.

## 10. Known limits (accepted for v1)

- Enforcement is against ordinary misuse, not an adversarial model. The shell denylist is a regex, the edit guard sees only what `filesModifiedByToolCall` parses, and orb git credentials can push any `swarm/*` or `swarm-wip/*` ref.
- Not built from Cursor's infrastructure: compile-checked decision references, the decision reconciler, megafile commit blocking, review by independent threads on a different model family. Each is replaced by a prompt rule or an in-thread oracle call and may be added later. The worker's oracle lens shares the worker's context, so it is weaker than Cursor's decorrelated lenses; the planner's oracle call is the partial substitute.
- Orb spawn pacing (20 burst, then 1 per 5 min) caps fan-out; `spawn` reports the wait rather than failing. The runner variant in §10a removes this limit.
- A planner whose orb dies loses `children.json`; its parent sees it overdue and re-spawns the slice, which may redo finished work. Acceptable ("withstand individual agents failing").
- Replacement does not cancel the old child; it may finish and push anyway. Duplicated work is tolerated.
- The human must create the root tick schedule (plugins cannot create schedules).

## 10a. Execution substrate: one orb per thread vs. one big runner

Cursor ran each swarm on one large VM. That was not only to avoid distributed systems; it made most coordination problems disappear: spawning is a process fork, handoffs are local IPC, liveness is the process table, a child can be killed, build caches and git objects are shared on one disk, and the git remote is a local bare repo with no network or host rate limits. What it cost them: disk I/O saturation from parallel compiles, cargo/git lock contention, RAM caps, and one blast radius; they named "give each agent its own machine" as the trivial fix.

Amp can do either. The plan above is written for orbs; the runner variant keeps the same modes, tools, hooks, prompts, and invariants and changes only where threads execute and how their checkouts are laid out.

| | Orb per thread (default) | One runner on a big machine |
|---|---|---|
| `spawn` | `createThread({ executor: 'orb' })` | `createThread({ executor: { type: 'runner', id } })`, or `'local'` when the plugin itself runs on that runner |
| Spawn latency / cap | orb boot; 20 burst then 1 per 5 min | process start; limited by machine RAM and the plugin's own caps |
| Checkout | one clone per orb, cold caches | one clone; `session.start` creates `git worktree add ../wt/<thread> -b swarm-local/<run>/<thread> origin/swarm/<run>` per thread (a distinct local branch per thread, since git refuses to check out the same branch in two worktrees and `--force` would make workers share a moving branch ref); reopen reuses the existing worktree and branch untouched, as in §4; pushes stay explicit `HEAD:swarm/<run>`; shared `target/`, `node_modules`, package caches |
| Git remote | hosted remote; host rate limits apply | local bare repo as `origin`; `open_pr()` first pushes `swarm/<run>` to the hosted remote (configured explicitly as a second remote), then runs `gh pr create --repo <owner/repo>`; `gh` does not upload the branch itself |
| Wake-up | `appendUserMessage` resumes a paused orb (S2) | thread is a process on a live runner; no pause/resume |
| Liveness / cancel | `state.get()` only; no cancel, replace instead | same API; still no cancel in the plugin API, but a dead process is visible immediately |
| Isolation | sandbox per agent; a runaway worker hurts only itself | one blast radius; a worker's `rm -rf` or fork bomb takes the run down; the shell guard matters more |
| Cost | pay per orb; idle orbs pause | one machine billed continuously; cheaper when agents are mostly busy |
| Suited to | small runs (≤ 20 workers), untrusted specs, no ops | Cursor-scale runs (50–500 workers), compile-heavy repos, when throughput matters |

Open problems with the runner variant, all plugin-side:

- The plugin `createThread` API has `executor` but no working-directory or worktree option, so every thread on the runner starts in the runner's directory. `session.start` creates the worktree, and the `tool.call` guard rewrites or rejects edits and shell commands outside `../wt/<own-thread>`. Whether tools honor a per-thread cwd set that way is S5.
- Plugin state is per thread, not per machine. On a runner all threads share one HOME, which is why §4/§5 key state as `~/.swarm/<run>/<thread>/…` on both substrates. Two planners on one runner would otherwise share a child registry, which breaks caps and overdue decisions.
- Plugin-owned git operations never rely on the process cwd, which on a runner is the original checkout. Two kinds, with explicit `-C` paths: bootstrap operations run against the seed checkout (absolute path recorded in plugin configuration): creating the remote `swarm/<run>` from the seed HEAD if absent, fetching it, and `git worktree add` for the root and for each child. Thread-owned operations (`children()` pull, `publish_docs()`) run with `-C <absolute path of the calling thread's worktree>` once it exists. Reopen never recreates or resets an existing worktree or branch.

Choose per run, not per plan: orbs for Phase 1–2 demos and the first real run; the runner variant becomes the default for Phase 3's multi-hour run if S5 passes.

## 11. Spikes before coding (each ≤ half a day)

| ID | Question | Stop if |
|---|---|---|
| S0 | Built-in tool names from `amp plugins show-agent-options --json`, including whether `oracle` is includable; a mode with an explicit include list plus the two excludes sees exactly those tools and no `code_exec`, `tool_search`, or other plugins' tools; an oracle call works from a worker in an orb | tools leak, or `oracle` cannot be included or cannot run from a worker in an orb (hard gate; no fallback) |
| S1 | From a plugin tool running in an orb, `createThread({ parentThreadID, executor: 'orb' })` with a custom mode works and the child's `parentThreadID()` matches | orb‑to‑orb creation fails |
| S2 | `appendUserMessage` to a paused orb thread resumes it and runs a turn; to a running thread it queues | paused threads do not wake. Hard gate: the recursive design depends on it. |
| S3 | `tool.call` fires for `edit_file`, `create_file`, `apply_patch`, `shell_command` in orb threads and `reject-and-continue` works; `agent.end` `continue` works; `ctx.thread.messages({ full: true })` paginates a long parent transcript within the tool budget | hooks do not fire for built-in edit tools (stop; a plugin-owned editor is not worth it). If only `shell_command` lacks the hook, replace it with a plugin `sh` tool applying the same denylist. |
| S4 | Two orbs push to `swarm/<run>` concurrently with `pull --rebase`; one lands, the other rebases and lands. Then an induced content conflict: the loser aborts the rebase and pushes to `swarm-wip/<run>/<id>`; a third checkout fetches that ref and sees every worker commit including the conflicting one | the wip ref is missing commits |
| S5 (runner variant) | On one runner: a plugin tool creates a child with `executor: { type: 'runner', id }` in a custom mode; `session.start` adds a worktree and per-thread local branch per child; the child's `shell_command` and edit tools operate in that worktree (or the `tool.call` guard can confine them to it); two children push concurrently to a local bare `origin`; an induced content conflict goes through abort → wip push with every commit present; reopening a thread mid-rebase and with an unpushed commit preserves both; two planners on the same runner with different children and independent docs edits keep separate registries and `publish_docs` from each lands in its own worktree, including a reopen during a docs conflict; a fresh run on a runner with neither the integration ref nor the root worktree in place bootstraps both from the seed checkout; 20 children spawn in under a minute | per-thread cwd or per-thread plugin state cannot be established; then the runner variant waits on a plugin API working-directory option and orbs remain the only substrate |

## 12. Phases

1. **Skeleton (1 week).** Plugin with two modes, `spawn`/`children`/`publish_docs`/`handoff`, the two `tool.call` guards, the `agent.end` handoff backstop, prompts v1. Demo: root planner given a 3-task spec writes one decision doc, publishes it, spawns 3 workers in orbs; each pushes to `swarm/<run>` and hands off; root receives 3 handoffs and reports. Negative checks: a worker calling `spawn` gets "tool not found"; a worker's `gh pr create` and `git push origin main` are rejected; a worker killed mid-task shows `overdue` in `children()` and the root replaces it after the tick; a root with a dead grandchild under an idle sub-planner replaces the sub-planner after its deadline; a sub-planner that yields with children still running sends no handoff, is not marked resolved, and later either hands off after their reports or is replaced at its deadline; `publish_docs` on a root whose docs conflict with a pushed decision returns the file, the root edits it, and the second call lands it; a worker whose oracle call errors, and one whose oracle finding needs a decision change, each send a blocked handoff rather than retrying indefinitely; re-firing `session.start` on a thread with an unpushed local commit leaves it publishable, and re-firing it mid docs-conflict leaves the conflict for `publish_docs` to continue.
2. **Depth and conflict (1 week).** Sub-planners, wip branches and merge-worker prompt, Field Guide, megafile reporting. Demo: a spec that forces two workers onto one file; conflict parked on wip and resolved by a merger worker; a sub-planner slice completes and hands off.
3. **Review and promotion (1 week).** Oracle review prompts for worker and planner, green-pass worker, `open_pr()`. Demo: a 2–4 hour run on a scaled-down "SQLite subset from docs" spec, ending in a PR; on the runner variant if S5 passed, otherwise on orbs with the spawn cap noted in the report.
4. **Economics.** Same spec with two worker models; measure token and dollar split per role.

## 13. Open questions for the owner

1. Target repo for the first real run.
2. Default caps: 8 live children per planner, 60 spawns per planner, depth 3, deadlines 90/240 min — adjust?
3. Is a dedicated large runner (one machine, continuous billing) available for the Phase 3 run, or should Phase 3 stay on orbs?
