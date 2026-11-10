"""config.json: instance settings and write-only secrets. Secrets are never returned by the API."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from .store import data_dir


class ConfigStore:
    def __init__(self, path: Path | None = None) -> None:
        self.path = path or data_dir() / "config.json"
        self.data: dict[str, Any] = {"instances": {}, "secrets": {}}
        if self.path.exists():
            try:
                self.data.update(json.loads(self.path.read_text(encoding="utf8")))
            except (OSError, ValueError):
                pass

    def save(self) -> None:
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=2), encoding="utf8")
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        os.replace(tmp, self.path)

    @property
    def instances(self) -> dict[str, dict[str, Any]]:
        return self.data.setdefault("instances", {})

    def secret(self, name: str) -> str | None:
        return self.data.setdefault("secrets", {}).get(name)

    def set_secret(self, name: str, value: str | None) -> None:
        s = self.data.setdefault("secrets", {})
        if value:
            s[name] = value
        else:
            s.pop(name, None)
        self.save()
