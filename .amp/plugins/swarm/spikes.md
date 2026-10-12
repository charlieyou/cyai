# Phase 0 spike results

Run 2026-10-12 on Amp CLI `0.0.1791831898`, from a root orb thread on the `cyai` project. Probe
plugin: a scratch `spike` directory plugin with two custom modes (`spike-worker` on
`openai/gpt-6-luna`, `spike-planner` on `anthropic/claude-sonnet-5-5`) and tools `spike_probe`,
`spike_spawn`, `spike_append`, `spike_state`, `spike_messages`. Child orbs ran in a scratch
Amp-hosted project `swarm-demo` that carries the same plugin in `.amp/plugins/spike/`.

| ID | Verdict | One line |
|---|---|---|
| S0 | pass, with caveats | Include list + two excludes gives exactly those tools; `oracle` is includable and works from a worker in an orb. |
| S1 | **partial: recursion blocked by Amp, worked around** | Orb-to-orb creation from a plugin tool works and `parentThreadID()` matches, but Amp removes from each child the plugin tool that created it; a second identical tool restores depth (owner-approved workaround). |
| S2 | pass | Append wakes a paused orb thread and runs a turn; appends to a running thread queue and each gets its own turn. |
| S3 | pass, with caveats | `tool.call` fires and `reject-and-continue` works for all four tools; `agent.end` `continue` works; `messages({ full: true })` is broken. |
| S4 | pass | Contention resolves by rebase; content conflict → abort → wip push keeps every commit, visible from a third checkout. |
| S5 | not run | Optional. |

## S0 — tool names and isolation

- `amp plugins show-agent-options --json` → `builtinToolNames`: `apply_patch, ask_user_choice,
  create_file, create_thread, edit_file, find_thread, finder, get_thread_status, librarian,
  list_agent_modes, oracle, painter, Read, read_mcp_resource, read_thread, read_web_page,
  send_thread_message, shell_command, shell_command_kill, shell_command_status, skill, Task,
  view_media, wait_for_threads, web_search`.
- **Plan error:** there is no `Grep` or `Glob` built-in. Read-only built-ins are `Read` and `finder`.
- A worker with `include: [Read, oracle, edit_file, create_file, apply_patch, shell_command,
  spike_probe, spike_messages]`, `exclude: [code_exec, tool_search]` listed exactly those tools.
  No `code_exec`, `tool_search`, `create_thread`, other plugins' tools (`monitor_*`), or the
  plugin's own tools outside the list (`spike_spawn` was absent from the worker). The planner
  mode likewise listed exactly its include list.
- Caveat: on an OpenAI model the provider-native pseudo-tools `image_gen.imagegen` and
  `multi_tool_use.parallel` also appear. They are not Amp tools and cannot reach threads,
  shell, or git, so they do not break any invariant.
- `oracle` from the worker in its orb returned `PONG` for "Reply with the single word PONG."
- Note: this environment presents tool names to the model with a random prefix
  (`mcp__<x>__<word>_spawn`); transcripts record the bare name. One planner refused to call a
  tool it was told to call by its bare name. Prompts should name tools plainly and say the
  name may appear prefixed.

## S1 — orb-to-orb creation

- From a plugin tool in an orb, `agent.createThread({ parentThreadID: ctx.thread.id, executor: 'orb' })`
  returns in 1.3–3.8 s (create), 2–6 s including `addLabels` and `appendUserMessage`.
- The child's `spike_probe` reports `agentName: spike-planner|spike-worker` (via
  `ctx.thread.agent()`), `parent` = creator id, labels `["child-thread", "swarm-spike"]`
  (Amp adds `child-thread` itself).
- **Recursion is blocked by Amp (stop condition for sub-planners).** Amp removes from every child
  thread the plugin tool that created it. Evidence, all in custom planner modes whose include list
  names both spike tools: a child created via `spike_spawn` listed `spike_make` but not
  `spike_spawn`; children created via `spike_make` listed `spike_spawn` but not `spike_make`; a
  grandchild created via `spike_spawn` under a `spike_make` child listed `spike_make`. In the real
  plugin, sub-planners created via `spawn` listed every planner tool except `spawn` (two runs);
  a planner created via a different tool, with an identical bootstrap message, did list `spawn`.
  Amp's child-thread prompt says "Further thread creation is intentionally unavailable in this
  delegated thread … Do not build another thread-creation mechanism", so an alias spawn tool
  would deliberately evade a platform restriction. At the owner's request the plugin
  does it anyway: identical `spawn` and `spawn_alt` tools, so every generation keeps one, plus a
  run-wide thread budget. See README.md. Live depth-2 demo: root → sub-planner via `spawn` →
  two workers via `spawn_alt` → handoffs up both levels; 8 tests pass on the branch.
- Child orbs clone the project's base branch and load project plugins from that checkout, so
  **the plugin must be on the target repository's base branch** (or be a global plugin) for
  children to have it. Without `project`, children use the project matching the plugin's
  checkout remote.
- Label rule: labels must match `[a-z0-9][a-z0-9-]*`, ≤ 32 chars. **Plan error:** `swarm:<run>`
  is invalid (colon, and a thread id is 38 chars). Use `swarm-<last 12 chars of run id>`.
