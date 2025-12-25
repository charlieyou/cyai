#!/usr/bin/env python3
"""
bd-coder: Agent SDK orchestrator for parallel beads issue processing.

Usage:
    bd-coder run [OPTIONS] [REPO_PATH]
    bd-coder clean
"""

import asyncio
import subprocess
import json
import uuid
from pathlib import Path
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Annotated, Any

from dotenv import load_dotenv
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
from claude_agent_sdk.types import (
    HookMatcher,
    PreToolUseHookInput,
    HookContext,
    SyncHookJSONOutput,
)

from .filelock import LOCK_DIR, release_all_locks
from .braintrust_integration import init_braintrust, TracedAgentExecution

# JSONL log directory
JSONL_LOG_DIR = Path("/tmp/bd-coder-logs/jsonl")

# Load implementer prompt from file
PROMPT_FILE = Path(__file__).parent / "implementer_prompt.md"
IMPLEMENTER_PROMPT_TEMPLATE = PROMPT_FILE.read_text()

# Dangerous bash command patterns to block
DANGEROUS_PATTERNS = [
    "rm -rf /",
    "rm -rf ~",
    "rm -rf $HOME",
    ":(){:|:&};:",  # fork bomb
    "mkfs.",
    "dd if=",
    "> /dev/sd",
    "chmod -R 777 /",
    "curl | bash",
    "wget | bash",
    "curl | sh",
    "wget | sh",
]


async def block_dangerous_commands(
    hook_input: PreToolUseHookInput,
    stderr: str | None,
    context: HookContext,
) -> SyncHookJSONOutput:
    """PreToolUse hook to block dangerous bash commands."""
    if hook_input["tool_name"] != "Bash":
        return {}  # Allow non-Bash tools

    command = hook_input["tool_input"].get("command", "")

    # Block dangerous patterns
    for pattern in DANGEROUS_PATTERNS:
        if pattern in command:
            return {
                "decision": "block",
                "reason": f"Blocked dangerous command pattern: {pattern}",
            }

    # Block force push to main/master
    if "git push" in command and ("--force" in command or "-f" in command):
        if "main" in command or "master" in command:
            return {
                "decision": "block",
                "reason": "Blocked force push to main/master branch",
            }

    return {}  # Allow the command


