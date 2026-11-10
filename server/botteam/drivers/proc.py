"""Subprocess helpers (Windows-aware): spawn with big stream limits and kill a whole process tree."""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from typing import Sequence

STREAM_LIMIT = 32 * 1024 * 1024  # one stream-json line can carry a large tool result


async def spawn(args: Sequence[str], cwd: str | None = None, env: dict[str, str] | None = None, stdin: bool = True):
    kwargs: dict = {}
    if sys.platform == "win32":
        kwargs["creationflags"] = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
    return await asyncio.create_subprocess_exec(
        *args,
        cwd=cwd,
        env={**os.environ, **(env or {})},
        stdin=asyncio.subprocess.PIPE if stdin else asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        limit=STREAM_LIMIT,
        **kwargs,
    )


async def kill_tree(proc: asyncio.subprocess.Process) -> None:
    if proc.returncode is not None:
        return
    if sys.platform == "win32":
        killer = await asyncio.create_subprocess_exec(
            "taskkill", "/T", "/F", "/PID", str(proc.pid),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NO_WINDOW,
        )
        await killer.wait()
    else:
        try:
            proc.terminate()
        except ProcessLookupError:
            return
        try:
            await asyncio.wait_for(proc.wait(), 3)
        except asyncio.TimeoutError:
            proc.kill()
    try:
        await asyncio.wait_for(proc.wait(), 5)
    except asyncio.TimeoutError:
        pass


async def run_text(args: Sequence[str], timeout: float = 15) -> tuple[int, str]:
    """Run a short command and return (exit code, combined output); (-1, reason) when it cannot run."""
    try:
        proc = await spawn(args, stdin=False)
        out, err = await asyncio.wait_for(proc.communicate(), timeout)
        return proc.returncode or 0, (out + err).decode("utf8", "replace").strip()
    except (OSError, asyncio.TimeoutError) as e:
        return -1, str(e) or type(e).__name__
