#!/usr/bin/env python3
"""
bd-parallel: Agent SDK orchestrator for parallel beads issue processing.

Usage:
    bd-parallel run [OPTIONS] [REPO_PATH]
    bd-parallel clean
"""

import asyncio
import subprocess
import json
import os
import sys
import uuid
from pathlib import Path
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any

import typer
from claude_agent_sdk import (
    ClaudeSDKClient,
    ClaudeAgentOptions,
    AssistantMessage,
    ResultMessage,
    TextBlock,
    ToolUseBlock,
    ToolResultBlock,
)

from .filelock import LOCK_DIR, release_all_locks

# JSONL log directory
JSONL_LOG_DIR = Path("/tmp/bd-parallel-logs/jsonl")

# Load implementer prompt from file
PROMPT_FILE = Path(__file__).parent / "implementer_prompt.md"
IMPLEMENTER_PROMPT_TEMPLATE = PROMPT_FILE.read_text()

app = typer.Typer(
    name="bd-parallel",
    help="Parallel beads issue processing with Claude Agent SDK",
    add_completion=False,
)


# Claude Code style colors
class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    CYAN = "\033[36m"
    RED = "\033[31m"
    GRAY = "\033[90m"


def log(icon: str, message: str, color: str = Colors.RESET, dim: bool = False):
    """Claude Code style logging."""
    style = Colors.DIM if dim else ""
    timestamp = datetime.now().strftime("%H:%M:%S")
    print(f"{Colors.GRAY}{timestamp}{Colors.RESET} {style}{color}{icon} {message}{Colors.RESET}")


def log_tool(tool_name: str, description: str = ""):
    """Log tool usage in Claude Code style."""
    icon = "⚙"
    desc = f" {Colors.DIM}{description}{Colors.RESET}" if description else ""
    print(f"  {Colors.CYAN}{icon} {tool_name}{Colors.RESET}{desc}")


def log_result(success: bool, message: str):
    """Log result in Claude Code style."""
    if success:
        print(f"  {Colors.GREEN}✓ {message}{Colors.RESET}")
    else:
        print(f"  {Colors.RED}✗ {message}{Colors.RESET}")


class JSONLLogger:
    """Claude Code style JSONL logger for full message logging."""

    def __init__(self, session_id: str, cwd: Path):
        self.session_id = session_id
        self.cwd = cwd
        JSONL_LOG_DIR.mkdir(parents=True, exist_ok=True)
        self.log_path = JSONL_LOG_DIR / f"{session_id}.jsonl"
        self.file = open(self.log_path, "w")
        self.parent_uuid: str | None = None
        self.message_count = 0

    def _write(self, entry: dict[str, Any]):
        """Write a JSON entry as a line."""
        self.file.write(json.dumps(entry, default=str) + "\n")
        self.file.flush()

    def log_message(self, message: Any, message_type: str = "assistant"):
        """Log a full message from the SDK."""
        msg_uuid = str(uuid.uuid4())
        timestamp = datetime.now().isoformat() + "Z"

        entry: dict[str, Any] = {
            "parentUuid": self.parent_uuid,
            "sessionId": self.session_id,
            "cwd": str(self.cwd),
            "type": message_type,
            "uuid": msg_uuid,
            "timestamp": timestamp,
        }

        # Handle different message types from SDK
        if isinstance(message, AssistantMessage):
            content = []
            for block in message.content:
                if isinstance(block, TextBlock):
                    content.append({"type": "text", "text": block.text})
                elif isinstance(block, ToolUseBlock):
                    content.append({
                        "type": "tool_use",
                        "id": getattr(block, "id", f"tool_{self.message_count}"),
                        "name": block.name,
                        "input": block.input,  # Full params, not truncated
                    })
                elif isinstance(block, ToolResultBlock):
                    content.append({
                        "type": "tool_result",
                        "tool_use_id": getattr(block, "tool_use_id", None),
                        "content": block.content,
                    })
            entry["message"] = {
                "role": "assistant",
                "content": content,
            }
        elif isinstance(message, ResultMessage):
            entry["message"] = {
                "role": "result",
                "result": message.result,
            }
        else:
            # Raw message
            entry["message"] = message

        self._write(entry)
        self.parent_uuid = msg_uuid
        self.message_count += 1

    def log_user_prompt(self, prompt: str):
        """Log the initial user prompt."""
        msg_uuid = str(uuid.uuid4())
        timestamp = datetime.now().isoformat() + "Z"

        entry = {
            "parentUuid": None,
            "sessionId": self.session_id,
            "cwd": str(self.cwd),
            "type": "user",
            "uuid": msg_uuid,
            "timestamp": timestamp,
            "message": {
                "role": "user",
                "content": prompt,
            },
        }
        self._write(entry)
        self.parent_uuid = msg_uuid

    def close(self):
        self.file.close()


