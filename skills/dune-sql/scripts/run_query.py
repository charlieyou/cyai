#!/usr/bin/env python3
"""
Execute saved Dune queries by ID.
Saves results to /tmp as CSV.

Requires:
- dune-client: pip install dune-client
- DUNE_API_KEY environment variable

Usage:
    python run_query.py 1215383
    python run_query.py --params '{"token": "USDC"}' 1215383

Then explore:
    head -5 /tmp/dune_result.csv
    wc -l /tmp/dune_result.csv
"""

import argparse
import csv
import json
import os
import sys
from pathlib import Path

try:
    from dune_client.client import DuneClient
    from dune_client.models import ExecutionState
    from dune_client.query import QueryBase
    from dune_client.types import QueryParameter
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


def parse_params(params_json: str | None) -> list[QueryParameter]:
    """Parse JSON params into QueryParameter objects."""
    if not params_json:
        return []

    params_dict = json.loads(params_json)
    result = []

    for name, value in params_dict.items():
        if isinstance(value, str):
            # Check if it looks like an ISO date
            if len(value) >= 10 and value[4] == "-" and value[7] == "-":
                result.append(QueryParameter.date_type(name=name, value=value))
            else:
                result.append(QueryParameter.text_type(name=name, value=value))
        elif isinstance(value, (int, float)):
            result.append(QueryParameter.number_type(name=name, value=value))
        elif isinstance(value, list):
            result.append(QueryParameter.enum_type(name=name, value=value))
        else:
            result.append(QueryParameter.text_type(name=name, value=str(value)))

    return result


def execute_query(query_id: int, params: list[QueryParameter], performance: str = "medium") -> tuple[list[str], list[list]]:
    """Execute query by ID and return (columns, rows)."""
    api_key = load_api_key()

    client = DuneClient(api_key=api_key)

    query = QueryBase(query_id=query_id, params=params if params else None)

    results = client.run_query(
        query=query,
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
        description="Execute saved Dune query by ID. Saves CSV to /tmp.",
        epilog="Then use: head -5 /tmp/dune_result.csv",
    )
    parser.add_argument("query_id", type=int, help="Dune query ID")
    parser.add_argument("-o", "--output", default="dune_result.csv", help="Filename in /tmp (default: dune_result.csv)")
    parser.add_argument("-p", "--performance", default="medium", choices=["medium", "large"], help="Performance tier")
    parser.add_argument("--params", help="Query parameters as JSON object")

    args = parser.parse_args()

    try:
        params = parse_params(args.params)
        columns, rows = execute_query(args.query_id, params, args.performance)
    except json.JSONDecodeError as e:
        print(f"Error parsing params JSON: {e}", file=sys.stderr)
        sys.exit(1)
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
