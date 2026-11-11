"""Instances: engine configs -> live drivers, with detection and a model catalog. A broken engine is unavailable, never fatal."""
from __future__ import annotations

import json
import os
import shutil
from dataclasses import dataclass, field
from typing import Any, Optional

from .config import ConfigStore
from .drivers.base import Listener
from .drivers.claude import CLAUDE_MODELS, ClaudeDriver
from .drivers.codex import codex_models
from .drivers.codex_app import CodexAppDriver
from .drivers.echo import EchoDriver
from .drivers.openai_compat import OpenAICompatDriver
from .drivers.proc import run_text
from .store import new_id


# Write-only API keys. `env` keys feed a CLI engine's environment; `base` keys light up an OpenAI-compatible endpoint.
KEY_CATALOG: list[dict] = [
    {"id": "anthropic", "label": "Anthropic", "purpose": "Claude API key for the Claude Code engine", "env": ("claude", "ANTHROPIC_API_KEY")},
    {"id": "openai", "label": "OpenAI", "purpose": "OpenAI models and the Codex engine", "env": ("codex", "OPENAI_API_KEY"), "base": "https://api.openai.com/v1"},
    {"id": "openrouter", "label": "OpenRouter", "purpose": "Many models behind one key", "base": "https://openrouter.ai/api/v1"},
    {"id": "groq", "label": "Groq", "purpose": "Fast open-model inference", "base": "https://api.groq.com/openai/v1"},
    {"id": "deepseek", "label": "DeepSeek", "purpose": "DeepSeek chat models", "base": "https://api.deepseek.com/v1"},
    {"id": "mistral", "label": "Mistral", "purpose": "Mistral models", "base": "https://api.mistral.ai/v1"},
    {"id": "xai", "label": "xAI", "purpose": "Grok models", "base": "https://api.x.ai/v1"},
]
KEY_IDS = {k["id"] for k in KEY_CATALOG}


def claude_signed_in(code: int, out: str) -> bool | None:
    """`claude auth status` prints JSON with a loggedIn flag; None when the answer cannot be read."""
    if code == -1:
        return None
    try:
        return bool(json.loads(out).get("loggedIn"))
    except ValueError:
        return False if "not logged in" in out.lower() else (True if code == 0 else None)


@dataclass
class Instance:
    id: str
    driver_kind: str
    display_name: str
    enabled: bool = True
    hidden: bool = False
    driver: Any = None
    state: str = "unavailable"
    reason: Optional[str] = None
    version: Optional[str] = None
    signed_in: Optional[bool] = None
    models: list[dict] = field(default_factory=list)

    def public(self, caps_only: bool = False) -> dict:
        return {
            "id": self.id, "driver": self.driver_kind, "displayName": self.display_name,
            "enabled": self.enabled, "hidden": self.hidden,
            "snapshot": {"state": self.state, "reason": self.reason, "version": self.version, "signedIn": self.signed_in},
            "models": self.models,
            "capabilities": self.driver.capabilities.as_dict() if self.driver else {},
        }


