---
name: grimp-architecture
description: Explore Python import graphs and enforce layered architecture using grimp helper scripts (arch-grimp-*).
---

# Grimp Architecture Exploration

Use this skill when the user wants to explore Python module boundaries, investigate dependency flow, or enforce layered architecture with grimp.

## Quick Start

1. **Explore the graph** (fan-in/out, top-level structure):
   ```bash
   arch-grimp-explore mypackage
   ```
2. **Trace a boundary leak** (shortest import chain):
   ```bash
   arch-grimp-path mypackage.validation mypackage.orchestrator
   ```
3. **Optional layer check** (ordered high -> low):
   ```bash
   arch-grimp-layers --layer mypackage.api --layer mypackage.domain --layer mypackage.infra
   ```
4. **Incremental enforcement** (baseline + diff):
   ```bash
   arch-grimp-layers --layer mypackage.api --layer mypackage.domain --layer mypackage.infra --json > .grimp-baseline.json
   arch-grimp-diff --baseline .grimp-baseline.json --layer mypackage.api --layer mypackage.domain --layer mypackage.infra
   ```

## Helper Scripts

- `arch-grimp-explore <package> [--top N]`: summarize structure, fan-in/out, and child packages.
- `arch-grimp-path <importer> <imported>`: shortest import chain between modules/packages.
- `arch-grimp-layers --layer ...`: find illegal dependencies for an ordered layer list.
- `arch-grimp-diff --baseline ... --layer ...`: fail only on *new* layer violations.

All scripts accept `--include-external` to include external packages in the graph.

## Guidance

- **Explore first**: run `arch-grimp-explore` before defining layers so you understand how the code is organized.
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
PYTHONPATH=src arch-grimp-explore mypackage
```

Note: the `arch-grimp-*` wrappers auto-install `grimp` in `~/ai-configs/skills/grimp-architecture/.venv`, so no manual `pip install grimp` is needed and all runs share the same venv. You can override the repo root with `AI_CONFIGS_DIR` if the repo is elsewhere.

## Notes

- The `arch-grimp-*` wrappers auto-create `skills/grimp-architecture/.venv`, ensure pip, and install `grimp` if needed.
- For advanced grimp features (closed layers, non-independent siblings, containers), use a custom Python snippet.
- On macOS, the wrappers use Python to resolve symlinks (no `readlink -f` dependency).