@dataclass
class IssueResult:
    """Result from a single issue implementation."""

    issue_id: str
    agent_id: str
    success: bool
    summary: str
    duration_seconds: float = 0.0


class BdParallelOrchestrator:
    """Orchestrates parallel beads issue processing using Claude Agent SDK."""

    def __init__(
        self,
        repo_path: Path,
        max_agents: int = 3,
        timeout_minutes: int = 30,
    ):
        self.repo_path = repo_path.resolve()
        self.max_agents = max_agents
        self.timeout_seconds = timeout_minutes * 60

        self.active_tasks: dict[str, asyncio.Task] = {}
        self.agent_ids: dict[str, str] = {}
        self.completed: list[IssueResult] = []
        self.failed_issues: set[str] = set()

    def get_ready_issues(self) -> list[str]:
        """Get list of ready issue IDs via bd CLI."""
        result = subprocess.run(
            ["bd", "ready", "--json"],
            capture_output=True,
            text=True,
            cwd=self.repo_path,
        )
        if result.returncode != 0:
            log("⚠", f"bd ready failed: {result.stderr}", Colors.YELLOW)
            return []
        try:
            issues = json.loads(result.stdout)
            return [i["id"] for i in issues if i["id"] not in self.failed_issues]
        except json.JSONDecodeError:
            return []

    def claim_issue(self, issue_id: str) -> bool:
        """Claim an issue by setting status to in_progress."""
        result = subprocess.run(
            ["bd", "update", issue_id, "--status", "in_progress"],
            capture_output=True,
            text=True,
            cwd=self.repo_path,
        )
        return result.returncode == 0

    def reset_issue(self, issue_id: str):
        """Reset failed issue to ready status."""
        subprocess.run(
            ["bd", "update", issue_id, "--status", "ready"],
            capture_output=True,
            text=True,
            cwd=self.repo_path,
        )

    def _cleanup_agent_locks(self, agent_id: str):
        """Remove locks held by a specific agent (crash/timeout cleanup)."""
        if not LOCK_DIR.exists():
            return

        cleaned = 0
        for lock in LOCK_DIR.glob("*.lock"):
            try:
                if lock.is_file() and lock.read_text().strip() == agent_id:
                    lock.unlink()
                    cleaned += 1
            except OSError:
                pass

        if cleaned:
            log("🧹", f"Cleaned {cleaned} locks for {agent_id[:8]}", Colors.GRAY, dim=True)

    async def run_implementer(self, issue_id: str) -> IssueResult:
        """Run bd-implementer agent for a single issue."""
        session_id = str(uuid.uuid4())
        agent_id = f"{issue_id}-{session_id[:8]}"
        self.agent_ids[issue_id] = agent_id

        # JSONL logger for full message logging
        jsonl_logger = JSONLLogger(session_id, self.repo_path)

        prompt = IMPLEMENTER_PROMPT_TEMPLATE.format(
            issue_id=issue_id,
            repo_path=self.repo_path,
            lock_dir=LOCK_DIR,
            agent_id=agent_id,
        )

        final_result = ""
        start_time = asyncio.get_event_loop().time()
        success = False

        options = ClaudeAgentOptions(
            cwd=str(self.repo_path),
            permission_mode="acceptEdits",
            model="opus",
            system_prompt={"type": "preset", "preset": "claude_code"},
            setting_sources=["project"],
        )

        try:
            async with asyncio.timeout(self.timeout_seconds):
                async with ClaudeSDKClient(options=options) as client:
                    await client.query(prompt)
                    jsonl_logger.log_user_prompt(prompt)

                    async for message in client.receive_response():
                        # Log full message to JSONL
                        jsonl_logger.log_message(message)

                        # Console output
                        if isinstance(message, AssistantMessage):
                            for block in message.content:
                                if isinstance(block, TextBlock):
                                    text = block.text[:100] + "..." if len(block.text) > 100 else block.text
                                    print(f"    {Colors.DIM}{text}{Colors.RESET}")
                                elif isinstance(block, ToolUseBlock):
                                    log_tool(block.name, str(block.input)[:50])

                        elif isinstance(message, ResultMessage):
                            final_result = message.result or ""

            # Check if issue was closed
            check = subprocess.run(
                ["bd", "show", issue_id, "--json"],
                capture_output=True,
                text=True,
                cwd=self.repo_path,
            )
            if check.returncode == 0:
                try:
                    issue_data = json.loads(check.stdout)
                    # Handle both list and dict responses
                    if isinstance(issue_data, list) and issue_data:
                        issue_data = issue_data[0]
                    if isinstance(issue_data, dict) and issue_data.get("status") == "closed":
                        success = True
                except json.JSONDecodeError:
                    pass

        except TimeoutError:
            final_result = f"Timeout after {self.timeout_seconds // 60} minutes"
            self._cleanup_agent_locks(agent_id)

        except Exception as e:
            final_result = str(e)
            self._cleanup_agent_locks(agent_id)

        finally:
            duration = asyncio.get_event_loop().time() - start_time
            jsonl_logger.close()

            # Ensure locks are cleaned
            self._cleanup_agent_locks(agent_id)
            self.agent_ids.pop(issue_id, None)

        return IssueResult(
            issue_id=issue_id,
            agent_id=agent_id,
            success=success,
            summary=final_result,
            duration_seconds=duration,
        )

    async def spawn_agent(self, issue_id: str) -> bool:
        """Spawn a new agent task for an issue. Returns True if spawned."""
        if not self.claim_issue(issue_id):
            self.failed_issues.add(issue_id)
            log("⚠", f"Failed to claim {issue_id}", Colors.YELLOW)
            return False

        task = asyncio.create_task(self.run_implementer(issue_id))
        self.active_tasks[issue_id] = task
        log("▶", f"Agent started: {Colors.BOLD}{issue_id}{Colors.RESET}", Colors.BLUE)
        return True

    async def run(self) -> int:
        """Main orchestration loop. Returns count of successful issues."""
        print()
        log("●", f"bd-parallel orchestrator", Colors.MAGENTA)
        log("◐", f"repo: {self.repo_path}", Colors.GRAY, dim=True)
        log("◐", f"max-agents: {self.max_agents}, timeout: {self.timeout_seconds // 60}m", Colors.GRAY, dim=True)
        print()

        # Setup directories
        LOCK_DIR.mkdir(exist_ok=True)
        JSONL_LOG_DIR.mkdir(parents=True, exist_ok=True)

        try:
            while True:
                # Fill up to max_agents
                ready = self.get_ready_issues()

                if ready:
                    log("◌", f"Ready issues: {', '.join(ready)}", Colors.GRAY, dim=True)

                while len(self.active_tasks) < self.max_agents and ready:
                    issue_id = ready.pop(0)
                    if issue_id not in self.active_tasks:
                        await self.spawn_agent(issue_id)

                if not self.active_tasks:
                    if not ready:
                        log("○", "No more issues to process", Colors.GRAY)
                    break

                # Wait for ANY task to complete
                log("◌", f"Waiting for {len(self.active_tasks)} agent(s)...", Colors.GRAY, dim=True)

                done, _ = await asyncio.wait(
                    self.active_tasks.values(),
                    return_when=asyncio.FIRST_COMPLETED,
                )

                # Handle completed tasks
                for task in done:
                    for issue_id, t in list(self.active_tasks.items()):
                        if t is task:
                            try:
                                result = task.result()
                            except Exception as e:
                                result = IssueResult(
                                    issue_id=issue_id,
                                    agent_id=self.agent_ids.get(issue_id, "unknown"),
                                    success=False,
                                    summary=str(e),
                                )

                            self.completed.append(result)
                            del self.active_tasks[issue_id]

                            duration_str = f"{result.duration_seconds:.0f}s"
                            if result.success:
                                summary = result.summary[:50] + "..." if len(result.summary) > 50 else result.summary
                                log("✓", f"{issue_id} ({duration_str}): {summary}", Colors.GREEN)
                            else:
                                log("✗", f"{issue_id} ({duration_str}): {result.summary}", Colors.RED)
                                self.failed_issues.add(issue_id)
                                self.reset_issue(issue_id)
                            break

        finally:
            # Final cleanup
            release_all_locks()
            log("🧹", "Released all remaining locks", Colors.GRAY, dim=True)

        # Summary
        print()
        success_count = sum(1 for r in self.completed if r.success)
        total = len(self.completed)

        if success_count == total and total > 0:
            log("●", f"Completed: {success_count}/{total} issues", Colors.GREEN)
        elif success_count > 0:
            log("◐", f"Completed: {success_count}/{total} issues", Colors.YELLOW)
        else:
            log("○", f"Completed: {success_count}/{total} issues", Colors.RED)

        # Commit .beads/issues.jsonl if there were successes
        if success_count > 0:
            result = subprocess.run(
                ["git", "add", ".beads/issues.jsonl"],
                cwd=self.repo_path,
                capture_output=True,
            )
            if result.returncode == 0:
                commit_result = subprocess.run(
                    ["git", "commit", "-m", "beads: close completed issues"],
                    cwd=self.repo_path,
                    capture_output=True,
                )
                if commit_result.returncode == 0:
                    log("◐", "Committed .beads/issues.jsonl", Colors.GRAY, dim=True)

        print()
        return success_count


