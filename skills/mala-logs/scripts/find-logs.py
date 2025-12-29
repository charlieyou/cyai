#!/usr/bin/env python3
"""Find mala/claude logs by various criteria.

Usage:
  find-logs.py sessions [--repo PATH] [--recent N] [--after DATE]
  find-logs.py runs [--repo PATH] [--recent N]
  find-logs.py session SESSION_ID [--repo PATH]
  find-logs.py issue ISSUE_ID [--repo PATH]
  find-logs.py search PATTERN [--repo PATH] [--recent N]

Examples:
  find-logs.py sessions --recent 5
  find-logs.py session 8ebf0b25-370c-40cc-8de2-8fb13ab62dd4
  find-logs.py issue mala-51q.1
  find-logs.py search "pytest.*failed"
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime
from pathlib import Path


# All stdlib - no external dependencies needed


def encode_repo_path(repo_path: Path) -> str:
    """Encode repo path to match Claude SDK naming convention."""
    resolved = repo_path.resolve()
    return "-" + "-".join(resolved.parts[1:])


def get_claude_config_dir() -> Path:
    return Path(os.environ.get("CLAUDE_CONFIG_DIR", str(Path.home() / ".claude")))


def get_mala_runs_dir() -> Path:
    return Path(os.environ.get("MALA_RUNS_DIR", str(Path.home() / ".config/mala/runs")))


def get_session_logs_dir(repo_path: Path) -> Path:
    encoded = encode_repo_path(repo_path)
    return get_claude_config_dir() / "projects" / encoded


def get_run_metadata_dir(repo_path: Path) -> Path:
    encoded = encode_repo_path(repo_path)
    return get_mala_runs_dir() / encoded


def list_sessions(repo_path: Path, recent: int = 10, after: str | None = None) -> list[dict]:
    """List recent session logs."""
    logs_dir = get_session_logs_dir(repo_path)
    if not logs_dir.exists():
        return []

    sessions = []
    for f in logs_dir.glob("*.jsonl"):
        stat = f.stat()
        mtime = datetime.fromtimestamp(stat.st_mtime)
        if after and mtime.isoformat() < after:
            continue
        sessions.append({
            "session_id": f.stem,
            "path": str(f),
            "modified": mtime.isoformat(),
            "size_kb": stat.st_size // 1024,
        })

    sessions.sort(key=lambda x: x["modified"], reverse=True)
    return sessions[:recent] if recent else sessions


def list_runs(repo_path: Path, recent: int = 10) -> list[dict]:
    """List mala run metadata files."""
    runs_dir = get_run_metadata_dir(repo_path)
    if not runs_dir.exists():
        return []

    runs = []
    for f in runs_dir.glob("*.json"):
        try:
            with open(f) as fh:
                data = json.load(fh)
            runs.append({
                "run_id": data.get("run_id", f.stem),
                "path": str(f),
                "started_at": data.get("started_at", ""),
                "issues": list(data.get("issues", {}).keys()),
                "issue_count": len(data.get("issues", {})),
            })
        except (json.JSONDecodeError, KeyError):
            continue

    runs.sort(key=lambda x: x["started_at"], reverse=True)
    return runs[:recent] if recent else runs


def find_session(session_id: str, repo_path: Path) -> dict | None:
    """Find a specific session by ID."""
    logs_dir = get_session_logs_dir(repo_path)
    log_file = logs_dir / f"{session_id}.jsonl"
    if not log_file.exists():
        return None

    stat = log_file.stat()
    return {
        "session_id": session_id,
        "path": str(log_file),
        "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
        "size_kb": stat.st_size // 1024,
    }


def find_issue_logs(issue_id: str, repo_path: Path) -> list[dict]:
    """Find logs for a specific issue from run metadata."""
    runs_dir = get_run_metadata_dir(repo_path)
    if not runs_dir.exists():
        return []

    results = []
    for f in sorted(runs_dir.glob("*.json"), reverse=True):
        try:
            with open(f) as fh:
                data = json.load(fh)
            issues = data.get("issues", {})
            if issue_id in issues:
                issue = issues[issue_id]
                results.append({
                    "run_id": data.get("run_id"),
                    "run_path": str(f),
                    "session_id": issue.get("session_id"),
                    "log_path": issue.get("log_path"),
                    "status": issue.get("status"),
                    "duration_seconds": issue.get("duration_seconds"),
                    "quality_gate": issue.get("quality_gate", {}).get("passed"),
                })
        except (json.JSONDecodeError, KeyError):
            continue

    return results


def search_logs(pattern: str, repo_path: Path, recent: int = 5) -> list[dict]:
    """Search within recent session logs."""
    sessions = list_sessions(repo_path, recent=recent)
    regex = re.compile(pattern, re.IGNORECASE)
    results = []

    for session in sessions:
        path = Path(session["path"])
        matches = []
        try:
            with open(path) as f:
                for i, line in enumerate(f, 1):
                    if regex.search(line):
                        matches.append({"line": i, "preview": line.strip()[:200]})
        except Exception:
            continue

        if matches:
            results.append({
                "session_id": session["session_id"],
                "path": session["path"],
                "match_count": len(matches),
                "matches": matches[:5],  # First 5 matches
            })

    return results


def main():
    parser = argparse.ArgumentParser(description="Find mala/claude logs")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Common parent for --repo
    repo_parent = argparse.ArgumentParser(add_help=False)
    repo_parent.add_argument("--repo", type=Path, default=Path.cwd(), help="Repository path")

    # sessions
    p = subparsers.add_parser("sessions", parents=[repo_parent], help="List session logs")
    p.add_argument("--recent", type=int, default=10, help="Number of recent sessions")
    p.add_argument("--after", type=str, help="Only sessions after this ISO date")

    # runs
    p = subparsers.add_parser("runs", parents=[repo_parent], help="List mala run metadata")
    p.add_argument("--recent", type=int, default=10, help="Number of recent runs")

    # session
    p = subparsers.add_parser("session", parents=[repo_parent], help="Find specific session")
    p.add_argument("session_id", help="Session UUID")

    # issue
    p = subparsers.add_parser("issue", parents=[repo_parent], help="Find logs for issue")
    p.add_argument("issue_id", help="Issue ID (e.g., mala-51q.1)")

    # search
    p = subparsers.add_parser("search", parents=[repo_parent], help="Search in logs")
    p.add_argument("pattern", help="Regex pattern")
    p.add_argument("--recent", type=int, default=5, help="Search in N recent sessions")

    args = parser.parse_args()

    if args.command == "sessions":
        result = list_sessions(args.repo, args.recent, getattr(args, "after", None))
    elif args.command == "runs":
        result = list_runs(args.repo, args.recent)
    elif args.command == "session":
        result = find_session(args.session_id, args.repo)
    elif args.command == "issue":
        result = find_issue_logs(args.issue_id, args.repo)
    elif args.command == "search":
        result = search_logs(args.pattern, args.repo, args.recent)

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
