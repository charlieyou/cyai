# Amp for Raycast

Start a thread with a prompt, runner or orb, directory/project, agent mode, reasoning effort, visibility, title, and labels. Each launch starts with Amp Orb and medium mode selected. The extension remembers other execution settings but does not reuse your prompt or title.

## Install locally

1. Run `npm ci` and `npm run dev` in this directory. The build bundles the Amp runtime for this machine; no separate CLI installation is needed.
2. Open **Start Amp Thread** in Raycast. An existing Amp login works automatically. Otherwise, enter an access token from https://ampcode.com/settings/security in the extension's **Amp API Key** password preference.
3. Assign a hotkey in Raycast Settings if desired.

This native extension replaces the earlier **New Amp Thread** script command. You can disable that script in Raycast Settings to avoid having two launchers.

## Execution settings

- **Connected Runner:** enter the runner ID from Amp and an optional absolute directory served by that runner. Blank uses its default directory. The default runner ID is configurable in extension preferences.
- **Amp Orb:** choose from the searchable project dropdown. **No Project** omits the project option and launches from the extension's support directory, outside your checkouts. The list loads from your Amp account; use **Refresh Projects** in Actions to reload it. Runner directories do not apply to orbs.
- **Mode:** low, medium, high, ultra, or a custom mode key available on the executor.
- **Reasoning effort:** applies only to models that support an effort setting.
- **Visibility:** leave at Amp Default to inherit Amp's policy. Unlisted allows anyone with the link to read the thread.

The extension uses the published `@ampcode/sdk` package with its bundled Amp runtime. Both project discovery and thread creation use the bundled runtime, not an `amp` command on PATH. The optional API key goes only to the child process environment, never into launch request files or saved form settings. Without a key, the runtime uses your existing Amp login.

A prompt is required because `threads.new()` only supports visibility. The current SDK does not expose Fast/Plaid, attachments, orb sizing, or runner/project discovery. Project discovery uses the read-only `amp projects list --json` CLI command; thread creation uses the SDK, which also invokes the CLI internally.

## Launch lifecycle

The SDK streams a remote turn until it ends. A detached Node worker keeps this stream alive independently of Raycast. It publishes the thread ID as soon as Amp returns it, and Raycast opens that thread while the worker continues. Keep Raycast open until the link arrives if you want the browser to open automatically.

Launch requests and status files live in Raycast's extension support directory with owner-only permissions. The worker deletes each request, including its prompt, as soon as it reads it. Status files retain the thread ID or error for diagnostics. A failure after creation does not automatically retry or create a second thread.

## Development

```sh
npm run typecheck
npm test
npm run build
npm run dev
```

The build bundles the SDK worker into `assets/launch-worker.mjs` and copies the npm-installed native Amp runtime and its license into `assets/`. The bundle targets the build machine's OS and CPU architecture (currently macOS Apple Silicon); rebuild on the target architecture when sharing locally. Restart `npm run dev` after editing the worker. Tests run with an empty PATH and exercise the real bundled SDK against a fake runtime, without starting billable threads.
