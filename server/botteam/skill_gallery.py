"""Offline, pinned copies of agenticos' industry skill gallery."""
from functools import lru_cache
import json
from pathlib import Path

from .skills import SkillError, parse

ROOT = Path(__file__).parent / "skill_gallery"


@lru_cache(maxsize=1)
def catalog():
    return json.loads((ROOT / "catalog.json").read_text(encoding="utf8"))


def preview(key):
    entry = next((s for s in catalog()["skills"] if s["key"] == key), None)
    if not entry:
        raise SkillError("unknown gallery skill")
    root = ROOT / key
    return {**entry, "content": parse((root / "SKILL.md").read_text(encoding="utf8"))["body"], "files": sorted(p.relative_to(root).as_posix() for p in root.rglob("*") if p.is_file() and p.name != "SKILL.md")}
