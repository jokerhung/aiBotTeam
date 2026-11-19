"""`intake.md`: how a bot receives what people send it (specs/intake-md.md).

One file in the bot's working folder says when a session of messages runs (after N quiet seconds, or on the Check button), where its photos are
saved (a path template), what the sender is told, and what the bot is asked to do. `machines.md` lists the machines a caption may name.

Everything here is pure: reading, checking, filling templates, matching a caption to a machine, and writing the two files safely. The chat
service decides when to call it.
"""
from __future__ import annotations

import difflib
import hashlib
import json
import os
import re
import tempfile
import time
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import yaml

FILE = "intake.md"
MACHINES = "machines.md"
NAMES = (FILE, MACHINES)
FORMAT = "botteam.intake"
MAX_INTAKE = 64 * 1024
MAX_MACHINES = 256 * 1024
MAX_MACHINE_LINES = 2000
RECHECK_SECONDS = 1.0
PATH_VARS = {"session", "date", "time", "dd", "mm", "yyyy", "chat", "machine", "code", "area", "phase"}
ACK_VARS = {"session", "date", "time", "dd", "mm", "yyyy", "chat", "machine", "code", "area", "phase", "folder", "folders", "out", "summary", "photos", "saved", "skipped", "skipped_note", "texts", "quietSeconds", "remaining", "hintAfterSeconds"}
PROMPT_VARS = ACK_VARS | {"sender"}
COMMAND_VARS = (PATH_VARS - {"phase"}) | {"python", "workdir", "machine_folder"}
CMD_NOT_READY = 3  # the exit code of a command that should be tried again later (what it fetches is not there yet)
DEFAULT_PATH = "jobs/{session}/"
DEFAULT_ACK = "Đã nhận {photos} ảnh. Sẽ xử lý sau {quietSeconds} giây nếu không có thêm."
DEFAULT_PROMPT = ("Phiên {session}: {photos} ảnh và {texts} tin nhắn mới đã lưu trong {folder}. Làm tiếp theo chỉ dẫn của bạn. "
                  "File kết quả cần gửi lại thì ghi vào {out}.")
DEFAULT_HINT = "Nếu không còn ảnh nào thì sau {remaining} giây sẽ tiến hành."
DEFAULT_REPLY = "Đã nhận đủ {photos} ảnh và lưu vào folder:\n{summary}"
DEFAULT_LIMITS = {"maxPhotos": 40, "timeoutSec": 900, "retentionDays": 60}


class IntakeError(Exception):
    """A file that cannot be used, or a path that would leave the working folder."""

    def __init__(self, message: str, line: Optional[int] = None) -> None:
        super().__init__(message)
        self.line = line


# ---- the default file ---------------------------------------------------------------------------------------------------------------
def _q(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)  # a JSON string is a YAML double-quoted string


BODY_COLLECT = """# Quy trình nhận tin

Bot này nhận ảnh và tin nhắn từ Telegram/Zalo. Khi {quiet} giây không có gì mới, ảnh được lưu vào
jobs/<mã phiên>/ và bot làm tiếp theo chỉ dẫn của nó.

Sửa phần giữa hai dòng `---` để đổi quy trình. Phần này (sau dòng `---` thứ hai) được gửi cho bot mỗi lần chạy.
"""
BODY_ANSWER = """# Quy trình nhận tin

Bot này trả lời từng tin nhắn gửi tới nó, ngay trong cuộc trò chuyện đó.

Sửa phần giữa hai dòng `---` để đổi quy trình.
"""