class Registry:
    def __init__(self, config: ConfigStore, with_echo: bool = True) -> None:
        self.config = config
        self.with_echo = with_echo
        self.instances: dict[str, Instance] = {}
        self._listeners: list[Listener] = []
        self.broker = None  # set by the app: drivers hand its port and token to the MCP bridge
        self.agents = None  # set by the app: the team tools the demo engine can call directly

    def on_event(self, listener: Listener) -> None:
        self._listeners.append(listener)
        for inst in self.instances.values():
            if inst.driver:
                inst.driver.on_event(listener)

    def get(self, instance_id: str) -> Optional[Instance]:
        return self.instances.get(instance_id)

    def default_selection(self) -> dict:
        for inst in self.instances.values():
            if inst.state == "available" and not inst.hidden and inst.enabled and inst.driver_kind != "echo":
                m = next((m for m in inst.models if m.get("default")), inst.models[0] if inst.models else None)
                return {"instanceId": inst.id, "model": m["id"] if m else "default"}
        return {"instanceId": "echo", "model": "echo-1"}

    # ---- loading / detection -----------------------------------------------
    async def load(self) -> None:
        for inst in list(self.instances.values()):
            if inst.driver:
                await inst.driver.stop_all()
        self.instances.clear()
        await self._add("claude", "claude", "Claude Code")
        await self._add("codex", "codex", "Codex")
        for iid, cfg in self.config.instances.items():
            if cfg.get("driver") == "openai-compat":
                await self._add(iid, "openai-compat", cfg.get("displayName") or iid)
        if self.with_echo:
            await self._add("echo", "echo", "Echo (demo)")
        await self.sync_keys()

    async def check(self, instance_id: str) -> Optional[Instance]:
        old = self.instances.get(instance_id)
        if not old:
            return None
        if old.driver:
            await old.driver.stop_all()
        return await self._add(old.id, old.driver_kind, old.display_name)

    async def _add(self, iid: str, kind: str, name: str) -> Instance:
        cfg = self.config.instances.get(iid, {})
        inst = Instance(iid, kind, cfg.get("displayName") or name, enabled=cfg.get("enabled", True), hidden=cfg.get("hidden", False))
        try:
            await self._detect(inst, cfg)
        except Exception as e:  # an unknown or broken driver degrades to "unavailable"
            inst.state, inst.reason = "unavailable", f"{type(e).__name__}: {e}"
        if inst.driver:
            for fn in self._listeners:
                inst.driver.on_event(fn)
        self.instances[iid] = inst
        for k in KEY_CATALOG:  # a re-detected CLI engine gets its saved key back
            if "env" in k and k["env"][0] == iid and isinstance(getattr(inst.driver, "env", None), dict):
                value = self.config.secret(f"key:{k['id']}")
                if value:
                    inst.driver.env[k["env"][1]] = value
        return inst

    async def _detect(self, inst: Instance, cfg: dict) -> None:
        kind = inst.driver_kind
        if kind == "echo":
            inst.driver, inst.state, inst.version = EchoDriver(broker=self.broker, agents=self.agents), "available", "0.1.0"
            inst.models = [{"id": "echo-1", "label": "Echo 1", "default": True}]
        elif kind in ("claude", "codex"):
            binary = cfg.get("path") or shutil.which(kind)
            if not binary or not os.path.exists(binary):
                inst.state, inst.reason = "unavailable", f"{kind} CLI not found on PATH"
                inst.models = CLAUDE_MODELS if kind == "claude" else codex_models()
                return
            code, out = await run_text([binary, "--version"])
            if code != 0:
                inst.state, inst.reason = "unavailable", out or "could not run --version"
                return
            inst.version = out.splitlines()[0] if out else None
            if kind == "claude":
                inst.driver = ClaudeDriver(binary, broker=self.broker)
                inst.models = CLAUDE_MODELS
                code, out = await run_text([binary, "auth", "status"], timeout=10)
                inst.signed_in = claude_signed_in(code, out)
            else:
                inst.driver = CodexAppDriver(binary, broker=self.broker)
                inst.models = codex_models()
                code, out = await run_text([binary, "login", "status"], timeout=10)
                inst.signed_in = None if code == -1 else (code == 0 and "logged in" in out.lower())
            inst.state = "available"
            if inst.signed_in is False:
                inst.reason = f"Sign in with `{kind} login`"
        elif kind == "openai-compat":
            base = cfg.get("baseUrl")
            if not base:
                inst.state, inst.reason = "unavailable", "No base URL configured"
                return
            drv = OpenAICompatDriver(base, self.config.secret(f"instance:{inst.id}"))
            inst.driver, inst.state = drv, "available"
            inst.models = [{"id": m, "label": m} for m in cfg.get("models", [])]
            if not inst.models:
                try:
                    inst.models = await drv.list_models()
                except Exception as e:
                    inst.reason = f"Could not list models: {e}"
            if inst.models:
                inst.models[0] = {**inst.models[0], "default": True}
        else:
            inst.state, inst.reason = "unavailable", f"Unknown driver {kind!r}"

    # ---- api keys -------------------------------------------------------------
    def key_status(self) -> dict[str, dict]:
        """Which keys are saved. Never the value, not even a fragment of it."""
        return {k["id"]: {"configured": bool(self.config.secret(f"key:{k['id']}"))} for k in KEY_CATALOG}

    async def set_key(self, key_id: str, value: str | None) -> None:
        self.config.set_secret(f"key:{key_id}", (value or "").strip() or None)
        await self.sync_keys(only=key_id)

    async def sync_keys(self, only: str | None = None) -> None:
        """Apply saved keys now: CLI engines get them in their environment, endpoint keys become a live instance."""
        for k in KEY_CATALOG:
            if only and k["id"] != only:
                continue
            value = self.config.secret(f"key:{k['id']}")
            if "env" in k:
                inst = self.instances.get(k["env"][0])
                drv_env = getattr(inst.driver, "env", None) if inst and inst.driver else None
                if isinstance(drv_env, dict):
                    if value:
                        drv_env[k["env"][1]] = value
                    else:
                        drv_env.pop(k["env"][1], None)
            if "base" in k:
                iid = f"key-{k['id']}"
                old = self.instances.pop(iid, None)
                if old and old.driver:
                    await old.driver.stop_all()
                if value:
                    self.config.instances[iid] = {"driver": "openai-compat", "displayName": k["label"], "baseUrl": k["base"], "keyId": k["id"]}
                    self.config.set_secret(f"instance:{iid}", value)
                    await self._add(iid, "openai-compat", k["label"])
                else:
                    self.config.instances.pop(iid, None)
                    self.config.set_secret(f"instance:{iid}", None)
                    self.config.save()

    # ---- user-configured endpoints ------------------------------------------
    async def add_openai_compat(self, name: str, base_url: str, api_key: str | None, models: list[str]) -> Instance:
        iid = new_id("oai")
        self.config.instances[iid] = {"driver": "openai-compat", "displayName": name, "baseUrl": base_url, "models": models}
        if api_key:
            self.config.set_secret(f"instance:{iid}", api_key)
        self.config.save()
        return await self._add(iid, "openai-compat", name)

    def patch(self, iid: str, **fields: Any) -> Optional[Instance]:
        inst = self.instances.get(iid)
        if not inst:
            return None
        cfg = self.config.instances.setdefault(iid, {})
        for k, v in fields.items():
            if v is not None:
                cfg[k] = v
        self.config.save()
        for k in ("enabled", "hidden"):
            if k in fields and fields[k] is not None:
                setattr(inst, k, fields[k])
        return inst

    async def stop_all(self) -> None:
        for inst in self.instances.values():
            if inst.driver:
                await inst.driver.stop_all()
