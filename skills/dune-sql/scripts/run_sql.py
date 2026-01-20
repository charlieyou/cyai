#!/usr/bin/env python3
"""
Execute direct SQL queries against Dune Analytics.
Saves results to /tmp as CSV.

Requires:
- dune-client: pip install dune-client
- DUNE_API_KEY environment variable
- Dune Plus subscription (for direct SQL)

Usage:
    python run_sql.py "SELECT * FROM ethereum.transactions LIMIT 10"

Then explore:
    head -5 /tmp/dune_result.csv
    wc -l /tmp/dune_result.csv
"""

import argparse
import csv
import os
import sys
from pathlib import Path

try:
    from dune_client.client import DuneClient
    from dune_client.models import ExecutionState
except ImportError:
    print("Error: dune-client not installed. Run: pip install dune-client", file=sys.stderr)
    sys.exit(1)

SKILL_DIR = Path(__file__).parent.parent


def load_api_key() -> str:
    """Load API key from .env file or environment."""
    api_key = os.environ.get("DUNE_API_KEY")
    if api_key:
        return api_key

    env_file = SKILL_DIR / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("DUNE_API_KEY="):
                return line.split("=", 1)[1].strip().strip("\"'")

    raise RuntimeError("DUNE_API_KEY not found in environment or .env file")


def execute_sql(sql_query: str, performance: str = "medium") -> tuple[list[str], list[list]]:
    """Execute SQL and return (columns, rows)."""
    api_key = load_api_key()

    client = DuneClient(api_key=api_key)

    results = client.run_sql(
        query_sql=sql_query,
        performance=performance,
    )

    if results.state != ExecutionState.COMPLETED:
        error_msg = "Query did not complete successfully"
        if results.state == ExecutionState.FAILED:
            error_msg = "Query failed"
        elif results.state == ExecutionState.CANCELLED:
            error_msg = "Query was cancelled"
        raise RuntimeError(error_msg)

    columns = []
    rows = []

    if results.result and results.result.metadata:
        columns = results.result.metadata.column_names or []

    if results.result and results.result.rows:
        for row in results.result.rows:
            rows.append([row.get(col) for col in columns])

    return columns, rows


def main():
    parser = argparse.ArgumentParser(
        description="Execute SQL on Dune Analytics. Saves CSV to /tmp.",
        epilog="Then use: head -5 /tmp/dune_result.csv",
    )
    parser.add_argument("query", help="SQL query to execute")
    parser.add_argument("-o", "--output", default="dune_result.csv", help="Filename in /tmp (default: dune_result.csv)")
    parser.add_argument("-p", "--performance", default="medium", choices=["medium", "large"], help="Performance tier")

    args = parser.parse_args()

    try:
        columns, rows = execute_sql(args.query, args.performance)
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    output_path = Path("/tmp") / args.output
    with open(output_path, "w", newline="") as f:
        writer = csv.writer(f)
        if columns:
            writer.writerow(columns)
        writer.writerows(rows)

    print(f"Wrote {len(rows)} rows to {output_path}")
    if columns:
        print(f"Columns: {', '.join(columns)}")


if __name__ == "__main__":
    main()
