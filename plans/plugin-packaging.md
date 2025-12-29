# Plan: Package Review Gate as a Plugin

## Goal
Package all review gate functionality into a self-contained plugin that can be easily installed by other users via a GitHub marketplace.

## Proposed Plugin Structure

```
review-gate/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── commands/
│   ├── code-review.md           # /review-gate:code-review
│   ├── plan-review.md           # /review-gate:plan-review
│   ├── scope.md                 # /review-gate:scope
│   ├── architecture-review.md   # /review-gate:architecture-review
│   └── healthcheck.md           # /review-gate:healthcheck
├── prompts/
│   ├── reviewers/
│   │   ├── code-review.md
│   │   ├── plan.md
│   │   ├── spec.md
│   │   └── architecture-review.md
│   └── generators/
│       ├── healthcheck.md
│       └── architecture-review.md
├── bin/
│   ├── review-gate              # Main script (2474 lines)
│   └── review-gate-lib.sh       # Shared library (204 lines)
├── hooks/
│   └── hooks.json               # Stop hook configuration
└── README.md                    # Installation & usage docs
```

## Key Changes Required

### 1. Update Script Paths
All scripts must use `${CLAUDE_PLUGIN_ROOT}` instead of hardcoded paths:

**Before** (in commands):
```bash
~/.local/bin/review-gate spawn-code-review
```

**After**:
```bash
${CLAUDE_PLUGIN_ROOT}/bin/review-gate spawn-code-review
```

### 2. Update Prompt Template Paths
The `review-gate` script resolves prompt templates. Must update to use plugin-relative paths:

**Before** (in review-gate):
```bash
PROMPT_DIR="$HOME/cyai/prompts"
```

**After**:
```bash
PROMPT_DIR="${CLAUDE_PLUGIN_ROOT}/prompts"
```

### 3. Create hooks.json
Move the Stop hook configuration into the plugin:

```json
{
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/bin/review-gate check",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

### 4. Create plugin.json

```json
{
  "name": "review-gate",
  "version": "1.0.0",
  "description": "Multi-model code review with iterative feedback loops",
  "author": {
    "name": "cyou"
  },
  "repository": "https://github.com/cyou/review-gate",
  "license": "MIT",
  "keywords": ["code-review", "multi-model", "quality-gate"]
}
```

### 5. Handle State Directory
The script stores state in `~/.claude/projects/<hash>/review-gate/`. This is fine - it's user-local state, not plugin state.

### 6. Handle External Dependencies
The script shells out to:
- `codex` CLI
- `gemini` CLI
- `claude` CLI

Users need these installed. Document in README.

## Files to Move

| Current Location | Plugin Location |
|-----------------|-----------------|
| `bin/review-gate` | `bin/review-gate` |
| `bin/review-gate-lib.sh` | `bin/review-gate-lib.sh` |
| `commands/code-review.md` | `commands/code-review.md` |
| `commands/plan-review.md` | `commands/plan-review.md` |
| `commands/scope.md` | `commands/scope.md` |
| `commands/architecture-review.md` | `commands/architecture-review.md` |
| `commands/healthcheck.md` | `commands/healthcheck.md` |
| `prompts/reviewers/*.md` | `prompts/reviewers/*.md` |
| `prompts/generators/*.md` | `prompts/generators/*.md` |

## Implementation Steps

1. Create plugin directory structure
2. Copy all files to plugin directory
3. Update `review-gate` script:
   - Add `PLUGIN_ROOT` resolution at top
   - Replace all hardcoded paths with `$PLUGIN_ROOT`
4. Update command files:
   - Replace `~/.local/bin/review-gate` with `${CLAUDE_PLUGIN_ROOT}/bin/review-gate`
5. Create `hooks/hooks.json` with Stop hook
6. Create `.claude-plugin/plugin.json` manifest
7. Create README with:
   - Prerequisites (codex, gemini CLI tools)
   - Installation instructions
   - Command usage
8. Test locally with `claude --plugin-dir ./review-gate`
9. Create marketplace repository for distribution

## Open Questions

1. **Plugin name**: `review-gate` or something more descriptive like `multi-model-review`?
2. **Should we keep bd-* commands?** (bd-breakdown, bd-implement, bd-parallel) - these seem related but separate
3. **Marketplace location**: Create new repo or subdirectory of existing?
