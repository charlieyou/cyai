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

- **Two spawn tools.** Amp removes from each child thread the plugin tool that created it, so a
  sub-planner created by `spawn` has no `spawn`. The plugin registers an identical `spawn_alt`;
  each generation keeps one of the two. This deliberately works around a restriction Amp states
  ("Further thread creation is intentionally unavailable in this delegated thread"), at the
  owner's request, and may stop working if Amp closes it. Because Amp's runaway protection is
  bypassed, the root holds a run-wide budget of 100 threads (`RUN_BUDGET` in `core.ts`) and grants
  slices of it to sub-planners (`budget` in the bootstrap line). Depth stays capped at 3.
- Read-only tools are `Read` and `finder` (there is no `Grep`/`Glob`); workers also get
  `shell_command_status`/`shell_command_kill` for long commands.
- Run labels are `swarm-<last 12 chars of run id>` (labels cannot contain `:`).
- `messages({ full: true })` returns nothing, so handoffs are detected from the default transcript
  view plus a record kept by an `agent.start` hook.
- Field Guide: both prompts read `docs/field-guide/index.md` directly, since neither role may
  edit `AGENTS.md`. Adding `@docs/field-guide/index.md` to the target's `AGENTS.md` also works.
- The bootstrap message has a second line `[swarm self=<own id> task: <title>]`, and `children()`
  starts with a `you:` line, because agents otherwise cannot learn their own thread id.

## Tests

`bun install && npx tsc --noEmit && bun test` (git behavior runs against temporary repositories).
