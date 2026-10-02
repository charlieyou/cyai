# Monitors for Amp

Claude Code Monitor-style event streams, implemented with the public Amp plugin API.
No dependencies; requires Bun (Amp's plugin runtime), bash, and Linux/macOS.

## Usage

The agent is expected to start monitors on its own initiative: after starting a dev server
it wants error lines from, when kicking off a build or test run it would otherwise block on,
or when it needs to react to a log or event stream. You can also ask directly:
“Monitor `app.log` for errors for five minutes.” Either way, Amp calls:

```json
{
  "description": "application errors",
  "command": "tail -n 0 -F app.log | grep --line-buffered -E 'ERROR|FATAL'",
  "timeout_ms": 300000
}
```

The command starts immediately, without a plugin confirmation dialog. The working directory defaults
to the workspace root; pass an absolute `workdir` to override it.
Each newline-terminated stdout line becomes external-data context in the owning
thread. Lines within 200 ms are batched. A final unterminated line is delivered
at exit. Events use `appendUserMessage(..., { steer: true })`: they wake an idle
agent or queue steering for a busy agent, not forcibly interrupt an active tool.
Silent watchers make no AI calls. Delivered events can incur normal inference costs.

- `monitor_start`: `description`, `command`, optional `workdir`, `timeout_ms`, `persistent`.
- `monitor_list`: running/completed monitors, status, last 8,192 UTF-16 code units of stderr, delivery errors.
- `monitor_stop`: stop by returned `id`; only the owning thread can stop it.

Timeout defaults to 5 minutes, maximum 1 hour. `persistent: true` disables the
timeout and cannot be combined with `timeout_ms`. Stop on completion of the user's
goal. Persistent means **plugin-process lifetime**, not durable background automation.
The plugin does not keep orbs awake or restart watchers after reload, crash, or pause.
A guardian inside each monitor's process group watches a control pipe. On stop,
payload exit, or plugin death (including SIGKILL), pipe EOF triggers TERM followed
by KILL one second later. It signals its own group, never a potentially reused
numeric process-group ID. If the guardian itself is killed or the orb is paused,
it cannot perform cleanup. Do not daemonize, escape the group, or kill the guardian.
Natural completion may wait up to one second for descendants holding stdout open.

## Safety and limits

Commands execute directly with the executor's permissions, without plugin approval;
they are not sandboxed separately and are not routed through the built-in shell
tool's permission rules. No confirmation UI is required. Amp's own tool permissions
and agent authorization rules still apply; this does not change global settings. Watcher
output is untrusted data, not authorization to take actions. Do not print secrets:
stdout is sent to Amp and stderr is available to the agent through diagnostics.

Filter at the source and use line-buffered tools. Per monitor: 16 KiB buffered
output limit, 30 event batches/minute, at most 5 pending output deliveries plus a final lifecycle notification. Exceeding
a limit stops the watcher with a notification rather than flooding context.
Delivery errors stop the watcher and remain visible in `monitor_list`; ambiguous
failed appends are not retried (avoiding duplicate wakeups). Stderr never triggers
events. Completion, timeout, and stop do send a final lifecycle notification.
Five active monitors per thread; recent completed history is kept in memory.
Stopping sends TERM to the process group, followed by KILL after one second.

Use Amp's managed services for servers; monitor their logs rather than launching
a server here. Use built-in schedules for periodic/durable checks. This plugin
does not attach to an existing shell tool PID: provide a log tail or event command.

## Development

Run `bun test monitors/` from the plugin repository. Tests exercise real subprocesses
with a mocked Amp host. Global installation takes effect only after the repository
is pushed and plugins are reloaded; local tests do not activate it in live threads.