def default_text(mode: str = "collect", prompt: Optional[str] = None, limits: Optional[dict] = None, quiet: int = 30) -> str:
    """The file made when a bot is given an input. `answer` is the old "Answer every message"; `prompt` and `limits` carry an older grant's values over."""
    lim = {**DEFAULT_LIMITS, **{k: v for k, v in (limits or {}).items() if k in DEFAULT_LIMITS and v}}
    remind = (limits or {}).get("remindAt") or ""
    if mode == "answer":
        return (f"---\nformat: {FORMAT}\nversion: 1\nmode: answer          # collect: gom rồi chạy | answer: trả lời từng tin\n"
                f"trigger:\n  quietSeconds: 0\nlimits:\n  timeoutSec: {lim['timeoutSec']}\n---\n{BODY_ANSWER}")
    run_prompt = prompt.strip() if prompt and prompt.strip() else DEFAULT_PROMPT
    return (f"---\nformat: {FORMAT}\nversion: 1\nmode: collect                 # collect: gom rồi chạy | answer: trả lời từng tin\n"
            f"trigger:\n  quietSeconds: {quiet}            # tự chạy khi {quiet} giây không có ảnh hoặc tin nhắn mới\n"
            f"  button: true                # vẫn cho bấm 🔍 Kiểm kê (hoặc gõ /kiemke) để chạy ngay\n"
            f"save:\n  path: {_q(DEFAULT_PATH)}     # ảnh lưu vào <thư mục làm việc>/jobs/<session_id>/\n"
            f"ack: {_q(DEFAULT_ACK)}\nrun:\n  prompt: {_q(run_prompt)}\n"
            f"limits:\n  maxPhotos: {lim['maxPhotos']}\n  timeoutSec: {lim['timeoutSec']}\n  retentionDays: {lim['retentionDays']}\n"
            + (f"  remindAt: {_q(remind)}\n" if remind else "") + "---\n" + BODY_COLLECT.format(quiet=quiet))


MACHINES_SAMPLE = """# Danh sách máy

| Tên chuẩn  | Mã máy     | Tên gọi khác        |
|------------|------------|---------------------|
| BH FLEX M1 | 1000000342 | flex m1, may flex 1 |
"""


def legacy_prompt(old: str) -> str:
    """An older grant's prompt with its `{job}` folders turned into `{folder}`."""
    s = old or ""
    for a, b in ((r"\{job\}/images/?", "{folder}"), (r"\{job\}/files/?", "{folder}"), (r"\{job\}/out/", "{out}"), (r"\{job\}/out\b", "{out}"),
                 (r"\{job\}/", "{folder}"), (r"\{job\}", "{folder}")):
        s = re.sub(a, b, s)
    return s


# ---- checking a file ----------------------------------------------------------------------------------------------------------------
@dataclass
class Machine:
    name: str
    code: str = ""
    aliases: list[str] = field(default_factory=list)
    area: str = ""  # the column "Khu vực": a folder level such as Vĩnh Phúc


@dataclass
class State:
    path: str = ""
    exists: bool = False
    valid: bool = False
    error: str = ""
    line: Optional[int] = None
    warnings: list[str] = field(default_factory=list)
    cfg: Optional[dict] = None  # the checked settings: of this file, or of the last good one
    machines: list[Machine] = field(default_factory=list)
    using_last_good: bool = False
    hash: str = ""

    @property
    def usable(self) -> bool:
        return self.cfg is not None

    def public(self) -> dict:
        return {"path": FILE, "exists": self.exists, "valid": self.valid, "error": self.error or None, "line": self.line, "warnings": self.warnings,
                "usingLastGood": self.using_last_good, "summary": summary(self.cfg) if self.cfg else "", "effective": self.cfg}


