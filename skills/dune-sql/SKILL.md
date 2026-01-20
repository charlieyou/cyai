---
name: querying-dune
description: |
  Executes SQL queries on Dune Analytics and writes results as CSV to /tmp.
  Use when the user needs blockchain data from Dune or wants to run a saved Dune query by ID.
  Triggers: "dune query", "dune sql", "query dune", "blockchain data"
compatibility: Python 3.10+, Bash, DUNE_API_KEY in .env or environment
---

# Dune SQL

## Dune Documentation Reference

If there is any uncertainty about how to run a query or what data is available: use Web tools to find the answer in the Dune docs:
* [Data Catalog](https://docs.dune.com/data-catalog/overview)
* [Query Engine Reference](https://docs.dune.com/query-engine/overview)

## Running Direct SQL (Plus Feature)

Run `scripts/run.sh` to execute SQL:

```bash
SKILL_DIR="$HOME/.agents/skills/dune-sql"

# Basic query (saves to /tmp/dune_result.csv)
"$SKILL_DIR/scripts/run.sh" "SELECT * FROM ethereum.transactions LIMIT 100"

# Custom output filename
"$SKILL_DIR/scripts/run.sh" -o txns.csv "SELECT * FROM ethereum.blocks LIMIT 10"

# Large performance tier
"$SKILL_DIR/scripts/run.sh" -p large "SELECT * FROM ethereum.transactions LIMIT 1000"
```

## Running Saved Queries by ID

Run `scripts/query.sh` to execute a saved query:

```bash
# Run a saved query by ID
"$SKILL_DIR/scripts/query.sh" 1215383

# With custom output
"$SKILL_DIR/scripts/query.sh" -o my_query.csv 1215383

# With parameters (JSON format, types inferred)
"$SKILL_DIR/scripts/query.sh" --params '{"token": "USDC", "min_amount": 1000}' 1215383
```

## Exit Codes

- `0` → Query succeeded, CSV written
- `1` → Error (SQL error, API error, config error)
- `2` → Query timed out or failed

## References

**Scripts:**
- [scripts/run.sh](scripts/run.sh) - Direct SQL (auto-bootstraps venv)
- [scripts/query.sh](scripts/query.sh) - Saved queries (auto-bootstraps venv)

**Documentation:**
- [references/query-engine.md](references/query-engine.md) - DuneSQL overview, Trino basis, optimization
- [references/data-types.md](references/data-types.md) - varbinary, uint256, timestamps, conversions
- [references/functions.md](references/functions.md) - bytearray, date/time, aggregates, window functions
- [references/tables.md](references/tables.md) - Raw tables, decoded tables, curated spellbook tables
- [references/examples.md](references/examples.md) - Comprehensive query examples
