"""A stand-in for `claude -p --output-format stream-json --input-format stream-json` used by driver tests.

The first word of each user message picks the behaviour: tool (call a tool), crash (exit abruptly),
hang (never answer), anything else is answered with "ok:<text>". Records its argv in $FAKE_CLAUDE_ARGV.
"""
import json
import os
import sys
import time

if os.environ.get("FAKE_CLAUDE_ARGV"):
    with open(os.environ["FAKE_CLAUDE_ARGV"], "a", encoding="utf8") as f:
        f.write(json.dumps(sys.argv[1:]) + "\n")


def out(o):
    sys.stdout.write(json.dumps(o) + "\n")
    sys.stdout.flush()


sid = "sess-123"
if "--resume" in sys.argv:
    sid = sys.argv[sys.argv.index("--resume") + 1]
out({"type": "system", "subtype": "init", "session_id": sid, "model": "fake"})

for line in sys.stdin:
    msg = json.loads(line)
    text = msg["message"]["content"]
    word = text.split()[0] if text.split() else ""
    if word == "crash":
        sys.exit(3)
    if word == "hang":
        time.sleep(60)
    if word == "tool":
        out({"type": "assistant", "message": {"id": "m1", "content": [
            {"type": "text", "text": "Let me look."},
            {"type": "tool_use", "id": "tu1", "name": "Bash", "input": {"command": "ls"}}],
            "usage": {"input_tokens": 3, "output_tokens": 4}}})
        out({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "tu1", "content": "file.txt", "is_error": False}]}})
    for part in ("ok:", text):
        out({"type": "stream_event", "event": {"type": "content_block_delta", "delta": {"type": "text_delta", "text": part}}})
    out({"type": "assistant", "message": {"id": "m2", "content": [{"type": "text", "text": "ok:" + text}],
                                          "usage": {"input_tokens": 5, "output_tokens": 6}}})
    out({"type": "result", "subtype": "success", "is_error": False, "stop_reason": "end_turn", "total_cost_usd": 0.01,
         "usage": {"input_tokens": 5, "output_tokens": 6}})
