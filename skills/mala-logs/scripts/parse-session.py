#!/usr/bin/env python3
"""Parse and analyze a Claude session log.

Usage:
  parse-session.py PATH [--summary] [--tools] [--errors] [--text]
  parse-session.py PATH --tools --filter Bash
  parse-session.py PATH --tools --limit 10

Examples:
  parse-session.py ~/.claude/projects/-home-cyou-mala/abc123.jsonl --summary
  parse-session.py session.jsonl --tools
  parse-session.py session.jsonl --tools --filter Bash --limit 5
  parse-session.py session.jsonl --errors
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path


# All stdlib - no external dependencies needed


def parse_content_block(block: dict) -> dict | None:
    """Parse a content block from a message."""
    block_type = block.get("type")

    if block_type == "text":
        return {"type": "text", "text": block.get("text", "")}
    elif block_type == "tool_use":
        return {
            "type": "tool_use",
            "id": block.get("id"),
            "name": block.get("name"),
            "input": block.get("input", {}),
        }
    elif block_type == "tool_result":
        return {
            "type": "tool_result",
            "tool_use_id": block.get("tool_use_id"),
            "is_error": block.get("is_error", False),
            "content_preview": str(block.get("content", ""))[:200],
        }
    return None


def parse_log_entry(data: dict) -> dict | None:
    """Parse a JSONL log entry."""
    entry_type = data.get("type")
    message = data.get("message", {})

    # Handle role-based format
    if entry_type is None and isinstance(message, dict):
        entry_type = message.get("role")

    if entry_type not in ("assistant", "user"):
        # Metadata entries (queue-operation, etc.)
        return {"type": entry_type, "meta": True}

    content = message.get("content", [])
    if isinstance(content, str):
        content = [{"type": "text", "text": content}]

    blocks = [parse_content_block(b) for b in content if isinstance(b, dict)]
    blocks = [b for b in blocks if b is not None]

    return {
        "type": entry_type,
        "timestamp": data.get("timestamp"),
        "session_id": data.get("sessionId"),
        "blocks": blocks,
    }


def analyze_session(path: Path) -> dict:
    """Analyze a session log file."""
    entries = []
    tool_uses = []
    tool_results = []
    errors = []
    text_blocks = []

    with open(path) as f:
        for line_num, line in enumerate(f, 1):
            try:
                data = json.loads(line)
                entry = parse_log_entry(data)
                if entry:
                    entries.append(entry)
                    for block in entry.get("blocks", []):
                        if block["type"] == "tool_use":
                            tool_uses.append({
                                "line": line_num,
                                "name": block["name"],
                                "id": block["id"],
                                "input": block["input"],
                            })
                        elif block["type"] == "tool_result":
                            tool_results.append({
                                "line": line_num,
                                "tool_use_id": block["tool_use_id"],
                                "is_error": block["is_error"],
                                "preview": block["content_preview"],
                            })
                            if block["is_error"]:
                                errors.append({
                                    "line": line_num,
                                    "tool_use_id": block["tool_use_id"],
                                    "preview": block["content_preview"],
                                })
                        elif block["type"] == "text":
                            text_blocks.append({
                                "line": line_num,
                                "text": block["text"][:500],
                            })
            except json.JSONDecodeError:
                continue

    tool_counts = Counter(t["name"] for t in tool_uses)

    return {
        "path": str(path),
        "entry_count": len(entries),
        "tool_use_count": len(tool_uses),
        "tool_result_count": len(tool_results),
        "error_count": len(errors),
        "tool_frequency": dict(tool_counts.most_common()),
        "tool_uses": tool_uses,
        "errors": errors,
        "text_blocks": text_blocks,
    }


def main():
    parser = argparse.ArgumentParser(description="Parse Claude session log")
    parser.add_argument("path", type=Path, help="Path to .jsonl log file")
    parser.add_argument("--summary", action="store_true", help="Show summary only")
    parser.add_argument("--tools", action="store_true", help="List tool uses")
    parser.add_argument("--errors", action="store_true", help="Show errors only")
    parser.add_argument("--text", action="store_true", help="Show text blocks")
    parser.add_argument("--filter", type=str, help="Filter tools by name (with --tools)")
    parser.add_argument("--limit", type=int, help="Limit number of results")

    args = parser.parse_args()

    if not args.path.exists():
        print(f"File not found: {args.path}", file=sys.stderr)
        sys.exit(1)

    analysis = analyze_session(args.path)

    if args.summary:
        print(json.dumps({
            "path": analysis["path"],
            "entries": analysis["entry_count"],
            "tool_uses": analysis["tool_use_count"],
            "errors": analysis["error_count"],
            "tool_frequency": analysis["tool_frequency"],
        }, indent=2))
    elif args.tools:
        tools = analysis["tool_uses"]
        if args.filter:
            tools = [t for t in tools if args.filter.lower() in t["name"].lower()]
        if args.limit:
            tools = tools[:args.limit]
        print(json.dumps(tools, indent=2))
    elif args.errors:
        errors = analysis["errors"]
        if args.limit:
            errors = errors[:args.limit]
        print(json.dumps(errors, indent=2))
    elif args.text:
        texts = analysis["text_blocks"]
        if args.limit:
            texts = texts[:args.limit]
        print(json.dumps(texts, indent=2))
    else:
        print(json.dumps(analysis, indent=2))


if __name__ == "__main__":
    main()
