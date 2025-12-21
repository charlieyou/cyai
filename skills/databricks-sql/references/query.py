#!/usr/bin/env python3
"""
Execute SQL queries against Databricks SQL Warehouses.
Saves results to /tmp as CSV.

Requires:
- databricks-sdk: pip install databricks-sdk
- ~/.databrickscfg with host and sql_warehouse_id (token optional if using other auth)

Usage:
    python query.py "SELECT * FROM catalog.schema.table LIMIT 10"

Then explore:
    head -5 /tmp/query_result.csv
    wc -l /tmp/query_result.csv
"""

import argparse
import configparser
import csv
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

try:
    from databricks.sdk import WorkspaceClient
    from databricks.sdk.config import Config as SdkConfig
    from databricks.sdk.service.sql import StatementResponse, StatementState
except ImportError:
    print("Error: databricks-sdk not installed. Run: pip install databricks-sdk", file=sys.stderr)
    sys.exit(1)

RESULT_TOO_LARGE_EXIT_CODE = 3


@dataclass
class WorkspaceConfig:
    name: str
    host: str
    token: Optional[str]
    sql_warehouse_id: Optional[str]
    profile: str


def load_config(profile: Optional[str] = None) -> WorkspaceConfig:
    cfg_path = Path.home() / ".databrickscfg"
    if not cfg_path.exists():
        raise RuntimeError(f"Config file not found: {cfg_path}")

    parser = configparser.RawConfigParser()
    parser.read(cfg_path)

    if profile:
        if profile.lower() == "default":
            section = "DEFAULT"
        else:
            sections = {s.lower(): s for s in parser.sections()}
            if profile.lower() not in sections:
                available = ["default"] + sorted(sections.keys())
                raise RuntimeError(f"Profile '{profile}' not found. Available: {', '.join(available)}")
            section = sections[profile.lower()]
    else:
        section = "DEFAULT"

    if section == "DEFAULT":
        items = dict(parser.defaults())
        profile_name = "DEFAULT"
    else:
        items = dict(parser.items(section, raw=True))
        profile_name = section

    host = items.get("host")
    if not host:
        raise RuntimeError(f"No 'host' in [{section}]")

    sql_warehouse_id = items.get("sql_warehouse_id")
    if not sql_warehouse_id:
        raise RuntimeError(f"No 'sql_warehouse_id' in [{section}]")

    return WorkspaceConfig(
        name=profile or "default",
        host=host,
        token=items.get("token"),
        sql_warehouse_id=sql_warehouse_id,
        profile=profile_name,
    )


@dataclass
class QueryResult:
    columns: list[tuple[str, str]]  # [(name, type), ...]
    rows: list[list]


class ResultSizeError(RuntimeError):
    """Raised when results require chunk/external retrieval not implemented here."""


def _result_requires_fetching(response: StatementResponse) -> bool:
    result = getattr(response, "result", None)
    if result:
        if getattr(result, "next_chunk_internal_link", None):
            return True
        if getattr(result, "external_links", None):
            return True
    manifest = getattr(response, "manifest", None)
    if manifest:
        total_chunk_count = getattr(manifest, "total_chunk_count", None)
        if total_chunk_count and total_chunk_count > 1:
            return True
    return False


def execute_sql(sql_query: str, config: WorkspaceConfig, timeout: str = "50s") -> QueryResult:
    """Execute SQL and return columns with types and rows."""
    client = WorkspaceClient(
        config=SdkConfig(
            host=config.host,
            token=config.token,
            profile=config.profile,
            http_timeout_seconds=30,
            retry_timeout_seconds=60,
        )
    )

    response: StatementResponse = client.statement_execution.execute_statement(
        statement=sql_query,
        warehouse_id=config.sql_warehouse_id,
        wait_timeout=timeout,
    )

    if response.status and response.status.state == StatementState.SUCCEEDED:
        if _result_requires_fetching(response):
            raise ResultSizeError(
                "Result set is chunked or stored externally. "
                "This tool only supports inline results; add a LIMIT or implement chunk fetching."
            )
        columns = []
        if response.manifest and response.manifest.schema and response.manifest.schema.columns:
            for col in response.manifest.schema.columns:
                col_type = col.type_text or (col.type_name.value if col.type_name else "unknown")
                columns.append((col.name, col_type))
        rows = response.result.data_array if response.result and response.result.data_array else []
        return QueryResult(columns=columns, rows=rows)

    elif response.status and response.status.state in (StatementState.PENDING, StatementState.RUNNING):
        raise RuntimeError(f"Query timed out after {timeout}")

    elif response.status:
        error = response.status.error.message if response.status.error else "Unknown error"
        raise RuntimeError(f"Query failed: {error}")

    raise RuntimeError("Unknown query status")


def main():
    parser = argparse.ArgumentParser(
        description="Execute SQL on Databricks. Saves CSV to /tmp.",
        epilog="Then use: head -5 /tmp/query_result.csv",
    )
    parser.add_argument("query", help="SQL query to execute")
    parser.add_argument("-p", "--profile", help="Databricks config profile")
    parser.add_argument("-t", "--timeout", default="50s", help="Query timeout (default: 50s)")
    parser.add_argument("-o", "--output", default="query_result.csv", help="Filename in /tmp (default: query_result.csv)")

    args = parser.parse_args()

    try:
        config = load_config(args.profile)
        result = execute_sql(args.query, config, args.timeout)
    except ResultSizeError as e:
        print(f"Warning: {e}", file=sys.stderr)
        sys.exit(RESULT_TOO_LARGE_EXIT_CODE)
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)

    output_path = Path("/tmp") / args.output
    with open(output_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow([name for name, _ in result.columns])
        writer.writerows(result.rows)

    print(f"Wrote {len(result.rows)} rows to {output_path}")
    print(f"Columns: {', '.join(f'{name} ({typ})' for name, typ in result.columns)}")


if __name__ == "__main__":
    main()