@app.command()
def run(
    repo_path: Annotated[
        Path,
        typer.Argument(
            help="Path to repository with beads issues",
        ),
    ] = Path("."),
    max_agents: Annotated[
        int,
        typer.Option("--max-agents", "-n", help="Maximum concurrent agents"),
    ] = 3,
    timeout: Annotated[
        int,
        typer.Option("--timeout", "-t", help="Timeout per agent in minutes"),
    ] = 30,
):
    """Run parallel beads issue processing."""
    repo_path = repo_path.resolve()

    if not repo_path.exists():
        log("✗", f"Repository not found: {repo_path}", Colors.RED)
        raise typer.Exit(1)

    orchestrator = BdParallelOrchestrator(
        repo_path=repo_path,
        max_agents=max_agents,
        timeout_minutes=timeout,
    )

    success_count = asyncio.run(orchestrator.run())
    raise typer.Exit(0 if success_count > 0 else 1)


@app.command()
def clean():
    """Clean up locks and JSONL logs."""
    cleaned_locks = 0
    cleaned_logs = 0

    if LOCK_DIR.exists():
        for lock in LOCK_DIR.glob("*.lock"):
            lock.unlink()
            cleaned_locks += 1

    if cleaned_locks:
        log("🧹", f"Removed {cleaned_locks} lock files", Colors.GREEN)

    if JSONL_LOG_DIR.exists():
        log_count = len(list(JSONL_LOG_DIR.glob("*.jsonl")))
        if log_count > 0:
            if typer.confirm(f"Remove {log_count} JSONL log files?"):
                for log_file in JSONL_LOG_DIR.glob("*.jsonl"):
                    log_file.unlink()
                    cleaned_logs += 1
                log("🧹", f"Removed {cleaned_logs} JSONL log files", Colors.GREEN)


