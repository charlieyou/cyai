---
name: databricks-sql
description: |
  Execute SQL queries against Databricks SQL Warehouses.

  Use when the user wants to:
  - Run ad-hoc SQL queries on Databricks
  - Explore table data or run analytics
  - Execute DDL/DML statements

  Triggers: "run sql", "query databricks", "select from", "databricks sql", "execute query"
compatibility: |
  Python 3.10+, Bash, ~/.databrickscfg with host and sql_warehouse_id
---

# Databricks SQL Query Execution

Execute SQL queries against Databricks SQL Warehouses. Results saved to `/tmp` as CSV.

- `run.sh` → execute SQL and write results to `/tmp/<filename>.csv`
- `monitor.sh` → monitor a long-running statement by `statement_id` (status only, no results)

> **For long-running queries: do not retry on timeout.** Use `monitor.sh` to track completion.

## Prerequisites

- Databricks workspace with SQL Warehouse
- `~/.databrickscfg` with `host` and `sql_warehouse_id`
- Python 3.10+ and Bash

> The wrapper scripts auto-create a venv and install `databricks-sdk`. No manual pip install needed.

```ini
# ~/.databrickscfg
[DEFAULT]
host = https://your-workspace.cloud.databricks.com
token = your-token
sql_warehouse_id = your-warehouse-id
```

## Running Queries

```bash
SKILL_DIR="$HOME/.agents/skills/databricks-sql"

# Basic query (saves to /tmp/query_result.csv)
"$SKILL_DIR/scripts/run.sh" "SELECT * FROM catalog.schema.table LIMIT 100"

# Custom output filename
"$SKILL_DIR/scripts/run.sh" -o users.csv "SELECT * FROM table"

# With profile
"$SKILL_DIR/scripts/run.sh" -p dev "SELECT COUNT(*) FROM table"

# Custom timeout (default: 50s, range: 5s-50s)
"$SKILL_DIR/scripts/run.sh" -t 30s "SELECT * FROM table"
```

## Exploring Results

```bash
head -5 /tmp/query_result.csv       # View first rows
wc -l /tmp/query_result.csv         # Count rows
cut -d, -f1,3 /tmp/query_result.csv # Select columns
```

## Large Results

This tool only supports inline results. If Databricks returns chunked or external results:
- Exits with code `3`
- Add a `LIMIT` or narrow the query

## Query Timeouts

**IMPORTANT: If a query times out, DO NOT run it again.**

The query continues executing on the warehouse. Retrying wastes resources and causes duplicate work.

On timeout, the script outputs:
```
Error: Query timed out after 50s. Statement ID: <statement_id>
DO NOT RETRY - query continues running on warehouse.
Monitor with: python monitor_query.py <statement_id>
```

**Agent behavior on timeout:**
1. Parse the `statement_id` from the error
2. Call `monitor.sh` with that `statement_id`
3. Do NOT resubmit the query while it's running
4. Once monitor reports `SUCCEEDED`, re-run the exact same query—Databricks returns the cached result

## Monitoring Queries

Use after a timeout to track query status:

```bash
# Monitor a timed-out query
"$SKILL_DIR/scripts/monitor.sh" <statement_id>

# Custom poll interval (default: 10s) and max polls (default: 60)
"$SKILL_DIR/scripts/monitor.sh" -i 30 -n 20 <statement_id>

# With profile
"$SKILL_DIR/scripts/monitor.sh" -p dev <statement_id>
```

Polls until: `SUCCEEDED`, `FAILED`, `CANCELED`, `CLOSED`, or max polls reached.

**Note:** `monitor.sh` only reports status. It does not download results.

## Exit Codes

**run.sh:**
- `0` → Query succeeded, CSV written
- `1` → Error (SQL error, timeout, config error)
- `3` → Result too large for inline retrieval

**monitor.sh:**
- `0` → Statement completed with `SUCCEEDED`
- `1` → Statement `FAILED`, `CANCELED`, `CLOSED`, or config error
- `2` → Max polls reached, query may still be running

## References

- [run.sh](scripts/run.sh) - Query wrapper (auto-bootstraps venv)
- [monitor.sh](scripts/monitor.sh) - Monitor wrapper (auto-bootstraps venv)
- [examples.md](references/examples.md) - Common SQL patterns
