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

Multi-model consensus review system that gates Claude Code session termination until artifacts are reviewed and approved.

### Purpose

When you generate review artifacts (via `/healthcheck`, `/architecture-review`, etc.), the review gate:
1. Spawns two AI reviewers (Codex, Gemini) to analyze the artifact in parallel
2. Blocks session termination until all reviewers complete
3. Presents a consensus table with verdicts (PASS/FAIL/NEEDS_WORK)
4. Requires you to decide: PROCEED, REVISE, or ABORT

This ensures AI-generated artifacts get multi-perspective review before you act on them.

### How It Works

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ Artifact saved  │────▶│ Stop hook fires  │────▶│ Spawn reviewers │
│ .review/latest  │     │ review-gate-check│     │ claude/codex/gem│
└─────────────────┘     └──────────────────┘     └─────────────────┘
                                                          │
┌─────────────────┐     ┌──────────────────┐              ▼
│ Session allowed │◀────│ User resolves    │◀────────────────────────
│ to terminate    │     │ proceed/revise   │     Reviews complete,
└─────────────────┘     └──────────────────┘     results presented
```

**Automatic flow:**
1. Commands like `/healthcheck` save artifacts to `.review/latest.md`
2. When Claude tries to stop, the Stop hook detects the artifact
3. Reviewers spawn in background, hook blocks with "Reviewers analyzing..."
4. Once complete, hook presents results table and prompts for decision
5. You run `review-gate-resolve proceed` (or revise/abort) to unblock

**Auto-approval:** If all reviewers return PASS, the gate auto-approves.

### Usage

**Via command (manual trigger):**
```bash
/review-gate path/to/artifact.md
```

**Via Stop hook (automatic):**
Any command that writes to `.review/latest.md` triggers the gate when Claude stops.

**Resolving the gate:**
```bash
review-gate-resolve proceed   # Accept and continue
review-gate-resolve revise    # Make changes, re-review later
review-gate-resolve abort     # Discard the artifact
```

### Prerequisites

1. Run `./link-all.sh` to install the review-gate scripts to `~/.local/bin/`
2. Ensure `~/.local/bin` is in your PATH
3. Have `claude`, `codex`, and/or `gemini` CLIs installed (missing ones are skipped with warning)

### Hook Configuration

Add the following Stop hook to your `~/.claude/settings.json`:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [{
          "type": "command",
          "command": "~/.local/bin/review-gate-check",
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
          "command": "~/.local/bin/review-gate-check",
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
4. Confirm the PROCEED/REVISE/ABORT flow works correctly

### Timeout

The 60-second timeout is sufficient for the check script to:
- Detect review artifacts
- Spawn reviewer processes (if needed)
- Check reviewer progress
- Present results

If you experience timeouts with slow network connections, you can increase this value.

### Adding Review Gate to a Command

To make a command automatically trigger the review gate, add this section at the end of your command's markdown file:

```markdown
---

## Final Step

After completing the review, use the Write tool to save this entire review output to `.review/latest.md`:

\`\`\`
Write the complete review above to .review/latest.md
\`\`\`

This enables automatic review gate validation if configured.
```

When Claude finishes executing the command and tries to stop, the Stop hook will:
1. Detect the artifact at `.review/latest.md`
2. Spawn reviewers automatically
3. Block until you resolve with `review-gate-resolve`

### Scripts

The review gate system uses these scripts in `~/.local/bin/`:

| Script | Purpose |
|--------|---------|
| `review-gate-check` | Stop hook that manages the review gate lifecycle |
| `review-gate-spawn` | Spawns reviewer processes for each model |
| `review-gate-resolve` | Resolves the gate with proceed/revise/abort |

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
| `bd-breakdown` | Convert a review or feature plan into small, parallelizable Beads issues |
| `bd-implement` | Implement a beads issue end-to-end with quality checks |
| `bd-parallel` | Continuously process beads issues with parallel subagents |
| `architecture-review` | Architecture-focused review for high-leverage design improvements |
| `diary` | Create a structured diary entry from the current session |
| `healthcheck` | Code health review optimized for AI-generated codebases |
| `reflect` | Analyze diary entries to identify patterns and propose AGENTS.md updates |
| `review-gate` | Multi-model consensus review with user approval gate |

## Agents

| Agent | Description |
|-------|-------------|
| `bd-implementer` | Subagent that implements beads issues end-to-end (used by bd-parallel) |
