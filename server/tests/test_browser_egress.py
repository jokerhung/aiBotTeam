import asyncio

import pytest

from botteam.browser_egress import BrowserEgress, browser_destination_allowed


@pytest.mark.parametrize("address", ["127.0.0.1", "::1", "::ffff:127.0.0.1", "192.168.1.1", "100.64.0.1", "169.254.169.254"])
def test_private_destinations_are_blocked(address):
    assert not browser_destination_allowed(address, False)


@pytest.mark.parametrize("address", ["127.0.0.1", "::1", "192.168.1.1"])
def test_explicit_local_access(address):
    assert browser_destination_allowed(address, True)


async def test_socks_enforces_local_setting():
    async def echo(reader, writer):
        try:
            writer.write(await reader.readexactly(4))
            await writer.drain()
        finally:
            writer.close()

    target = await asyncio.start_server(echo, "127.0.0.1", 0)
    target_port = target.sockets[0].getsockname()[1]
    async with target:
        for allow_local in (False, True):
            gateway = BrowserEgress(allow_local)
            try:
                port = await gateway.start()
                reader, writer = await asyncio.open_connection("127.0.0.1", port)
                try:
                    writer.write(b"\x05\x01\x00")
                    await writer.drain()
                    assert await reader.readexactly(2) == b"\x05\x00"
                    writer.write(b"\x05\x01\x00\x03\x09localhost" + target_port.to_bytes(2, "big"))
                    await writer.drain()
                    result = await reader.readexactly(10)
                    assert result[1] == (0 if allow_local else 2)
                    if allow_local:
                        writer.write(b"test")
                        await writer.drain()
                        assert await reader.readexactly(4) == b"test"
                finally:
                    writer.close()
                    await writer.wait_closed()
            finally:
                await gateway.close()
