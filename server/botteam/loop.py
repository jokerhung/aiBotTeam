"""Engine CLIs need Proactor on Windows. botteam.dev reloads with fresh sockets to avoid shared-socket IOCP failures."""
import asyncio
import sys


def loop_factory() -> asyncio.AbstractEventLoop:
    return asyncio.ProactorEventLoop() if sys.platform == "win32" else asyncio.new_event_loop()
