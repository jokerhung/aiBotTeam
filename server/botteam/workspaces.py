"""The working folder a bot gets when its maker gives none: `<running dir>/workspaces/<bot id>/` (specs/intake-md.md §5.1).

`BOTTEAM_WORKSPACES` moves the parent folder. When the app is started with a data folder of its own (tests, embedding) the parent is
`<data folder>/workdirs`, so nothing is made in the folder the program happens to run from. The bot's memory lives in `<data>/workspaces/` and
is a different thing: it is never the bot's working folder.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Optional


def workspaces_root(home: Optional[Path] = None, explicit_home: bool = False) -> Path:
    env = os.environ.get("BOTTEAM_WORKSPACES")
    if env:
        return Path(env).expanduser().resolve()
    if explicit_home and home is not None:
        return (Path(home) / "workdirs").resolve()
    return (Path.cwd() / "workspaces").resolve()


def workspace_for(root: Path, bot_id: str) -> Path:
    """The folder of one bot, made if it is not there. The id is made by the server; anything else is cleaned all the same."""
    return ensure_dir(root / re.sub(r"[^A-Za-z0-9_-]", "_", bot_id))


def ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    return path