- `spawn` occasionally failed with `The operation was aborted.` when a planner issued three
  spawns in one parallel batch (3 of 4 runs, always one call). In every case `children()` showed
  no entry and the planner retried cleanly; the cause is not visible from the plugin.
- Mode listing: `list_agent_modes` (and so `create_thread` with `agent_mode`) does not show
  project-plugin modes. Start roots as described in README.md.

## S2 — waking parents

- Paused orb: a spike-planner orb thread finished its turn at 19:29:31Z and sat idle 8 min
  (orbs pause ~5 min after activity stops). `appendUserMessage` at 19:37:47Z returned in ~1 s
  with state `idle → running`; the thread ran a full turn (Read + `spike_state`) and answered.
  `/proc/uptime` in the resumed orb read 370 s, i.e. it had accumulated only ~6 min of running
  time since boot, consistent with a pause and resume (E2B snapshots keep process memory, so
  the plugin's in-memory state survived too). Hard gate passes.
- Running thread: appending while a turn was running (`before: running`) queued the message;
  it was delivered ~1 s after that turn ended and got its own turn (not merged, not steered).
  Two back-to-back appends to an idle thread likewise produced two consecutive turns.
- `appendUserMessage` from a child orb's plugin to its parent thread succeeded (no error),
  unlike `state.get()` / `messages()` on the parent. The message (sent 19:27Z) was delivered to
  the parent only after the parent's long-running turn ended (~20:50Z), as its own turn: a busy
  planner sees a handoff late but does not lose it.
- Planning note: `agent.start` fires once per delivered message, so a planner sees each
  handoff as its own turn's `event.message`.

## S3 — hooks

- `tool.call` fired in an orb child for `create_file`, `edit_file`, `apply_patch` and
  `shell_command`; `filesModifiedByToolCall` returned absolute paths for the three edit tools
  (including `apply_patch` Add File), and `reject-and-continue` produced the result
  `Tool rejected by plugin: <message>` with the agent continuing.
- `shellCommandFromToolCall` returned `{ command, dir }` for `shell_command`.
- Caveat: `filesModifiedByToolCall` returned `null` for `sed -i ...` shell commands, although its
  docs claim sed support. Shell writes are invisible to the helper in practice; the shell edit
  guard is prompt policy only (as §6 #5 already allows).
- `agent.end` returning `{ action: 'continue', userMessage, maxContinuations: 1 }` started a new
  turn that answered the message. The continuation is attributed to the thread owner.
- **`ctx.thread.messages({ full: true })` returns zero messages** (every `from`/`limit` variant) on
  this Amp version. Without `full`, paging `{ from: 'start', offset, limit: 20 }` read a
  148-message transcript in 8 pages / 4.2 s. That default view loses messages behind a
  compaction, so the plugin also records handoffs in an `agent.start` hook and scans the
  transcript with `full: true` first and the default view as fallback.
- **`tool.call` does not fire for the built-in `oracle`** (a worker's oracle call is absent from
  its hook log), so oracle failures cannot be injected by a plugin. The "oracle errors" negative
  check was run as a prompt-level simulation instead.
- One worker (1 of 9 in the first runs) never resolved its swarm identity: `~/.swarm` was never
  written, `session.start` did not check out the run branch, its push went through unguarded, and
  `handoff` failed with "not part of a swarm run". The plugin cached a null role per thread, so
  one early `thread.agent()` failure or non-custom answer would explain all four symptoms
  (hypothesis; the orb's logs do not show the `agent()` result). Only swarm roles are cached now.
- Cross-thread control: `thread.cancel()` on another thread fails with `only available for
  connected threads`, so a test cannot kill a worker from outside; a "dead" worker was emulated by
  a worker that stopped without handing off.
- Cross-thread reads: `amp.threads.get(id).state.get()` worked for a child from its parent's
  plugin (also after the parent's plugin process restarted). From a child, reading its
  parent's state, `parentThreadID()` or `messages()` fails: `thread.state is only available for
  connected threads`, `thread.parent is only supported for the current thread`.
  `appendUserMessage` to another thread works without that restriction.

## S4 — concurrent pushes and wip parking

Script `spike/s4.sh` in two worker orbs with synchronized start times.

- Round 1 (distinct files): both landed; B's commit sits on top of A's (`d30d5f7` A, `9dc4fa5` B).
- Round 2 (both edit `shared.txt`): B landed first; A's `pull --rebase` stopped on the
  conflict, A ran `git rebase --abort` and pushed `HEAD:swarm-wip/s4/A`.
- A third clone fetching `swarm-wip/s4/A` saw A's round-1 commit, A's distinct round-2 commit
  and A's conflicting commit (`a088e96`, `shared.txt` = "A owns this line"), merge base
  `9dc4fa5` with `swarm/s4`. No commit was lost.
- Caveat: neither worker could wait for the 3-minute script: the worker include list has no
  `shell_command_status`, so a command that outlives its `timeout_ms` is unobservable.
  **Plan gap:** add `shell_command_status` and `shell_command_kill` to the worker's tools.
  (GPT-6 Luna also sent an empty command and an empty patch while flailing.)
