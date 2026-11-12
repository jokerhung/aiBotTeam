"""Windows dev reload without passing a listening socket between processes.

Uvicorn's built-in reloader shares the parent's socket with its child. That
socket can fail IOCP registration on Proactor (WinError 87). Keep Proactor for
engine subprocesses, but let each server process bind its own fresh socket.
"""
from __future__ import annotations

import argparse
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading

from watchfiles import PythonFilter, watch


def stop_server(process: subprocess.Popen) -> None:
    if process.poll() is not None:
        return
    try:
        process.send_signal(signal.CTRL_BREAK_EVENT if sys.platform == "win32" else signal.SIGTERM)
        process.wait(timeout=10)
    except (OSError, subprocess.TimeoutExpired):
        if process.poll() is None:
            process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()


def run(host: str, port: int, watch_dir: str, app: str = "botteam.main:app", stop_event=None) -> int:
    stopped = stop_event if stop_event is not None else threading.Event()
    handled = [signal.SIGINT, signal.SIGTERM]
    if sys.platform == "win32":
        handled.append(signal.SIGBREAK)
    previous = {sig: signal.signal(sig, lambda *_: stopped.set()) for sig in handled}
    command = [sys.executable, "-m", "uvicorn", app, "--host", host, "--port", str(port),
               "--no-proxy-headers", "--loop", "botteam.loop:loop_factory", "--timeout-graceful-shutdown", "5"]

    def start_server():
        return subprocess.Popen(command, creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if sys.platform == "win32" else 0)

    process = None
    try:
        process = start_server()
        for changes in watch(watch_dir, watch_filter=PythonFilter(), stop_event=stopped,
                             yield_on_timeout=True, rust_timeout=250, debounce=300, step=50):
            if stopped.is_set():
                break
            if process.poll() is not None:
                return process.returncode
            if changes:
                print("[reload] Python source changed; restarting with a fresh server socket.", flush=True)
                stop_server(process)
                process = start_server()
        return 0
    finally:
        if process is not None:
            stop_server(process)
        for sig, handler in previous.items():
            signal.signal(sig, handler)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default=os.environ.get("SERVER_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("SERVER_PORT", "8899")))
    args = parser.parse_args()
    return run(args.host, args.port, str(Path(__file__).parent))


if __name__ == "__main__":
    raise SystemExit(main())
