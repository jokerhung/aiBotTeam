"""A fake `agy` that speaks ACP over stdio: `fake_acp.py acp [flags]`. Behavior comes from the prompt text.

  hello      -> a thought, a message in two chunks, end_turn
  tool       -> a write_file call (edit) that completes
  shell      -> a run_command call that first asks permission (denied -> the tool fails)
  slow       -> streams until session/cancel arrives, then stopReason cancelled
  die        -> the process exits in the middle of the turn
  fail       -> session/prompt returns an error "Please sign in"
Everything the fake receives is appended to $FAKE_ACP_LOG (one JSON per line)."""
import json
import os
import sys
import threading
import time

LOG = os.environ.get("FAKE_ACP_LOG")
cancelled = threading.Event()
answers: dict = {}
lock = threading.Lock()


def log(o):
    if LOG:
        with open(LOG, "a", encoding="utf8") as f:
            f.write(json.dumps(o) + "\n")


def send(o):
    with lock:
        sys.stdout.write(json.dumps(o) + "\n")
        sys.stdout.flush()


def update(sid, u):
    send({"jsonrpc": "2.0", "method": "session/update", "params": {"sessionId": sid, "update": u}})


log({"argv": sys.argv[1:]})
if os.environ.get("FAKE_ACP_AUTH"):  # not signed in: print the link and die, as `agy acp` does
    sys.stderr.write("Open the following link to authenticate the ACP server: https://accounts.example/auth?x=1\n")
    sys.stderr.flush()
    time.sleep(0.3)
    os._exit(1)


def prompt(rid, sid, text):
    if "die" in text:
        os._exit(3)
    if "fail" in text:
        send({"jsonrpc": "2.0", "id": rid, "error": {"code": -32000, "message": "Please sign in"}})
        return
    if "slow" in text:
        for i in range(200):
            if cancelled.is_set():
                break
            update(sid, {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": f"tick{i} "}})
            time.sleep(0.05)
        cancelled.clear()
        send({"jsonrpc": "2.0", "id": rid, "result": {"stopReason": "cancelled"}})
        return
    update(sid, {"sessionUpdate": "agent_thought_chunk", "content": {"type": "text", "text": "thinking"}})
    if "tool" in text:
        tc = {"toolCallId": "c1", "name": "write_file", "kind": "edit", "title": "File a.txt", "rawInput": {"Path": "/w/a.txt", "Content": "x"}}
        update(sid, {"sessionUpdate": "tool_call", "status": "in_progress", **tc})
        update(sid, {"sessionUpdate": "tool_call_update", "status": "completed", **tc, "rawOutput": {"output": "written"}})
    if "shell" in text:
        tc = {"toolCallId": "c2", "name": "run_command", "kind": "execute", "title": "rm -rf build", "rawInput": {"CommandLine": "rm -rf build"}}
        update(sid, {"sessionUpdate": "tool_call", "status": "pending", **tc})
        rq = "perm-1"
        send({"jsonrpc": "2.0", "id": rq, "method": "session/request_permission",
              "params": {"sessionId": sid, "toolCall": tc, "options": [{"optionId": "allow", "name": "Allow", "kind": "allow_once"}, {"optionId": "deny", "name": "Deny", "kind": "reject_once"}]}})
        for _ in range(500):
            if rq in answers:
                break
            time.sleep(0.02)
        picked = (answers.get(rq) or {}).get("outcome", {}).get("optionId")
        update(sid, {"sessionUpdate": "tool_call_update", "status": "completed" if picked == "allow" else "failed", **tc, "rawOutput": {"output": picked or "none"}})
    update(sid, {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "Hel"}})
    update(sid, {"sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "lo there"}})
    update(sid, {"sessionUpdate": "usage_update", "used": 123, "size": 1000})
    send({"jsonrpc": "2.0", "id": rid, "result": {"stopReason": "end_turn", "usage": {"inputTokens": 10, "outputTokens": 5, "cachedReadTokens": 2}}})


for line in sys.stdin:
    m = json.loads(line)
    log(m)
    method, rid = m.get("method"), m.get("id")
    if method is None and rid is not None:  # a response to our request
        answers[rid] = m.get("result")
    elif method == "initialize":
        send({"jsonrpc": "2.0", "id": rid, "result": {"protocolVersion": 1, "agentCapabilities": {"promptCapabilities": {"image": True}}}})
    elif method == "session/new":
        send({"jsonrpc": "2.0", "id": rid, "result": {"sessionId": "S-1"}})
    elif method == "session/resume":
        if m["params"]["sessionId"] == "gone":
            send({"jsonrpc": "2.0", "id": rid, "error": {"code": -32002, "message": "session not found"}})
        else:
            send({"jsonrpc": "2.0", "id": rid, "result": {}})
    elif method in ("session/set_mode", "session/set_model", "session/set_config_option"):
        send({"jsonrpc": "2.0", "id": rid, "result": {}})
    elif method == "session/prompt":
        text = "".join(b.get("text", "") for b in m["params"]["prompt"] if b.get("type") == "text")
        threading.Thread(target=prompt, args=(rid, m["params"]["sessionId"], text), daemon=True).start()
    elif method == "session/cancel":
        cancelled.set()
