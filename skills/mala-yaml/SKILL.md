---
name: creating-mala-yaml
description: "Creates or updates mala.yaml project configuration files for the local mala orchestrator. Use when asked to initialize, generate, write, edit, validate, fix, or explain a mala.yaml config, including presets, commands, coverage, evidence checks, validation triggers, or review settings."
---

# Creating Mala YAML

Create the smallest correct `mala.yaml` for the repository being configured.

## Workflow

1. Find the repository root and check whether `mala.yaml` already exists. If it exists, read it first and preserve intentional settings unless the user asked to replace it.
2. Inspect project files to identify the stack and existing quality commands:
   - Python/uv: `pyproject.toml`, `uv.lock`
   - Node/npm: `package.json`, `package-lock.json`
   - Go: `go.mod`, `go.sum`
   - Rust: `Cargo.toml`, `Cargo.lock`
   - Other stacks: `Makefile`, CI workflows, README, or language-specific config files
3. Prefer a built-in preset when it matches the project. Common presets are `python-uv`, `node-npm`, `go`, and `rust`; verify preset names against `docs/project-config.md`, the installed CLI, or the source tree before using unfamiliar presets.
4. Add explicit `commands` only when the preset is insufficient or the project has custom command names. Use the project's actual commands instead of inventing new scripts.
5. Add `code_patterns`, `config_files`, and `setup_files` only when the preset defaults are wrong or no preset is used. List fields replace preset lists entirely.
6. Add `coverage`, `evidence_check`, `validation_triggers`, `per_issue_review`, or `epic_verification` only when requested, already present, or clearly needed for the user's validation policy.
7. Validate YAML syntax and, when possible, load the config with mala before reporting completion. Do not run destructive or long-running project commands unless the user asked for execution.

## Decision Rules

- New standard project: use `mala init` or a single `preset`.
- Existing `mala.yaml`: make the smallest targeted edit and preserve unrelated settings.
- Custom project commands: inspect existing scripts, Make targets, CI, or README before writing commands.
- Validation policy requested by user: add only the requested `coverage`, `evidence_check`, `validation_triggers`, or review settings.
- Unclear schema detail: check the mala docs/source before guessing.

## Quick Generation

If the `mala` CLI is available and the user wants a standard config, prefer `mala init` over hand-writing boilerplate:

```bash
mala init --dry-run --preset python-uv --skip-evidence --skip-triggers
mala init --preset python-uv --skip-evidence --skip-triggers
```

Use manual edits when the user asks for specific validation behavior, the CLI is unavailable, or the existing config needs targeted changes.

## Core Rules

`mala.yaml` belongs at the repository root. It must define either a `preset` or at least one command.

A valid config usually needs only a preset:

```yaml
preset: python-uv
```

Use explicit `commands` only to override preset behavior or configure a project without a preset:

```yaml
preset: python-uv

commands:
  test:
    command: "uv run pytest tests/integration"
    timeout: 600
  lint: null
```

Command values can be strings, objects with `command` and optional `timeout`, or `null` to disable an inherited preset command. Do not use empty strings; use `null` for disabled commands.

Built-in command names are `setup`, `build`, `test`, `lint`, `format`, `typecheck`, and `e2e`. Custom command names must match `[A-Za-z_][A-Za-z0-9_-]*`.

## Common Examples

### Minimal Python/uv

```yaml
preset: python-uv
```

### Python/uv With Coverage

```yaml
preset: python-uv

coverage:
  command: "uv run pytest --cov --cov-report=xml:coverage.xml"
  format: xml
  file: coverage.xml
  threshold: 80
```

### Node/npm With Custom Test

```yaml
preset: node-npm

commands:
  test: "npm run test:ci"
```

### No Matching Preset, Fully Custom Commands

Use explicit pattern lists only when no preset applies or preset defaults are wrong; these lists replace preset defaults entirely.

```yaml
commands:
  setup: "make deps"
  test: "make test"
  lint: "make lint"
  format: "make fmt-check"

code_patterns:
  - "**/*.go"
  - "**/*.c"
  - "Makefile"

config_files:
  - "Makefile"

setup_files:
  - "go.mod"
  - "go.sum"
```

## Evidence Checks

`evidence_check.required` is opt-in and gates per-issue completion on evidence from the agent's session logs.

```yaml
evidence_check:
  required: [lint, typecheck]
```

Only require commands that implementer agents are expected to run in their own session. Validation trigger commands run by the orchestrator do not substitute for per-session evidence.

## Validation Triggers

Use `validation_triggers` to run commands at orchestrator checkpoints. Trigger command `ref` values must exist in the base command pool from the preset plus `commands`.

```yaml
validation_triggers:
  session_end:
    failure_mode: remediate
    max_retries: 3
    commands:
      - ref: test
      - ref: lint
      - ref: typecheck

  run_end:
    fire_on: both
    failure_mode: continue
    commands:
      - ref: test
```

Use `failure_mode: abort` to stop immediately, `continue` to log and keep going, or `remediate` to spawn a fixer and retry. Include `max_retries` when using `remediate`.

## Code Review Settings

Use `per_issue_review` for review after individual issues, and trigger `code_review` blocks for session, epic, or run-end reviews.

```yaml
per_issue_review:
  enabled: true
  reviewer_type: cerberus
  max_retries: 3
  finding_threshold: P1

validation_triggers:
  run_end:
    fire_on: both
    failure_mode: continue
    code_review:
      enabled: true
      reviewer_type: cerberus
      baseline: since_last_review
      finding_threshold: P0
```

For cumulative `epic_completion` or `run_end` reviews, include `baseline: since_run_start` or `baseline: since_last_review`.

## Validation Checklist

- `mala.yaml` is at the repository root.
- YAML parses as a mapping.
- The config has a valid preset or at least one non-empty command.
- Trigger `ref` entries and `evidence_check.required` names exist in the resolved command pool.
- `coverage` includes `format: xml`, `file`, and `threshold`; the coverage command writes that file.
- Pattern lists are intentional because they replace preset defaults.
- Commands are safe to run from the repo root and do not require interactive input.

When the `mala` CLI is installed, prefer the closest non-destructive validation available for the target repo, for example:

```bash
mala init --dry-run --preset python-uv --skip-evidence --skip-triggers
```

For the mala source repository, validate with the project loader:

```bash
uv run python - <<'PY'
from pathlib import Path
from src.domain.validation.config_loader import load_config

load_config(Path('.'))
print('mala.yaml OK')
PY
```

If no loader or CLI check is available, at minimum parse the YAML and manually verify command refs, evidence refs, coverage file settings, and replacement list semantics.

## Reference Docs

In the mala repository, use these as the source of truth when details are unclear:

- `docs/project-config.md` for schema, presets, merge rules, coverage, and examples
- `docs/validation-triggers.md` for trigger and code review configuration
- `docs/cli-reference.md` for `mala init` behavior
