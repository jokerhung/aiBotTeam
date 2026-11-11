"""Skills: SKILL.md files (frontmatter + instructions) in a library, given to bots and switched on or off.

    <data>/skills/<id>/SKILL.md      ---\\nname: ...\\ndescription: ...\\n---\\n<instructions>
    <data>/skills/<id>/meta.json     {"enabled": true}

For the Claude CLI a turn gets a directory with `.claude/skills/<id>/SKILL.md` for the skills the bot has and that are on (added with
--add-dir); another engine is given the same instructions in its system prompt.
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Optional

from .memory import write_atomic

FRONT = re.compile(r"\A---\s*\n(.*?)\n---\s*\n?(.*)\Z", re.S)
MAX_BODY = 40_000


class SkillError(ValueError):
    pass


def parse(text: str) -> dict:
    """{name, description, body} from a SKILL.md; a file without frontmatter is all body."""
    m = FRONT.match(text.replace("\r\n", "\n"))
    meta: dict[str, str] = {}
    body = text
    if m:
        body = m.group(2)
        for ln in m.group(1).split("\n"):
            if ":" in ln:
                k, v = ln.split(":", 1)
                meta[k.strip()] = v.strip().strip("\"'")
    return {"name": meta.get("name", ""), "description": meta.get("description", ""), "body": body.strip()}


def render(name: str, description: str, body: str) -> str:
    esc = lambda s: s.replace("\n", " ").strip()
    return f"---\nname: {esc(name)}\ndescription: {esc(description)}\n---\n{body.strip()}\n"


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48] or "skill"


class Skills:
    def __init__(self, home: Path) -> None:
        self.dir = home / "skills"
        self.run = home / "skill-run"

    def _path(self, sid: str) -> Path:
        if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,47}", sid):
            raise SkillError("unknown skill")
        return self.dir / sid

    def _meta(self, sid: str) -> dict:
        try:
            return json.loads((self._path(sid) / "meta.json").read_text(encoding="utf8"))
        except (OSError, ValueError):
            return {}

    def list(self) -> list[dict]:
        if not self.dir.exists():
            return []
        out = []
        for d in sorted(self.dir.iterdir()):
            f = d / "SKILL.md"
            if f.is_file():
                s = parse(f.read_text(encoding="utf8"))
                out.append({"id": d.name, "name": s["name"] or d.name, "description": s["description"], "body": s["body"], "enabled": self._meta(d.name).get("enabled", True)})
        return out

    def get(self, sid: str) -> Optional[dict]:
        return next((s for s in self.list() if s["id"] == sid), None)

    def save(self, sid: Optional[str], name: str, description: str, body: str, enabled: Optional[bool] = None) -> dict:
        name, description = name.strip(), description.strip()
        if not name or len(name) > 80:
            raise SkillError("a skill needs a name of up to 80 characters")
        if len(body) > MAX_BODY:
            raise SkillError("the instructions are too long")
        if sid is None:
            base, sid, n = slug(name), slug(name), 2
            while (self.dir / sid).exists():
                sid, n = f"{base}-{n}", n + 1
        d = self._path(sid)
        write_atomic(d / "SKILL.md", render(name, description, body))
        meta = self._meta(sid)
        if enabled is not None:
            meta["enabled"] = bool(enabled)
        write_atomic(d / "meta.json", json.dumps({"enabled": meta.get("enabled", True)}))
        return self.get(sid) or {}

    def delete(self, sid: str) -> bool:
        d = self._path(sid)
        if not d.exists():
            return False
        shutil.rmtree(d)
        return True

    def for_bot(self, bot_skills: list[str]) -> list[dict]:
        """The skills this bot has that are switched on."""
        have = {s["id"]: s for s in self.list()}
        return [have[i] for i in bot_skills if i in have and have[i]["enabled"]]

    def turn_dir(self, thread_id: str, skills: list[dict]) -> Optional[str]:
        """A directory with the skills in the layout the Claude CLI reads, for this turn; None when there are none."""
        if not skills:
            return None
        root = self.run / re.sub(r"[^\w-]", "_", thread_id)
        shutil.rmtree(root, ignore_errors=True)
        for s in skills:
            write_atomic(root / ".claude" / "skills" / s["id"] / "SKILL.md", render(s["name"], s["description"], s["body"]))
        return str(root)

    def cleanup(self, thread_id: str) -> None:
        shutil.rmtree(self.run / re.sub(r"[^\w-]", "_", thread_id), ignore_errors=True)

    @staticmethod
    def as_text(skills: list[dict]) -> str:
        """The skills as instructions for an engine that has no skills directory."""
        if not skills:
            return ""
        return "\n\nSkills you have (follow the one that fits the task):\n" + "\n\n".join(f"## {s['name']}\n{s['description']}\n{s['body']}" for s in skills)[:12000]
