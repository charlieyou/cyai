#!/usr/bin/env python3
"""
Monitor a running Databricks SQL statement by statement_id.

Usage:
    python monitor_query.py <statement_id>
    python monitor_query.py -p dev <statement_id>
"""

import argparse
import configparser
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

try:
    from databricks.sdk import WorkspaceClient
    from databricks.sdk.config import Config as SdkConfig
    from databricks.sdk.service.sql import StatementState
    from databricks.sdk.errors import NotFound
except ImportError:
    print("Error: databricks-sdk not installed. Run: pip install databricks-sdk", file=sys.stderr)
    sys.exit(1)


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

    return WorkspaceConfig(
        name=profile or "default",
        host=host,
        token=items.get("token"),
        sql_warehouse_id=items.get("sql_warehouse_id"),
        profile=profile_name,
    )


def get_statement_status(client: WorkspaceClient, statement_id: str) -> tuple[str, Optional[str]]:
    """Get current status of a statement. Returns (state, error_message)."""
    response = client.statement_execution.get_statement(statement_id)
    state = response.status.state.value if response.status and response.status.state else "UNKNOWN"
    error = None
    if response.status and response.status.error:
        error = response.status.error.message
    return state, error


def monitor_statement(statement_id: str, config: WorkspaceConfig, poll_interval: int = 10, max_polls: int = 60):
    """Poll statement status until complete or max_polls reached."""
    client = WorkspaceClient(
        config=SdkConfig(
            host=config.host,
            token=config.token,
            profile=config.profile,
            http_timeout_seconds=30,
        )
    )

    print(f"Monitoring statement: {statement_id}")
    print(f"Polling every {poll_interval}s (max {max_polls} polls)")
    print("-" * 50)

    for i in range(max_polls):
        try:
            state, error = get_statement_status(client, statement_id)
        except NotFound:
            print(f"Error: Statement {statement_id} not found. It may have expired or never existed.")
            return "NOT_FOUND"

        timestamp = time.strftime("%H:%M:%S")

        if state in ("SUCCEEDED", "FAILED", "CANCELED", "CLOSED"):
            print(f"[{timestamp}] Final state: {state}")
            if error:
                print(f"Error: {error}")
            return state

        print(f"[{timestamp}] State: {state} (poll {i + 1}/{max_polls})")
        time.sleep(poll_interval)

    print(f"Stopped polling after {max_polls} attempts. Query may still be running.")
    return None


def main():
    parser = argparse.ArgumentParser(
        description="Monitor a running Databricks SQL statement.",
        epilog="Use this after a query times out to check its status.",
    )
    parser.add_argument("statement_id", help="Statement ID to monitor")
    parser.add_argument("-p", "--profile", help="Databricks config profile")
    parser.add_argument("-i", "--interval", type=int, default=10, help="Poll interval in seconds (default: 10)")
    parser.add_argument("-n", "--max-polls", type=int, default=60, help="Max number of polls (default: 60)")

    args = parser.parse_args()

    try:
        config = load_config(args.profile)
        final_state = monitor_statement(args.statement_id, config, args.interval, args.max_polls)
        if final_state == "SUCCEEDED":
            sys.exit(0)
        elif final_state in ("FAILED", "CANCELED", "CLOSED"):
            sys.exit(1)
        else:
            sys.exit(2)
    except RuntimeError as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
