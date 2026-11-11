"""Backing up and restoring the data folder as one zip.

The databases are copied with SQLite's own backup call (a consistent snapshot even while the server runs); everything else is copied as
files. Restoring refuses to write over a folder that already holds data unless told to, and never writes outside the folder.
"""
from __future__ import annotations

import os
import sqlite3
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path

SKIP_DIRS = {"mcp-run", "skill-run", "__pycache__"}
DB_SUFFIXES = (".db",)
SIDE_SUFFIXES = (".db-wal", ".db-shm", ".db-journal")


class BackupError(ValueError):
    pass


def _snapshot(db: Path, dest: Path) -> None:
    src = sqlite3.connect(f"file:{db.as_posix()}?mode=ro", uri=True)
    try:
        out = sqlite3.connect(dest)
        try:
            src.backup(out)
        finally:
            out.close()
    finally:
        src.close()


def make_backup(data: Path, dest: Path) -> dict:
    """A zip of the data folder at `dest`; returns {files, bytes}."""
    if not data.exists():
        raise BackupError("there is no data folder to back up")
    dest.parent.mkdir(parents=True, exist_ok=True)
    files = 0
    with tempfile.TemporaryDirectory() as tmp, zipfile.ZipFile(dest, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(data.rglob("*")):
            rel = path.relative_to(data)
            if path.is_dir() or any(p in SKIP_DIRS for p in rel.parts) or path.name.endswith(SIDE_SUFFIXES) or path.name.startswith(".tmp-") or path.resolve() == dest.resolve():
                continue
            src = path
            if path.suffix in DB_SUFFIXES:
                src = Path(tmp) / f"{files}.db"
                _snapshot(path, src)
            z.write(src, rel.as_posix())
            files += 1
        z.writestr("BACKUP.txt", f"BotTeam backup made {datetime.now().isoformat(timespec='seconds')}\nfiles: {files}\n")
    return {"files": files, "bytes": dest.stat().st_size}


def restore(zip_path: Path, data: Path, force: bool = False) -> dict:
    """Unpack a backup into the data folder. Without `force` the folder must hold no data yet."""
    if not zipfile.is_zipfile(zip_path):
        raise BackupError("that is not a backup file")
    if data.exists() and any(data.iterdir()) and not force:
        raise BackupError("the data folder already holds data; stop the server and use --force to replace it")
    root = data.resolve()
    with zipfile.ZipFile(zip_path) as z:
        names = [n for n in z.namelist() if n != "BACKUP.txt" and not n.endswith("/")]
        if "messages.db" not in names:
            raise BackupError("that backup has no messages database")
        for n in names:  # a name that leads outside the folder is refused before anything is written
            target = (root / n).resolve()
            if root not in target.parents:
                raise BackupError(f"the backup names a file outside the data folder: {n}")
        if data.exists() and force:
            for old in sorted(data.rglob("*"), reverse=True):
                if old.is_file() or old.is_symlink():
                    old.unlink()
                elif old.is_dir():
                    try:
                        old.rmdir()
                    except OSError:
                        pass
        data.mkdir(parents=True, exist_ok=True)
        for n in names:
            target = root / n
            target.parent.mkdir(parents=True, exist_ok=True)
            with z.open(n) as src, open(target, "wb") as out:
                out.write(src.read())
            if os.name != "nt":
                os.chmod(target, 0o600)
    return {"files": len(names)}
