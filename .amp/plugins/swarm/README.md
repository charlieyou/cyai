# swarm — agent swarm plugin for Amp

Implements `swarm-on-amp-plan.md` (v11) Phases 1–2 as a project plugin: a `swarm-planner` mode
that decomposes and delegates, a `swarm-worker` mode that does one task, lands it on the run's
integration branch `swarm/<root-thread-id>` and reports once.

| File | Owns |
|---|---|
| `index.ts` | Mode metadata headers and wiring |
| `core.ts` | Roles, caps, bootstrap line, `~/.swarm/<run>/<thread>/` state, git helpers |
| `modes.ts`, `prompts/` | The two modes (§4) and their prompts (§9) |
| `tools.ts` | `spawn`, `children`, `publish_docs`, `handoff` (§5) |
| `guards.ts` | `tool.call` edit and shell guards (§6 invariants 5–6) |
| `backstop.ts` | `agent.end` handoff backstop for workers (§7) |
| `session.ts` | Run-branch creation and non-destructive checkout (§4, §8) |
| `spikes.md` | Phase 0 results; read before changing behavior |

## Using it

1. The plugin must be on the base branch of the repository the swarm works on: child orbs clone
   that branch and load `.amp/plugins/` from it.
2. Start a root: a new orb thread in mode `swarm-planner` with the spec as the first message. A
   planner thread with no parent is the root; its id is the run id.
3. Optionally schedule `[swarm-tick] call children() and act on overdue or errored ones` on the
   root every 30 minutes (plugins cannot create schedules).
4. When the root reports done, open a PR from `swarm/<run>` yourself (`gh` is denied in swarm
   shells; `open_pr` is Phase 3).

The host must stop the orb's git identity from pushing the default branch (§8).

## Deviations from the plan, forced by Amp (details in `spikes.md`)

- **No sub-planners.** Amp removes from each child thread the plugin tool that created it, so a
  sub-planner has no `spawn`. `spawn` refuses `role: swarm-planner`; runs are depth 1.
- Read-only tools are `Read` and `finder` (there is no `Grep`/`Glob`); workers also get
  `shell_command_status`/`shell_command_kill` for long commands.
- Run labels are `swarm-<last 12 chars of run id>` (labels cannot contain `:`).
- `messages({ full: true })` returns nothing, so handoffs are detected from the default transcript
  view plus a record kept by an `agent.start` hook.
- The bootstrap message has a second line `[swarm self=<own id> task: <title>]`, and `children()`
  starts with a `you:` line, because agents otherwise cannot learn their own thread id.

## Tests

`bun install && npx tsc --noEmit && bun test` (git behavior runs against temporary repositories).
