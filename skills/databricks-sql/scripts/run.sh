#!/usr/bin/env bash
# Auto-bootstrapping wrapper for query.py
# Creates venv and installs deps if needed

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
VENV_DIR="$SKILL_DIR/.venv"
PYTHON="$VENV_DIR/bin/python"

# Bootstrap venv if missing
if [[ ! -f "$PYTHON" ]]; then
    echo "Bootstrapping venv..." >&2
    uv venv "$VENV_DIR" --quiet 2>/dev/null || python3 -m venv "$VENV_DIR"
    "$VENV_DIR/bin/pip" install -q databricks-sdk
fi

exec "$PYTHON" "$SCRIPT_DIR/query.py" "$@"