app = typer.Typer(
    name="bd-coder",
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


def get_git_branch(cwd: Path) -> str:
    """Get the current git branch name."""
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5,
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return ""


class JSONLLogger:
    """Claude Code style JSONL logger for full message logging."""

    def __init__(self, session_id: str, cwd: Path):
        self.session_id = session_id
        self.cwd = cwd
        self.git_branch = get_git_branch(cwd)
        JSONL_LOG_DIR.mkdir(parents=True, exist_ok=True)
        self.log_path = JSONL_LOG_DIR / f"{session_id}.jsonl"
        self.file = open(self.log_path, "w")
        self.parent_uuid: str | None = None
        self.message_count = 0

    def _write(self, entry: dict[str, Any]):
        """Write a JSON entry as a line."""
        self.file.write(json.dumps(entry, default=str) + "\n")
        self.file.flush()

    def _get_timestamp(self) -> str:
        """Get current timestamp in ISO 8601 UTC format with milliseconds."""
        return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"

    def log_message(self, message: Any, message_type: str = "assistant"):
        """Log a full message from the SDK.

        Follows Claude Code JSONL format:
        - Assistant messages contain: text, tool_use, thinking blocks
        - User messages contain: tool_result blocks (logged separately)
        """
        msg_uuid = str(uuid.uuid4())
        timestamp = self._get_timestamp()

        base_entry: dict[str, Any] = {
            "uuid": msg_uuid,
            "parentUuid": self.parent_uuid,
            "type": message_type,
            "timestamp": timestamp,
            "sessionId": self.session_id,
            "cwd": str(self.cwd),
            "gitBranch": self.git_branch,
        }

        # Handle different message types from SDK
        if isinstance(message, AssistantMessage):
            assistant_content = []
            tool_results = []

            for block in message.content:
                if isinstance(block, TextBlock):
                    assistant_content.append({"type": "text", "text": block.text})
                elif isinstance(block, ToolUseBlock):
                    assistant_content.append({
                        "type": "tool_use",
                        "id": getattr(block, "id", f"tool_{self.message_count}"),
                        "name": block.name,
                        "input": block.input,  # Full params, not truncated
                    })
                elif isinstance(block, ToolResultBlock):
                    # Tool results are logged as separate "user" type entries
                    tool_use_id = getattr(block, "tool_use_id", None)
                    is_error = getattr(block, "is_error", False)
                    tool_result_entry: dict[str, Any] = {
                        "type": "tool_result",
                        "tool_use_id": tool_use_id,
                        "content": block.content,
                    }
                    if is_error:
                        tool_result_entry["is_error"] = True
                    tool_results.append(tool_result_entry)

            # Log assistant content if present
            if assistant_content:
                msg_id = getattr(message, "id", None) or f"msg_{self.message_count}"
                entry = base_entry.copy()
                entry["message"] = {
                    "id": msg_id,
                    "content": assistant_content,
                }
                self._write(entry)
                self.parent_uuid = msg_uuid
                self.message_count += 1

            # Log tool results as separate "user" type entries
            for tool_result in tool_results:
                result_uuid = str(uuid.uuid4())
                result_entry = {
                    "uuid": result_uuid,
                    "parentUuid": self.parent_uuid,
                    "type": "user",
                    "timestamp": self._get_timestamp(),
                    "sessionId": self.session_id,
                    "cwd": str(self.cwd),
                    "gitBranch": self.git_branch,
                    "message": {
                        "content": [tool_result],
                    },
                }
                self._write(result_entry)
                self.parent_uuid = result_uuid
                self.message_count += 1

            return  # Already handled writing

        elif isinstance(message, ResultMessage):
            # ResultMessage maps to turn_end in Claude Code spec
            base_entry["type"] = "turn_end"
            base_entry["message"] = {
                "result": message.result,
            }
        else:
            # Raw message
            base_entry["message"] = message

        self._write(base_entry)
        self.parent_uuid = msg_uuid
        self.message_count += 1

    def log_user_prompt(self, prompt: str):
        """Log the initial user prompt."""
        msg_uuid = str(uuid.uuid4())
        timestamp = self._get_timestamp()

        entry = {
            "uuid": msg_uuid,
            "parentUuid": None,
            "type": "user",
            "timestamp": timestamp,
            "sessionId": self.session_id,
            "cwd": str(self.cwd),
            "gitBranch": self.git_branch,
            "message": {
                "content": [
                    {"type": "text", "text": prompt}
                ],
            },
        }
        self._write(entry)
        self.parent_uuid = msg_uuid
        self.message_count += 1

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
            permission_mode="bypassPermissions",
            model="opus",
            system_prompt={"type": "preset", "preset": "claude_code"},
            setting_sources=["project", "user"],
            hooks={
                "PreToolUse": [
                    HookMatcher(matcher=None, hooks=[block_dangerous_commands])
                ]
            },
        )

        # Braintrust tracing context
        tracer = TracedAgentExecution(
            issue_id=issue_id,
            agent_id=agent_id,
            metadata={
                "session_id": session_id,
                "repo_path": str(self.repo_path),
                "timeout_seconds": self.timeout_seconds,
            },
        )

        try:
            with tracer:
                tracer.log_input(prompt)

                try:
                    async with asyncio.timeout(self.timeout_seconds):
                        async with ClaudeSDKClient(options=options) as client:
                            await client.query(prompt)
                            jsonl_logger.log_user_prompt(prompt)

                            async for message in client.receive_response():
                                # Log full message to JSONL
                                jsonl_logger.log_message(message)

                                # Log to Braintrust
                                tracer.log_message(message)

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

                    # Check if issue was closed (inside tracer context)
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

                    tracer.set_success(success)

                except TimeoutError:
                    final_result = f"Timeout after {self.timeout_seconds // 60} minutes"
                    tracer.set_error(final_result)
                    self._cleanup_agent_locks(agent_id)

                except Exception as e:
                    final_result = str(e)
                    tracer.set_error(final_result)
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
        log("●", "bd-coder orchestrator", Colors.MAGENTA)
        log("◐", f"repo: {self.repo_path}", Colors.GRAY, dim=True)
        log("◐", f"max-agents: {self.max_agents}, timeout: {self.timeout_seconds // 60}m", Colors.GRAY, dim=True)

        # Initialize Braintrust tracing
        if init_braintrust(project_name="bd-coder"):
            log("◐", "braintrust: enabled", Colors.CYAN, dim=True)
        else:
            log("◐", "braintrust: disabled (set BRAINTRUST_API_KEY to enable)", Colors.GRAY, dim=True)
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

    # Load environment variables from the target repo's .env (if present)
    load_dotenv(dotenv_path=repo_path / ".env")

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
    log("●", "bd-coder status", Colors.MAGENTA)
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
