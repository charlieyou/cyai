# AI Configs

Shared skills, commands, and agents for Claude Code and Codex CLI.

## Setup

Run the linking script to symlink skills and commands to the appropriate directories:

```bash
./link-all.sh
```

This creates symlinks in:
- `~/.claude/skills/` and `~/.codex/skills/` for skills
- `~/.claude/commands/` and `~/.codex/prompts/` for commands
- `~/.claude/agents/` for subagents
- `~/.local/bin/` for wrapper scripts

The script is idempotent and can be run multiple times safely.

## Bin Scripts

### `claude` wrapper

A wrapper around the claude CLI that adds MCP server toggle flags:

```bash
claude              # Normal (uses settings.json)
claude +mail        # Enable agent-mail MCP server
claude +mail +foo   # Enable multiple servers
clauded +mail       # Composable with --dangerously-skip-permissions
```

**Setup:**

Create `~/.claude/mcp-servers.sh` with your server definitions (not committed):

```bash
# MCP Server definitions - DO NOT COMMIT (contains secrets)

declare -A SERVERS=(
  ["mail"]='{"type":"http","url":"http://127.0.0.1:8765/mcp/","headers":{"Authorization":"Bearer YOUR_TOKEN"}}'
  ["github"]='{"command":"gh-mcp"}'
)

# Servers enabled by default (empty = none)
DEFAULT_ENABLED=()
```

**Behavior:**
- No toggle flags → runs real claude with settings.json (normal behavior)
- With toggle flags → uses `--strict-mcp-config` (only specified servers, ignores settings.json)
- No config file → wrapper passes through to real claude (toggle flags ignored)

### Grimp helpers

Architecture exploration and layer checks for Python projects:

- `arch-grimp-explore` - fan-in/out + structure summary
- `arch-grimp-path` - shortest import chain between modules
- `arch-grimp-layers` - layer violation check (CI-friendly)
- `arch-grimp-diff` - compare current violations to a baseline

## Review Gate

Multi-model consensus review system that gates Claude Code session termination until artifacts are reviewed and approved. Operates in **autonomous mode** with automatic revision loops.

### Purpose

When you generate review artifacts (via `/healthcheck`, `/architecture-review`, etc.), the review gate:
1. Spawns two AI reviewers (Codex, Gemini) to analyze the artifact in parallel
2. Blocks session termination until all reviewers complete
3. **Automatically loops** until all reviewers agree (PASS)
4. Falls back to manual decision after 5 iterations

This ensures AI-generated artifacts get multi-perspective review with automatic revision cycles.

### How It Works

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Artifact saved  │────▶│ Stop hook fires  │────▶│ Spawn reviewers │
│ session latest  │     │ review-gate check│     │ codex / gemini  │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
                                                          ▼
                               ┌──────────────────────────────────────┐
                               │         All reviewers PASS?          │
                               └──────────────────────────────────────┘
                                        │                    │
                                       YES                   NO
                                        │                    │
                                        ▼                    ▼
                        ┌───────────────────┐    ┌────────────────────┐
                        │   Auto-approve    │    │ Request revision   │
                        │   Session stops   │    │ (loop up to 5x)    │
                        └───────────────────┘    └────────────────────┘
```

**Autonomous flow:**
1. Commands like `/healthcheck` save artifacts to the session-scoped `latest.md` (use `review-gate artifact-path`)
2. When Claude tries to stop, the Stop hook detects the artifact
3. Reviewers (Codex, Gemini) spawn in background
4. Hook polls until all reviewers complete (configurable timeout)
5. **All PASS** → auto-approve, session allowed to stop
6. **Not all PASS** → presents issues and blocks for revision
7. After you revise the artifact, the review automatically re-runs
8. After 5 iterations without consensus, falls back to manual decision

### Usage

**Via command (manual trigger):**
```bash
/review-gate path/to/artifact.md
```

**Via Stop hook (automatic):**
Any command that writes to the session-scoped `latest.md` triggers the gate when Claude stops.

**Manual override (only needed after max iterations):**
```bash
review-gate resolve proceed   # Accept anyway
review-gate resolve abort     # Discard the artifact
```

### Prerequisites

1. Run `./link-all.sh` to install the review-gate scripts to `~/.local/bin/`
2. Ensure `~/.local/bin` is in your PATH
3. Have `codex` and/or `gemini` CLIs installed (missing ones are skipped with warning)

### Hook Configuration

Add the following Stop hook to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [{
          "type": "command",
          "command": "~/.local/bin/review-gate check",
          "timeout": 60
        }]
      }
    ]
  }
}
```

#### Merging with Existing Configuration

If you already have a `hooks` key in your settings.json, add the Stop array to it:

```json
{
  "hooks": {
    "ExistingHook": [...],
    "Stop": [
      {
        "hooks": [{
          "type": "command",
          "command": "~/.local/bin/review-gate check",
          "timeout": 60
        }]
      }
    ]
  }
}
```

