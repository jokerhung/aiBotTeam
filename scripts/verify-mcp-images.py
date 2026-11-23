"""Manual engine probe: identify a code visible only inside an MCP image result.

Run with server/.venv/Scripts/python.exe scripts/verify-mcp-images.py.
Uses installed, signed-in CLIs; creates no agent and changes no application data.
"""
import asyncio
import base64
import io
import json
import secrets
import shutil
import sys
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from botteam.drivers.base import SendTurnInput
from botteam.drivers.claude import ClaudeDriver
from botteam.drivers.codex_app import CodexAppDriver
from botteam.drivers.antigravity import AntigravityDriver


async def probe(kind, cls, binary):
    with tempfile.TemporaryDirectory(prefix="bt-image-probe-") as temp:
        directory = Path(temp)
        code = secrets.token_hex(4).upper()
        image = Image.new("RGB", (900, 250), "white")
        draw = ImageDraw.Draw(image)
        font_path = Path("C:/Windows/Fonts/arialbd.ttf")
        font = ImageFont.truetype(str(font_path), 72) if font_path.exists() else ImageFont.load_default(size=72)
        draw.text((35, 75), code, fill="black", font=font)
        output = io.BytesIO()
        image.save(output, "PNG")
        server = directory / "mcp.py"
        # Expected code never appears in the server's text or tool description.
        server.write_text('''import sys,json
image = ''' + repr(base64.b64encode(output.getvalue()).decode()) + '''
for raw in sys.stdin:
 m=json.loads(raw); method=m.get("method"); ident=m.get("id")
 if ident is None: continue
 if method=="initialize": result={"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"visual-test","version":"1"}}
 elif method=="tools/list": result={"tools":[{"name":"show_test_image","description":"Show an image with a code. Read it visually.","inputSchema":{"type":"object","properties":{}}}]}
 elif method=="tools/call": result={"content":[{"type":"image","mimeType":"image/png","data":image}]}
 else: result={}
 print(json.dumps({"jsonrpc":"2.0","id":ident,"result":result}),flush=True)
''', encoding="utf8")
        driver = cls(binary)
        finished = asyncio.Event()
        text, errors, called = [], [], []
        def event(ev):
            if ev.type == "content.delta":
                text.append(ev.data.get("delta", ""))
            elif ev.type == "runtime.error":
                errors.append(ev.data.get("message", "error"))
            elif ev.type == "item.started":
                called.append(ev.data.get("title", ""))
            elif ev.type == "turn.completed":
                finished.set()
        driver.on_event(event)
        try:
            await driver.send_turn(SendTurnInput(thread_id=f"image-probe-{kind}", bot_id="probe", cwd=temp,
                text="Call the visual-test show_test_image MCP tool. Read the eight character code in its returned image. Reply with only that code. Do not read files or run shell commands.",
                custom_mcp={"visual-test": {"command": sys.executable, "args": [str(server)]}}, approval_mode="full"))
            await asyncio.wait_for(finished.wait(), 180)
            answer = "".join(text)
            return {"engine": kind, "verified": code in answer.upper() and any("show_test_image" in name for name in called), "answer": answer[-200:], "errors": errors, "tools": called}
        except Exception as exc:
            return {"engine": kind, "verified": False, "error": str(exc)}
        finally:
            await driver.stop_all()


async def main():
    for kind, cls, name in (("claude", ClaudeDriver, "claude"), ("codex", CodexAppDriver, "codex"), ("antigravity", AntigravityDriver, "agy")):
        if len(sys.argv) > 1 and kind not in sys.argv[1:]:
            continue
        binary = shutil.which(name)
        print(json.dumps(await probe(kind, cls, binary) if binary else {"engine": kind, "verified": False, "error": "CLI unavailable"}), flush=True)


asyncio.run(main())