@app.command()
def status():
    """Show current orchestrator status."""
    print()
    log("●", "bd-parallel status", Colors.MAGENTA)
    print()

    # Check locks
    if LOCK_DIR.exists():
        locks = list(LOCK_DIR.glob("*.lock"))
        if locks:
            log("⚠", f"{len(locks)} active locks", Colors.YELLOW)
            for lock in locks[:5]:
                try:
                    holder = lock.read_text().strip() if lock.is_file() else "unknown"
                except OSError:
                    holder = "unknown"
                print(f"    {Colors.DIM}{lock.stem} → {holder}{Colors.RESET}")
            if len(locks) > 5:
                print(f"    {Colors.DIM}... and {len(locks) - 5} more{Colors.RESET}")
        else:
            log("○", "No active locks", Colors.GRAY)
    else:
        log("○", "No active locks", Colors.GRAY)

    # Check JSONL logs
    if JSONL_LOG_DIR.exists():
        jsonl_files = list(JSONL_LOG_DIR.glob("*.jsonl"))
        if jsonl_files:
            log("◐", f"{len(jsonl_files)} JSONL logs in {JSONL_LOG_DIR}", Colors.GRAY, dim=True)
            recent = sorted(jsonl_files, key=lambda p: p.stat().st_mtime, reverse=True)[:3]
            for log_file in recent:
                mtime = datetime.fromtimestamp(log_file.stat().st_mtime).strftime("%H:%M:%S")
                print(f"    {Colors.DIM}{mtime} {log_file.name}{Colors.RESET}")
    print()


if __name__ == "__main__":
    app()