### Verification

After adding the configuration:

1. Start a new Claude Code session
2. Run `/healthcheck` to generate a review artifact
3. Verify the review gate triggers when Claude stops
4. Confirm the autonomous revision loop works (blocks if not all PASS, auto-approves if all PASS)

### Timeout and Polling

The check script polls for reviewer completion with configurable behavior:

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `REVIEW_GATE_MAX_WAIT_SECONDS` | 600 | Max time to wait for reviewers before returning |
| `REVIEW_GATE_POLL_INTERVAL_SECONDS` | 3 | Polling interval |

The 60-second hook timeout is sufficient for most cases. If reviewers haven't completed, the hook blocks and re-fires on the next stop attempt.

### Adding Review Gate to a Command

To make a command automatically trigger the review gate, add this section at the end of your command's markdown file:

```markdown
---

## Final Step

After completing the review, use the Bash tool to get the session-scoped artifact path:

\`\`\`
~/.local/bin/review-gate artifact-path
\`\`\`

Then use the Write tool to save this entire review output to that path (use the exact path returned):

\`\`\`
Write the complete review above to <paste the path printed above>
\`\`\`

This enables automatic review gate validation if configured.
```

When Claude finishes executing the command and tries to stop, the Stop hook will:
1. Detect the artifact at the session-scoped `latest.md`
2. Spawn reviewers (Codex, Gemini) automatically
3. Auto-approve if all reviewers PASS, or request revisions until they do

### Scripts

The review gate system uses these scripts in `~/.local/bin/`:

| Script | Purpose |
|--------|---------|
| `review-gate` | Multi-model review gate entrypoint (check/spawn/resolve/artifact-path) |

### Type-Specific Review Prompts

The review gate uses type-specific evaluation criteria based on the artifact being reviewed. Templates are resolved in order:

1. `$PROJECT_ROOT/.claude/review-prompts/<type>.md` (project-local)
2. `~/.claude/review-prompts/<type>.md` (user-global)
3. Fallback to generic criteria

**Built-in templates:**

| Type | Template | Used By |
|------|----------|---------|
| `healthcheck` | Checks coverage, accuracy, actionability, proportionality | `/healthcheck` |
| `architecture-review` | Checks insight quality, leverage, feasibility, trade-offs | `/architecture-review` |
| `code-review` | Checks correctness, security, completeness, false positives | `/code-review` |
| `plan` | Checks completeness, order of operations, edge cases, scope | Implementation plans |

**Type detection:**

1. Explicit `--type` argument: `review-gate spawn --type=plan artifact.md`
2. Frontmatter in artifact: `<!-- review-type: healthcheck -->`
3. Filename pattern (e.g., `healthcheck-*.md` → `healthcheck`)

**Creating custom templates:**

Create a markdown file in `.claude/review-prompts/<type>.md`:

```markdown
## Evaluation Criteria (My Custom Type)

Review this artifact for:
1. **Criterion 1** - Description
2. **Criterion 2** - Description
...

Focus on <what makes a good artifact of this type>.
```

Then reference it via frontmatter (`<!-- review-type: my-custom-type -->`) or explicit `--type=my-custom-type`.

## Skills

| Skill | Description |
|-------|-------------|
| `databricks-bundle` | Manage Databricks Asset Bundles (DABs) for infrastructure as code |
| `databricks-jobs` | Manage Databricks Jobs via CLI (create, run, monitor, delete jobs) |
| `databricks-sql` | Execute SQL queries against Databricks SQL Warehouses |
| `databricks-unity-catalog` | Manage Unity Catalog via Databricks CLI (catalogs, schemas, tables, volumes) |
| `grimp-architecture` | Explore Python import graphs and enforce layered architecture using grimp helpers |
| `pyspark-style` | PySpark code style and best practices for DataFrame API |

## Commands

| Command | Description |
|---------|-------------|
| `architecture-review` | Architecture-focused review for high-leverage design improvements |
| `bd-breakdown` | Convert a review or feature plan into small, parallelizable Beads issues |
| `bd-implement` | Implement a beads issue end-to-end with quality checks |
| `bd-parallel` | Continuously process beads issues with parallel subagents |
| `code-review` | Multi-model code review for git changes (`--uncommitted`, `--base`, `--commit`, ranges) |
| `diary` | Create a structured diary entry from the current session |
| `healthcheck` | Code health review optimized for AI-generated codebases |
| `reflect` | Analyze diary entries to identify patterns and propose AGENTS.md updates |
| `review-gate` | Multi-model consensus review with user approval gate |

## Agents

| Agent | Description |
|-------|-------------|
| `bd-implementer` | Subagent that implements beads issues end-to-end (used by bd-parallel) |
