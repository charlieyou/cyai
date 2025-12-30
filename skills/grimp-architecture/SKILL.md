---
name: grimp-architecture
description: Explore Python import graphs and enforce layered architecture using grimp.
---

# Grimp Architecture Exploration

Use this skill when the user wants to explore Python module boundaries, investigate dependency flow, or enforce layered architecture with grimp.

## Setup

Create the venv and install grimp (requires Python 3.12):

```bash
uv venv ~/.claude/skills/grimp-architecture/.venv --python 3.12
uv pip install grimp --python ~/.claude/skills/grimp-architecture/.venv/bin/python
```

## Quick Start

Scripts are in `~/.claude/skills/grimp-architecture/scripts/` with a pre-configured venv:

```bash
# Shorthand
GRIMP_PY=~/.claude/skills/grimp-architecture/.venv/bin/python
GRIMP_SCRIPTS=~/.claude/skills/grimp-architecture/scripts
```

1. **Explore the graph** (fan-in/out, top-level structure):
   ```bash
   $GRIMP_PY $GRIMP_SCRIPTS/explore.py mypackage
   ```
2. **Trace a boundary leak** (shortest import chain):
   ```bash
   $GRIMP_PY $GRIMP_SCRIPTS/path.py mypackage.validation mypackage.orchestrator
   ```
3. **Optional layer check** (ordered high -> low):
   ```bash
   $GRIMP_PY $GRIMP_SCRIPTS/layers.py --layer mypackage.api --layer mypackage.domain --layer mypackage.infra
   ```
4. **Incremental enforcement** (baseline + diff):
   ```bash
   $GRIMP_PY $GRIMP_SCRIPTS/layers.py --layer mypackage.api --layer mypackage.domain --layer mypackage.infra --json > .grimp-baseline.json
   $GRIMP_PY $GRIMP_SCRIPTS/diff.py --baseline .grimp-baseline.json --layer mypackage.api --layer mypackage.domain --layer mypackage.infra
   ```

## Scripts

- `explore.py <package> [--top N]`: summarize structure, fan-in/out, and child packages.
- `path.py <importer> <imported>`: shortest import chain between modules/packages.
- `layers.py --layer ...`: find illegal dependencies for an ordered layer list.
- `diff.py --baseline ... --layer ...`: fail only on *new* layer violations.

All scripts accept `--include-external` to include external packages in the graph.

## Guidance

- **Explore first**: run `explore.py` before defining layers so you understand how the code is organized.
- **Use path tracing** to confirm suspicious dependencies before reporting them.
- **Layer checks are optional** unless the repo already defines layers or the review clearly proposes them.
- **Baseline + diff** is the safest way to enforce architecture incrementally in large codebases.

## Packaging Expectations

Grimp needs the project to be importable by package name (not file paths).

- Use a normal package layout with `__init__.py` files.
- For `src/` layouts, add `src` to `PYTHONPATH` or install the project.
- Editable installs are fine for local exploration.

Sanity check:
```bash
python -c "import mypackage; print(mypackage.__file__)"
```

Common options:
```bash
uv sync
uv pip install -e .
PYTHONPATH=src $GRIMP_PY $GRIMP_SCRIPTS/explore.py mypackage
```

## Notes

- **Python 3.12 is required** - grimp has compatibility issues with Python 3.14+.
- The skill venv at `~/.claude/skills/grimp-architecture/.venv` has grimp pre-installed.
- For advanced grimp features (closed layers, non-independent siblings, containers), use a custom Python snippet.
