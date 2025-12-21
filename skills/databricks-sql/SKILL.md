---
name: databricks-sql
description: |
  Execute SQL queries against Databricks SQL Warehouses. Use when user wants to:
  (1) Run ad-hoc SQL queries on Databricks
  (2) Explore table data or run analytics
  (3) Execute DDL/DML statements
  Triggers: "run sql", "query databricks", "select from", "databricks sql", "execute query"
---

# Databricks SQL Query Execution

Execute SQL queries against Databricks SQL Warehouses. Results saved to `/tmp` as CSV.

## Prerequisites

- Python 3.10+
- `databricks-sdk`: `pip install databricks-sdk`
- `~/.databrickscfg` with `host` and `sql_warehouse_id` (token optional if using other auth)

## Configuration

```ini
# ~/.databrickscfg
[DEFAULT]
host = https://your-workspace.cloud.databricks.com
token = your-token
sql_warehouse_id = your-warehouse-id
```

## Usage

```bash
# From installed skill dir (Codex by default; adjust for Claude)
SKILL_DIR="${CODEX_HOME:-$HOME/.codex}/skills/databricks-sql"
# If using Claude Code, replace with: ~/.claude/skills/databricks-sql

# Run query (saves to /tmp/query_result.csv)
python "$SKILL_DIR/references/query.py" "SELECT * FROM catalog.schema.table LIMIT 100"

# Custom output filename
python "$SKILL_DIR/references/query.py" -o users.csv "SELECT * FROM table"

# With profile
python "$SKILL_DIR/references/query.py" -p dev "SELECT COUNT(*) FROM table"
```

## Explore Results

```bash
head -5 /tmp/query_result.csv      # View first rows
wc -l /tmp/query_result.csv        # Count rows
cut -d, -f1,3 /tmp/query_result.csv # Select columns
```

## Large Results / Exit Codes

- This tool only supports inline results. If Databricks returns chunked or external results, it exits with code `3` and prints a warning to stderr.
- To avoid this, add a `LIMIT` or narrow the query, or implement chunk/external fetching.

## References

- [query.py](references/query.py) - SQL execution script
- [examples.md](references/examples.md) - Common SQL patterns
