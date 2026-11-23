"""Loopback SOCKS5 gateway for an agent's Chromium profile."""
from __future__ import annotations

import asyncio
import ipaddress
import socket


def browser_destination_allowed(address: str, allow_local: bool) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    if ip.is_loopback:
        return allow_local
    if ip.is_link_local or ip.is_unspecified or ip.is_multicast or ip.is_reserved:
        return False
    return ip.is_global or (allow_local and ip.is_private)


class BrowserEgress:
    def __init__(self, allow_local: bool, protected_ports: set[int] | None = None) -> None:
        self.allow_local = allow_local
        self.protected_ports = protected_ports if protected_ports is not None else set()
        self.server: asyncio.AbstractServer | None = None
        self.connections: set[asyncio.Task] = set()
        self.clients: set[asyncio.StreamWriter] = set()
        self.closing = False

    async def start(self) -> int:
        self.server = await asyncio.start_server(self._accept, "127.0.0.1", 0)
        return self.server.sockets[0].getsockname()[1]

    async def close(self) -> None:
        self.closing = True
        if self.server:
            self.server.close()
        for writer in self.clients:
            writer.close()
        tasks = list(self.connections)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        if self.server:
            try:
                await asyncio.wait_for(self.server.wait_closed(), 2)
            except asyncio.TimeoutError:
                # Proactor can leave a reset Chromium socket counted after its close callback raises.
                pass

    def _accept(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        if self.closing:
            writer.close()
            return
        task = asyncio.create_task(self._handle(reader, writer))
        self.clients.add(writer)
        self.connections.add(task)

        def finished(done: asyncio.Task) -> None:
            self.clients.discard(writer)
            self.connections.discard(done)
            writer.close()

        task.add_done_callback(finished)

    async def _connect(self, reader, writer):
        async def reply(code: int) -> None:
            writer.write(bytes((5, code, 0, 1, 0, 0, 0, 0, 0, 0)))
            await writer.drain()

        version, count = await reader.readexactly(2)
        methods = await reader.readexactly(count)
        if version != 5 or 0 not in methods:
            writer.write(b"\x05\xff")
            await writer.drain()
            return None
        writer.write(b"\x05\x00")
        await writer.drain()
        version, command, reserved, address_type = await reader.readexactly(4)
        if (version, command, reserved) != (5, 1, 0):
            await reply(7)
            return None
        if address_type == 3:
            size = (await reader.readexactly(1))[0]
            host = (await reader.readexactly(size)).decode("ascii")
        elif address_type in (1, 4):
            host = str(ipaddress.ip_address(await reader.readexactly(4 if address_type == 1 else 16)))
        else:
            await reply(8)
            return None
        port = int.from_bytes(await reader.readexactly(2), "big")
        name = host.rstrip(".").lower()
        local_name = name == "localhost" or name.endswith((".localhost", ".local"))
        if port in self.protected_ports or not name or not port or (local_name and not self.allow_local):
            await reply(2)
            return None
        try:
            results = await asyncio.get_running_loop().getaddrinfo(host, port, type=socket.SOCK_STREAM)
        except OSError:
            await reply(4)
            return None
        addresses = list(dict.fromkeys((family, sockaddr[0]) for family, _, _, _, sockaddr in results))
        if any(not browser_destination_allowed(address, self.allow_local) for _, address in addresses):
            await reply(2)
            return None
        if port in self.protected_ports and any(not browser_destination_allowed(address, False) for _, address in addresses):
            await reply(2)
            return None
        for family, address in addresses:
            try:
                upstream = await asyncio.wait_for(asyncio.open_connection(address, port, family=family, flags=socket.AI_NUMERICHOST), 3)
            except (OSError, asyncio.TimeoutError):
                continue
            try:
                await reply(0)
            except BaseException:
                upstream[1].close()
                raise
            return upstream
        await reply(5)
        return None

    async def _handle(self, reader, writer) -> None:
        upstream = None
        pipes = []

        async def copy(source, destination) -> None:
            while data := await source.read(65536):
                destination.write(data)
                await destination.drain()
            if destination.can_write_eof():
                destination.write_eof()

        try:
            upstream = await asyncio.wait_for(self._connect(reader, writer), 15)
            if upstream is None:
                return
            remote_reader, remote_writer = upstream
            pipes = [asyncio.create_task(copy(reader, remote_writer)), asyncio.create_task(copy(remote_reader, writer))]
            await asyncio.gather(*pipes)
        except (OSError, ValueError, asyncio.IncompleteReadError, asyncio.TimeoutError):
            pass
        finally:
            for task in pipes:
                task.cancel()
            writer.close()
            if upstream:
                upstream[1].close()
            await asyncio.gather(*pipes, return_exceptions=True)