def digest(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()[:16]


def _split(text: str) -> tuple[Optional[str], str]:
    """The text between the first two `---` lines, and what follows."""
    lines = text.lstrip("﻿").splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return None, text
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            return "".join(lines[1:i]), "".join(lines[i + 1:])
    return None, text


def _find_line(front: str, *keys: str) -> int:
    """The line (counted in the whole file, whose first `---` is line 1) where the last of `keys` is written; 1 when it is not."""
    want = keys[-1]
    for i, ln in enumerate(front.splitlines(), start=2):
        if re.match(rf"^\s*{re.escape(want)}\s*:", ln):
            return i
    return 1


def _template_vars(tpl: str) -> set[str]:
    return set(re.findall(r"\{(\w+)\}", tpl))


def parse_machines(text: str) -> list[Machine]:
    """The machines of a Markdown table. Columns are found by their titles, not their order."""
    if len(text.encode("utf8")) > MAX_MACHINES or text.count("\n") > MAX_MACHINE_LINES:
        raise IntakeError(f"{MACHINES} is too large (256 KB or 2,000 lines at most)")
    rows = [[c.strip() for c in ln.strip().strip("|").split("|")] for ln in text.splitlines() if ln.strip().startswith("|")]
    rows = [r for r in rows if not all(re.fullmatch(r":?-{2,}:?", c) or not c for c in r)]
    if not rows:
        raise IntakeError(f"{MACHINES} has no table of machines")
    head = [fold(c) for c in rows[0]]
    name_i = next((i for i, h in enumerate(head) if h in ("ten chuan", "ten", "name", "machine")), None)
    if name_i is None:
        raise IntakeError(f"{MACHINES}: the first column of the table must be titled “Tên chuẩn”", 1)
    code_i = next((i for i, h in enumerate(head) if h in ("ma may", "ma", "code", "id")), None)
    alias_i = next((i for i, h in enumerate(head) if h in ("ten goi khac", "goi khac", "alias", "aliases")), None)
    area_i = next((i for i, h in enumerate(head) if h in ("khu vuc", "area", "region", "khu")), None)
    out: list[Machine] = []
    for r in rows[1:]:
        name = r[name_i].strip() if name_i < len(r) else ""
        if not name:
            continue
        code = r[code_i].strip() if code_i is not None and code_i < len(r) else ""
        aliases = [a.strip() for a in r[alias_i].split(",") if a.strip()] if alias_i is not None and alias_i < len(r) else []
        area = r[area_i].strip() if area_i is not None and area_i < len(r) else ""
        out.append(Machine(name, code, aliases, area))
    if not out:
        raise IntakeError(f"{MACHINES} lists no machine")
    return out


def parse(text: str, machines_text: Optional[str] = None) -> State:
    """Check an `intake.md` (and the `machines.md` its path needs). Never raises: the verdict is in the returned state."""
    st = State(exists=True)
    try:
        st.cfg = _parse(text, machines_text, st)
        st.valid = True
    except IntakeError as e:
        st.error, st.line, st.cfg = str(e), e.line, None
    return st


def _parse(text: str, machines_text: Optional[str], st: State) -> dict:
    if len(text.encode("utf8")) > MAX_INTAKE:
        raise IntakeError(f"{FILE} is too large (64 KB at most)")
    front, body = _split(text)
    if front is None:
        raise IntakeError(f"{FILE} must start with a block between two lines of ---", 1)
    try:
        data = yaml.safe_load(front) or {}
    except yaml.YAMLError as e:
        mark = getattr(e, "problem_mark", None)
        raise IntakeError(f"not valid YAML: {getattr(e, 'problem', e)}", (mark.line + 2) if mark else 1)
    if not isinstance(data, dict):
        raise IntakeError("the block between --- must be a list of settings", 2)

    def at(*keys: str) -> int:
        return _find_line(front, *keys)

    if data.get("format") != FORMAT:
        raise IntakeError(f"format must be {FORMAT}", at("format"))
    if data.get("version") != 1:
        raise IntakeError("version must be 1", at("version"))
    known = {"format", "version", "mode", "trigger", "save", "ack", "hint", "status", "run", "limits"}
    for k in data:
        if k not in known:
            st.warnings.append(f"unknown setting “{k}” is ignored (line {at(str(k))})")

    def section(name: str, allowed: set[str]) -> dict:
        v = data.get(name) or {}
        if not isinstance(v, dict):
            raise IntakeError(f"{name} must be a group of settings", at(name))
        for k in v:
            if k not in allowed:
                st.warnings.append(f"unknown setting “{name}.{k}” is ignored (line {at(str(k))})")
        return v

    def boolean(v: Any, name: str, default: bool) -> bool:
        if v is None:
            return default
        if not isinstance(v, bool):
            raise IntakeError(f"{name} must be true or false", at(name.split(".")[-1]))
        return v

    def integer(v: Any, name: str, lo: int, hi: int, default: int, zero: bool = False) -> int:
        if v is None:
            return default
        if isinstance(v, bool) or not isinstance(v, int) or not ((zero and v == 0) or lo <= v <= hi):
            raise IntakeError(f"{name} must be {'0 or ' if zero else ''}a whole number from {lo} to {hi}", at(name.split(".")[-1]))
        return v

    def string(v: Any, name: str, limit: int, default: str) -> str:
        if v is None:
            return default
        if not isinstance(v, str):
            raise IntakeError(f"{name} must be text", at(name.split(".")[-1]))
        if len(v) > limit:
            raise IntakeError(f"{name} is too long ({limit} characters at most)", at(name.split(".")[-1]))
        return v

    mode = data.get("mode", "collect")
    if mode not in ("collect", "answer"):
        raise IntakeError("mode must be collect or answer", at("mode"))
    trig = section("trigger", {"quietSeconds", "button", "hintAfterSeconds"})
    save = section("save", {"path", "texts", "phases", "machines", "unknown", "stage"})
    run = section("run", {"prompt", "bot", "agent", "reply", "start", "command", "retryMinutes", "retryHours", "commandTimeoutSec"})
    lim = section("limits", {"maxPhotos", "timeoutSec", "retentionDays", "remindAt"})
    if "bot" in run:
        st.warnings.append(f"run.bot is not used yet (line {at('bot')})")
    quiet = integer(trig.get("quietSeconds"), "trigger.quietSeconds", 10, 600, 30, zero=True)
    button = boolean(trig.get("button"), "trigger.button", True)
    hint_after = integer(trig.get("hintAfterSeconds"), "trigger.hintAfterSeconds", 1, 599, 0, zero=True)
    if hint_after and quiet and hint_after >= quiet:
        raise IntakeError("trigger.hintAfterSeconds must be less than quietSeconds (the notice comes before the session starts)", at("hintAfterSeconds"))
    if mode == "collect" and quiet == 0 and not button:
        raise IntakeError("with quietSeconds 0 the only way to run is the button, so button cannot be false", at("button"))
    path = string(save.get("path"), "save.path", 200, DEFAULT_PATH)
    if not path.endswith("/") or path.startswith("/") or ":" in path or "\\" in path or ".." in path.split("/") or re.search(r"[\x00-\x1f]", path):
        raise IntakeError("save.path must be a folder inside the working folder, written like jobs/{session}/ (relative, ending with /)", at("path"))
    bad = _template_vars(path) - PATH_VARS
    if bad:
        raise IntakeError(f"save.path cannot use {{{sorted(bad)[0]}}}; it may use " + ", ".join("{" + v + "}" for v in sorted(PATH_VARS)), at("path"))
    phases: dict[str, list[str]] = {}
    raw_phases = save.get("phases") or {}
    if not isinstance(raw_phases, dict):
        raise IntakeError("save.phases lists a folder name and the words that mean it", at("phases"))
    for name, words in raw_phases.items():
        words = [words] if isinstance(words, str) else words
        if not isinstance(words, list) or not words or not all(isinstance(w, str) and w.strip() for w in words) or not clean_segment(str(name)):
            raise IntakeError(f"save.phases.{name}: give the words that mean this folder, such as [trước, truoc]", at("phases"))
        phases[clean_segment(str(name))] = [fold(w) for w in words if fold(w)]
    unknown = string(save.get("unknown"), "save.unknown", 10, "ask")
    if unknown not in ("ask", "inbox"):
        raise IntakeError("save.unknown is ask or inbox", at("unknown"))
    machines_file = string(save.get("machines"), "save.machines", 80, MACHINES)
    if "/" in machines_file or "\\" in machines_file or machines_file.startswith("."):
        raise IntakeError("save.machines is a file name in the working folder", at("machines"))
    if "phase" in _template_vars(path) and not phases:
        raise IntakeError("save.path uses {phase}, so save.phases must say which words mean which folder", at("path"))
    if {"area", "code"} & _template_vars(path) and "machine" not in _template_vars(path):
        raise IntakeError("save.path uses {area} or {code}, which come from the machine: it needs {machine} too", at("path"))
    if "machine" in _template_vars(path):
        if machines_text is None:
            raise IntakeError(f"save.path uses {{machine}}, so the working folder needs {machines_file}", at("path"))
        try:
            st.machines = parse_machines(machines_text)
        except IntakeError as e:
            raise IntakeError(str(e), e.line or at("path"))
        if "area" in _template_vars(path):
            for m in st.machines:
                if not m.area:
                    st.warnings.append(f"{m.name} has no “Khu vực” in {machines_file}: its photos go to a folder named “Chưa có khu vực”")
    ack = string(data.get("ack"), "ack", 500, DEFAULT_ACK if mode == "collect" else "")
    hint = string(data.get("hint"), "hint", 500, DEFAULT_HINT)  # sent after `trigger.hintAfterSeconds` without news: what happens next, and when
    status = boolean(data.get("status"), "status", True)  # false: the chat gets no "📋 Lô …" status message of the session
    prompt = string(run.get("prompt"), "run.prompt", 4000, DEFAULT_PROMPT)
    agent = boolean(run.get("agent"), "run.agent", True)  # false: no bot run; the sender gets `run.reply` and the session ends
    reply = string(run.get("reply"), "run.reply", 1000, DEFAULT_REPLY)
    start = string(run.get("start"), "run.start", 500, "")  # sent when the session starts, before the photos are saved (with save.stage)
    stage = boolean(save.get("stage"), "save.stage", False)
    command = run.get("command")  # run after the photos are saved, once per machine: exit 0 done, 3 "not there yet" (tried again later), else an error
    if command is not None:
        if isinstance(command, str):
            command = [command]
        if not isinstance(command, list) or not 1 <= len(command) <= 20 or not all(isinstance(a, str) and 0 < len(a) <= 500 for a in command):
            raise IntakeError("run.command is a list such as [\"{python}\", \"_tools/fetch_pdfs.py\", \"{machine}\"]", at("command"))
        unknown_vars = set().union(*(_template_vars(a) for a in command)) - COMMAND_VARS
        if unknown_vars:
            raise IntakeError(f"run.command cannot use {{{sorted(unknown_vars)[0]}}}; it may use " + ", ".join("{" + v + "}" for v in sorted(COMMAND_VARS)), at("command"))
        if command[0] == "{python}" and len(command) < 2:
            raise IntakeError("run.command: after {python} comes the script to run, inside the working folder", at("command"))
        program = command[1] if command[0] == "{python}" else command[0]
        if program.startswith(("/", "\\")) or ":" in program or ".." in program.replace("\\", "/").split("/") or _template_vars(program):
            raise IntakeError("run.command runs a program inside the working folder: write its path relative to it, such as _tools/fetch_pdfs.py", at("command"))
    retry_minutes = integer(run.get("retryMinutes"), "run.retryMinutes", 1, 1440, 10)
    retry_hours = integer(run.get("retryHours"), "run.retryHours", 1, 48, 3, zero=True)
    command_timeout = integer(run.get("commandTimeoutSec"), "run.commandTimeoutSec", 10, 3600, 300)  # true: photos wait in jobs/_inbox/ until the session starts, then go to their folders
    remind = string(lim.get("remindAt"), "limits.remindAt", 5, "")
    if remind and not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", remind):
        raise IntakeError("limits.remindAt is a time such as 18:30", at("remindAt"))
    for label, tpl, ok in (("ack", ack, ACK_VARS), ("run.prompt", prompt, PROMPT_VARS), ("run.reply", reply, PROMPT_VARS), ("run.start", start, PROMPT_VARS), ("hint", hint, PROMPT_VARS)):
        for v in sorted(_template_vars(tpl) - ok):
            st.warnings.append(f"{{{v}}} in {label} is not a known word and is left as written")
    return {
        "mode": mode, "quietSeconds": quiet, "button": button, "path": path, "texts": boolean(save.get("texts"), "save.texts", True), "phases": phases,
        "machines": machines_file, "unknown": unknown, "ack": ack, "hint": hint, "hintAfter": hint_after, "status": status, "prompt": prompt, "agent": agent, "reply": reply, "start": start, "stage": stage, "command": command or [], "retryMinutes": retry_minutes, "retryHours": retry_hours,
        "commandTimeoutSec": command_timeout, "body": body.strip(),
        "maxPhotos": integer(lim.get("maxPhotos"), "limits.maxPhotos", 1, 100, DEFAULT_LIMITS["maxPhotos"]),
        "timeoutSec": integer(lim.get("timeoutSec"), "limits.timeoutSec", 5, 7200, DEFAULT_LIMITS["timeoutSec"]),
        "retentionDays": integer(lim.get("retentionDays"), "limits.retentionDays", 1, 365, DEFAULT_LIMITS["retentionDays"]), "remindAt": remind,
    }


def summary(cfg: Optional[dict]) -> str:
    """One line for the settings panel."""
    if not cfg:
        return ""
    if cfg["mode"] == "answer":
        return "Answers every message"
    when = f"Runs after {cfg['quietSeconds']} s without news" if cfg["quietSeconds"] else "Runs when Check is pressed"
    return f"{when} · saves to {cfg['path']}"


# ---- reading the files of a working folder, with a memory of the last good one -----------------------------------------------------------
class IntakeFiles:
    """The state of the two files of each working folder. A file is read again when it changed, at most once a second; a file that no longer
    checks keeps the bot on its last good settings."""

    def __init__(self) -> None:
        self.seen: dict[str, tuple[float, tuple, State]] = {}
        self.good: dict[str, tuple[dict, list[Machine]]] = {}

    def load(self, workdir: str | Path) -> State:
        base = Path(workdir)
        key = str(base)
        now = time.monotonic()
        prev = self.seen.get(key)
        if prev and now - prev[0] < RECHECK_SECONDS:
            return prev[2]
        stamp = tuple((p.stat().st_mtime_ns, p.stat().st_size) if p.is_file() else None for p in (base / FILE, base / MACHINES))
        if prev and prev[1] == stamp:
            self.seen[key] = (now, stamp, prev[2])
            return prev[2]
        st = self._read(base, key)
        self.seen[key] = (now, stamp, st)
        return st

    def forget(self, workdir: str | Path) -> None:
        self.seen.pop(str(Path(workdir)), None)

    def _read(self, base: Path, key: str) -> State:
        path = base / FILE
        if not path.is_file():
            return State(path=str(path), exists=False, error=f"there is no {FILE} in the working folder")
        try:
            raw = path.read_bytes()
        except OSError as e:
            return State(path=str(path), exists=True, error=f"{FILE} cannot be read: {e.strerror or e}")
        text = raw.decode("utf8", errors="replace")
        machines_text = _read_machines(base, text)
        st = parse(text, machines_text)
        st.path, st.hash = str(path), digest(raw)
        if st.valid:
            self.good[key] = (st.cfg or {}, st.machines)
        elif key in self.good:
            st.cfg, st.machines = self.good[key]
            st.using_last_good = True
        return st


def _read_machines(base: Path, intake_text: str) -> Optional[str]:
    """The machines file this intake names (only when its path needs `{machine}`), or None."""
    front, _ = _split(intake_text)
    try:
        data = yaml.safe_load(front or "") or {}
        save = data.get("save") or {} if isinstance(data, dict) else {}
        name = str(save.get("machines") or MACHINES) if isinstance(save, dict) else MACHINES
    except yaml.YAMLError:
        return None
    if "/" in name or "\\" in name or name.startswith("."):
        return None
    p = base / name
    try:
        return p.read_text(encoding="utf8", errors="replace") if p.is_file() else None
    except OSError:
        return None


# ---- filling templates and building folders ------------------------------------------------------------------------------------------------
def fold(text: str) -> str:
    """Lower case, without accents, only letters and digits between single spaces; the word “máy” is left out."""
    s = unicodedata.normalize("NFD", str(text).replace("đ", "d").replace("Đ", "D"))
    s = "".join(c for c in s if unicodedata.category(c) != "Mn").lower()
    s = re.sub(r"[^a-z0-9]+", " ", s).strip()
    return " ".join(w for w in s.split() if w != "may")


def clean_segment(value: str) -> str:
    """One part of a folder path from outside text: no separators, no characters Windows refuses, no dots or spaces at the ends."""
    s = re.sub(r'[\x00-\x1f/\\:*?"<>|]', " ", str(value or ""))
    s = re.sub(r"\.{2,}", ".", s)
    s = re.sub(r"\s+", " ", s).strip(" .")
    return s[:80].strip(" .")


def fill(template: str, values: dict[str, Any]) -> str:
    """`{word}` becomes its value; a word this does not know stays as written. Nothing else in the template is looked at."""
    return re.sub(r"\{(\w+)\}", lambda m: str(values[m.group(1)]) if m.group(1) in values else m.group(0), template)


def build_folder(cfg: dict, values: dict[str, Any], workdir: str | Path) -> Path:
    """The folder a session's photos go to, inside the working folder. Raises IntakeError for anything that would leave it."""
    safe = {k: clean_segment(v) if k in ("machine", "phase", "chat", "area", "code") else str(v) for k, v in values.items() if k in PATH_VARS}
    rel = fill(cfg["path"], safe)
    if re.search(r"\{\w+\}", rel):
        raise IntakeError("the folder still has an unknown word in it")
    parts = [clean_segment(p) for p in rel.split("/")]
    parts = [p for p in parts if p]
    if not parts:
        raise IntakeError("the folder is empty")
    base = Path(workdir).resolve()
    target = base.joinpath(*parts).resolve()
    if target == base or not target.is_relative_to(base):
        raise IntakeError("the folder is outside the working folder")
    return target


def relative(target: Path, workdir: str | Path) -> str:
    return target.resolve().relative_to(Path(workdir).resolve()).as_posix() + "/"


# ---- reading a caption ---------------------------------------------------------------------------------------------------------------------
def split_phase(text: str, phases: dict[str, list[str]]) -> tuple[Optional[str], str]:
    """The phase a caption names (one folder name) and the caption without its word. Two different phases named: none."""
    words = fold(text).split()
    hits: dict[str, list[int]] = {}
    for name, keys in phases.items():
        for i, w in enumerate(words):
            if w in keys:
                hits.setdefault(name, []).append(i)
    if len(hits) != 1:
        return None, " ".join(words)
    name = next(iter(hits))
    drop = set(hits[name][-1:])
    return name, " ".join(w for i, w in enumerate(words) if i not in drop)


def _digits(s: str) -> tuple[str, ...]:
    return tuple(re.findall(r"\d+", s))


def match_machine(query: str, machines: list[Machine]) -> tuple[Optional[Machine], list[str]]:
    """The machine a text names, and up to three closest names. The letters may be misspelt; every number must be the same (M1 is never M10)."""
    q = fold(query)
    if not q or not machines:
        return None, []
    scored: list[tuple[float, bool, Machine]] = []
    for m in machines:
        best, same_digits = 0.0, False
        for cand in (m.name, m.code, *m.aliases):
            c = fold(cand)
            if not c:
                continue
            ok = _digits(c) == _digits(q)
            score = 1.0 if c == q else difflib.SequenceMatcher(None, q, c).ratio()
            if (ok, score) > (same_digits, best):
                best, same_digits = score, ok
        scored.append((best, same_digits, m))
    scored.sort(key=lambda t: (t[1], t[0]), reverse=True)
    suggestions = [m.name for _, _, m in sorted(scored, key=lambda t: t[0], reverse=True)[:3]]
    top = scored[0]
    if not top[1] or top[0] < 0.8:
        return None, suggestions
    rivals = [s for s in scored[1:] if s[1]]
    if rivals and rivals[0][0] > top[0] - 0.1:
        return None, suggestions
    return top[2], suggestions


def read_caption(caption: str, cfg: dict, machines: list[Machine]) -> dict:
    """`{"machine": Machine|None, "phase": str|None, "suggestions": [...]}` for a caption such as “Máy BH Flex M1 trước”."""
    phase, rest = split_phase(caption, cfg["phases"]) if cfg["phases"] else (None, fold(caption))
    machine, suggestions = match_machine(rest, machines) if machines else (None, [])
    return {"machine": machine, "phase": phase, "suggestions": suggestions}


# ---- writing the files -------------------------------------------------------------------------------------------------------------------------
class Conflict(Exception):
    """The file changed on disk since the person opened it."""


def read_file(workdir: str | Path, name: str) -> dict:
    if name not in NAMES:
        raise IntakeError("only intake.md and machines.md can be read here")
    p = Path(workdir) / name
    if not p.is_file():
        return {"name": name, "exists": False, "content": "", "hash": "", "size": 0}
    raw = p.read_bytes()
    limit = MAX_INTAKE if name == FILE else MAX_MACHINES
    if len(raw) > limit:
        raise IntakeError(f"{name} is too large to edit here")
    return {"name": name, "exists": True, "content": raw.decode("utf8", errors="replace"), "hash": digest(raw), "size": len(raw)}


def check_text(workdir: str | Path, name: str, content: str) -> dict:
    """The verdict on text being edited, without writing anything: `{valid, error, line, warnings, summary}`."""
    if name not in NAMES:
        raise IntakeError("only intake.md and machines.md can be checked here")
    if name == MACHINES:
        try:
            machines = parse_machines(content)
            return {"valid": True, "error": None, "line": None, "warnings": [], "summary": f"{len(machines)} machines"}
        except IntakeError as e:
            return {"valid": False, "error": str(e), "line": e.line, "warnings": [], "summary": ""}
    on_disk = _read_machines(Path(workdir), content)
    st = parse(content, on_disk)
    return {"valid": st.valid, "error": st.error or None, "line": st.line, "warnings": st.warnings, "summary": summary(st.cfg) if st.valid else ""}


def write_file(workdir: str | Path, name: str, content: str, expect_hash: Optional[str], force: bool = False) -> dict:
    """Check, then write whole: the new text goes to a file beside it and replaces the old one. A file that changed since `expect_hash` is a Conflict
    unless `force`. Line ends stay as the file had them."""
    verdict = check_text(workdir, name, content)
    if not verdict["valid"]:
        raise IntakeError(verdict["error"] or "not valid", verdict["line"])
    p = Path(workdir) / name
    old = p.read_bytes() if p.is_file() else None
    if not force and (digest(old) if old is not None else "") != (expect_hash or ""):
        raise Conflict()
    text = content.replace("\r\n", "\n")
    if old is not None and b"\r\n" in old:
        text = text.replace("\n", "\r\n")
    raw = text.encode("utf8")
    fd, tmp = tempfile.mkstemp(dir=str(p.parent), prefix=f".{name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as f:
            f.write(raw)
        os.replace(tmp, p)
    except OSError:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return {"name": name, "hash": digest(raw), "size": len(raw), **verdict}


def create_default(workdir: str | Path, mode: str = "collect", prompt: Optional[str] = None, limits: Optional[dict] = None) -> bool:
    """Write the default `intake.md` if there is none. Never replaces a file. True when it was made."""
    p = Path(workdir) / FILE
    if p.exists():
        return False
    Path(workdir).mkdir(parents=True, exist_ok=True)
    p.write_text(default_text(mode, prompt, limits), encoding="utf8", newline="\n")
    return True
