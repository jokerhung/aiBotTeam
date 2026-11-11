"""Approval levels, the read-only command allowlist and the per-engine permission mapping."""
from __future__ import annotations

import os
import re
import shlex
from typing import Literal

ApprovalMode = Literal["ask", "edits", "auto", "full"]
APPROVAL_MODES: list[str] = ["ask", "edits", "auto", "full"]
DEFAULT_APPROVAL_MODE: ApprovalMode = "full"
EDIT_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
SHELL_TOOLS = {"Bash", "PowerShell", "BashOutput"}
OWN_TOOLS = {"mcp__bt__ask_user"}  # our own question tool never needs a permission card

_SAFE = {
    "ls", "dir", "pwd", "cat", "head", "tail", "wc", "echo", "printf", "type", "whoami", "date", "which", "where",
    "grep", "rg", "find", "tree", "stat", "file", "du", "df", "uname", "hostname", "env", "printenv", "sort", "uniq",
    "diff", "basename", "dirname", "realpath", "cut", "tr", "true", "false", "sleep", "id",
}
_SAFE_GIT = {"status", "log", "diff", "show", "branch", "remote", "rev-parse", "ls-files", "blame", "describe", "tag", "config"}
_FIND_UNSAFE = {"-exec", "-execdir", "-delete", "-ok", "-okdir", "-fprint", "-fprintf", "-fls"}
_META = re.compile(r"[;&|`<>\n]|\$\(")


def is_mode(value: object) -> bool:
    return isinstance(value, str) and value in APPROVAL_MODES


def normalize_mode(value: object) -> ApprovalMode:
    """An unset level runs at the default; an unknown persisted value fails closed to ask."""
    if value is None:
        return DEFAULT_APPROVAL_MODE
    return value if is_mode(value) else "ask"  # type: ignore[return-value]


def is_readonly_command(command: object) -> bool:
    """True only for a single simple command from the read-only list: no pipes, redirects, chaining or substitution."""
    if not isinstance(command, str) or not command.strip() or "\0" in command or _META.search(command):
        return False
    try:
        words = shlex.split(command, posix=os.name != "nt")
    except ValueError:
        return False
    if not words:
        return False
    head = os.path.basename(words[0]).lower()
    if head.endswith(".exe"):
        head = head[:-4]
    if head == "git":
        sub = next((w for w in words[1:] if not w.startswith("-")), "")
        if sub == "config":  # reading config only
            return "--get" in words or "--list" in words or "-l" in words
        if sub == "branch" or sub == "tag":
            return all(w.startswith("-") and w in {"-a", "-r", "-v", "-vv", "--list", "-l", "--show-current"} or w == sub or w == "git" for w in words)
        return sub in _SAFE_GIT
    if head == "find":
        return not any(w in _FIND_UNSAFE for w in words)
    if head == "sed" or head == "awk":
        return False
    if head == "env" or head == "printenv":
        return len(words) == 1
    return head in _SAFE


def claude_permission_mode(mode: str) -> str:
    """Claude's own mode per level. Ask and Auto run in `default`: the broker answers whatever the CLI would prompt for."""
    return {"edits": "acceptEdits", "full": "bypassPermissions"}.get(mode, "default")


def codex_sandbox(mode: str) -> str:
    """Codex `exec` has no interactive approvals, so each level maps to the sandbox it may run in."""
    return {"ask": "read-only", "edits": "workspace-write", "auto": "workspace-write", "full": "danger-full-access"}.get(mode, "read-only")


def command_of(tool: str, tool_input: object, cwd: object) -> tuple[str, str] | None:
    """(command, cwd) of a shell request as the CLI sent it, or None when it names no complete command + absolute cwd."""
    if tool not in SHELL_TOOLS or not isinstance(tool_input, dict):
        return None
    cmd = tool_input.get("command")
    if not isinstance(cmd, str) or not cmd.strip() or "\0" in cmd:
        return None
    if not isinstance(cwd, str) or not os.path.isabs(cwd) or "\0" in cwd:
        return None
    return cmd, cwd


def needs_explicit_approval(tool_input: object) -> bool:
    """A request to leave the sandbox is answered by a person; only Full access answers it alone."""
    return isinstance(tool_input, dict) and bool(tool_input.get("dangerouslyDisableSandbox"))
