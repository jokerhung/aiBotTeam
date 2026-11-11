"""uvicorn --reload runs on a SelectorEventLoop on Windows, which cannot spawn subprocesses (the engine CLIs). Use Proactor."""
import asyncio
import sys


def loop_factory() -> asyncio.AbstractEventLoop:
    return asyncio.ProactorEventLoop() if sys.platform == "win32" else asyncio.new_event_loop()
