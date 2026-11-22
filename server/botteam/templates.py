"""Offline agent template library: Apache-2.0 agenticos content plus BotTeam roles."""
from pathlib import Path
import yaml
from .teams import BUILTIN_PRESETS


def load_templates() -> list[dict]:
    rows = []
    for path in sorted(Path(__file__).with_name("templates").glob("*/*.md")):
        _, head, body = path.read_text(encoding="utf8").split("---", 2)
        meta = yaml.safe_load(head)
        rows.append({"id": f"{path.parent.name}--{path.stem}", "name": meta["name"],
                     "description": meta["description"], "industry": meta["industry"],
                     "instructions": body.split("<!-- Source:")[0].strip()})
    rows.extend({**p, "id": f"general--{p['id']}", "industry": "general"} for p in BUILTIN_PRESETS)
    return rows
