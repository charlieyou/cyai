# Agent Instructions

## Python Environment

- **Package manager**: uv
- **Linting & formatting**: ruff
- **Type checking**: ty

```bash
uv sync                # Install dependencies
uv run <script>        # Run scripts
uvx ruff check .       # Lint
uvx ruff format .      # Format
uvx ty check           # Type check
```

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --status in_progress  # Claim work
bd close <id>         # Complete work
bd sync               # Sync with git
```
