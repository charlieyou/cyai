# Plan: Package Cerberus as a Plugin

*Three-headed guardian of code quality.*

## Goal
Package Cerberus (multi-model consensus review system) into a self-contained plugin that can be easily installed by other users via a GitHub marketplace.

## Scope
Only `/code-review` and `/plan-review` commands. Other commands (healthcheck, architecture-review, scope, bd-*) remain in cyai repo.

## Proposed Plugin Structure

```
cerberus/
├── .claude-plugin/
│   └── plugin.json              # Plugin manifest
├── commands/
│   ├── review-code.md           # /cerberus:review-code
│   └── review-plan.md           # /cerberus:review-plan
├── prompts/
│   └── reviewers/
│       ├── code.md              # Code diff review criteria
│       └── plan.md              # Plan review criteria
├── bin/
│   ├── review-gate              # Main script
│   └── review-gate-lib.sh       # Shared library
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
  "name": "cerberus",
  "version": "1.0.0",
  "description": "Three-headed guardian of code quality. Multi-model consensus review with Codex, Gemini, and Claude.",
  "author": {
    "name": "cyou"
  },
  "repository": "https://github.com/cyou/cerberus",
  "license": "MIT",
  "keywords": ["code-review", "multi-model", "quality-gate", "cerberus"]
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

## Files to Copy

| Current Location | Plugin Location |
|-----------------|-----------------|
| `bin/review-gate` | `bin/review-gate` |
| `bin/review-gate-lib.sh` | `bin/review-gate-lib.sh` |
| `commands/code-review.md` | `commands/review-code.md` |
| `commands/plan-review.md` | `commands/review-plan.md` |
| `prompts/reviewers/code-review.md` | `prompts/reviewers/code.md` |
| `prompts/reviewers/plan.md` | `prompts/reviewers/plan.md` |

## Implementation Steps

1. Create plugin directory structure at `plugins/cerberus/`
2. Copy files to plugin directory
3. Update `review-gate` script:
   - Add `PLUGIN_ROOT` resolution at top (detect if running from plugin or standalone)
   - Replace hardcoded paths with `$PLUGIN_ROOT`
   - Strip out generate subcommand and other unused code paths
4. Update command files:
   - Replace `~/.local/bin/review-gate` with `${CLAUDE_PLUGIN_ROOT}/bin/review-gate`
5. Create `hooks/hooks.json` with Stop hook
6. Create `.claude-plugin/plugin.json` manifest
7. Create README with:
   - Prerequisites (codex, gemini, claude CLIs)
   - Installation instructions
   - Command usage
8. Test locally with `claude --plugin-dir ./plugins/cerberus`
9. Create marketplace repository for distribution
