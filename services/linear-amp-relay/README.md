# linear-amp-relay

Makes Amp a Linear [agent](https://linear.app/developers/agents). Delegate (assign) an issue to it or
@mention it, and the relay:

- starts an Amp orb thread in the right project;
- links the thread in the Linear agent session;
- shows the thread's current tool call as a progress line;
- relays follow-up messages and stop requests;
- posts each final reply, plus any PR links, back to Linear.

```
Linear ──AgentSessionEvent──▶ relay (Fly) ──amp CLI + AMP_API_KEY──▶ Amp orb thread per session
   ▲                              │
   └──── activities, links ───────┘  (polls running threads every 20 s)
```

It is a small Bun server. It drives Amp through the `amp` CLI:

- `amp -ox --project` to start a thread;
- `amp threads continue --orb-execute` to send a follow-up;
- `amp threads export` to watch a thread;
- `amp threads archive` to stop one.

Each CLI call exits as soon as its message is in the thread, and the orb keeps working without the relay.

## Choosing the project

The first rule that matches wins:

1. `[repo=owner/name]` in the triggering comment, then in the issue description. This is Cursor's `[key=value]` syntax; Devin documents none. A project ref, a bare repo name, or a GitHub URL also works.
2. Exactly one of your Amp projects' repositories is mentioned in the comment or description (`owner/name` or a GitHub URL).
3. `LINEAR_AGENT_DEFAULT_PROJECT`, if set.
4. Linear's [`issueRepositorySuggestions`](https://linear.app/developers/agent-interaction#repository-suggestions) ranks your Amp projects. The top one is used if it alone scores ≥ 0.8.
5. Otherwise it asks in Linear with a repository picker. Reply with a choice or `owner/repo`.

`[mode=high]` (or `LINEAR_AGENT_MODE`) picks the Amp agent mode.

Stop in Linear archives the Amp thread. Unarchive it in Amp to inspect or continue the work.

## Deploy (Fly.io)

```sh
cd services/linear-amp-relay
# edit `app` in fly.toml to a unique name
fly launch --copy-config --no-deploy
fly volumes create relay_data --size 1 --region iad
fly secrets set AMP_API_KEY=… LINEAR_CLIENT_ID=… LINEAR_CLIENT_SECRET=… LINEAR_WEBHOOK_SECRET=…
fly deploy
```

- **`AMP_API_KEY`:** an Amp access token from https://ampcode.com/settings. Threads run as that user.
- **Linear app:** in Linear go to **Settings → API → OAuth applications → New**.
  - Name it what you want to @mention, e.g. `Amp`.
  - Enable webhooks with the URL `https://<app>.fly.dev/webhooks/linear` and tick **Agent session events**.
  - Enable **Client credentials**.
  - Copy the client ID, client secret and webhook signing secret into the Fly secrets above.
- **Install:** the relay requests an `app` actor token with `client_credentials`, using the scopes `read,write,app:assignable,app:mentionable`. Manage the agent's team access on the app's page in Linear.

Optional env: `LINEAR_AGENT_DEFAULT_PROJECT`, `LINEAR_AGENT_MODE`, `POLL_MS` (default 20000).
State (sessions, token) lives in `/data/state.json` on the volume. Run exactly one machine.

## Develop

```sh
bun install
bun test
bunx tsc --noEmit
```
