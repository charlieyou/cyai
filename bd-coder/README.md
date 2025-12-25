# bd-parallel

A multi-agent system for processing beads issues in parallel using the Claude Agent SDK.

## Installation

```bash
cd bd-parallel
uv sync
```

## Usage

```bash
# Run the parallel worker (from repo with beads issues)
bd-parallel run /path/to/repo

# Or with options
bd-parallel run --max-agents 3 --timeout 30 --verbose /path/to/repo

# View agent logs
bd-parallel logs
bd-parallel logs --agent bd-42 --tail 100

# Check status (locks, running agents)
bd-parallel status

# Clean up locks and logs
bd-parallel clean
```

## Architecture

```
bd-parallel (Python Orchestrator)
├── Spawns: N agents in parallel (asyncio tasks)
├── Each agent: ClaudeSDKClient session implementing one issue
├── Coordination: Filesystem locks prevent edit conflicts
└── Cleanup: Locks released on completion, timeout, or failure
```

## Coordination Layers

| Layer | Tool | Purpose |
|-------|------|---------|
| Issue-level | Beads (`bd`) | Prevents duplicate claims via status updates |
| File-level | Filesystem locks | Prevents edit conflicts between agents |

## How It Works

1. **Orchestrator** spawns up to N parallel agent tasks (default: 3)
2. **Each agent**:
   - Gets assigned an issue (already claimed by orchestrator)
   - Acquires filesystem locks before editing any files
   - Implements the issue, runs quality checks, commits
   - Releases locks, closes issue
3. **On file conflict**: Agent waits up to 60s for lock, returns BLOCKED if unavailable
4. **On failure/timeout**: Orchestrator releases orphaned locks, resets issue status

## Agent Workflow

Each spawned agent follows this workflow:

1. **Understand**: Read issue with `bd show <id>`
2. **Lock files**: Acquire filesystem locks before editing
3. **Implement**: Write code following project conventions
4. **Quality checks**: Run linters, formatters, type checkers
5. **Self-review**: Verify implementation meets requirements
6. **Commit**: Stage and commit changes locally
7. **Cleanup**: Release locks, close issue with `bd close <id>`

## Key Design Decisions

- **Filesystem locks** via atomic mkdir (sandbox-compatible, no external deps)
- **60-second lock timeout** (fail fast on conflicts)
- **Orchestrator claims issues** before spawning (agents don't claim)
- **Per-agent logs** in `/tmp/bd-parallel-logs/` for debugging
- **asyncio.wait** for efficient parallel task management

## Configuration

Options can be set via CLI flags:

| Flag | Default | Description |
|------|---------|-------------|
| `--max-agents`, `-n` | 3 | Maximum concurrent agents |
| `--timeout`, `-t` | 30 | Timeout per agent in minutes |
| `--verbose`, `-v` | false | Enable verbose logging |

## Logs

Agent logs are written to `/tmp/bd-parallel-logs/`:

```
agent-bd-42-a1b2c3d4.log
agent-bd-43-e5f6g7h8.log
```

View with:
```bash
bd-parallel logs                    # Latest log
bd-parallel logs --agent bd-42      # Filter by issue
bd-parallel logs --tail 100         # More lines
```

## TODOs

Ideas
* Add back claude orchestrator, manually managing context
* agent mail using filesystem?
* use codex for code review?

* Add beads
* Add limit on number of issues to do

### Context Exhaustion Handling
When agents run out of context mid-implementation:
- [ ] Detect context exhaustion (agent returns incomplete)
- [ ] Save progress state (files modified, locks held)
- [ ] Spawn continuation agent with summary of prior work
- [ ] Or: commit partial progress, mark issue as needs-continuation

### Other Improvements
- [ ] Deadlock detection (two agents waiting on each other)
- [ ] Metrics/logging for multi-agent sessions
- [ ] Graceful shutdown (signal all agents to wrap up)
