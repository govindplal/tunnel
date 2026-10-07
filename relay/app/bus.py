"""Pub/Sub transport. Messages are relayed only; nothing is stored."""
import asyncio
from collections import defaultdict
from collections.abc import AsyncIterator
from typing import Protocol


class Bus(Protocol):
    async def publish(self, room: str, data: bytes) -> None: ...
    def subscribe(self, room: str) -> AsyncIterator[bytes]: ...


class MemoryBus:
    """Single-process fallback for dev/tests."""

    def __init__(self) -> None:
        self._subs: dict[str, set[asyncio.Queue[bytes]]] = defaultdict(set)

    async def publish(self, room: str, data: bytes) -> None:
        for q in list(self._subs[room]):
            q.put_nowait(data)

    async def subscribe(self, room: str) -> AsyncIterator[bytes]:
        q: asyncio.Queue[bytes] = asyncio.Queue()
        self._subs[room].add(q)
        try:
            while True:
                yield await q.get()
        finally:
            self._subs[room].discard(q)
            if not self._subs[room]:
                self._subs.pop(room, None)


class RedisBus:
    def __init__(self, url: str) -> None:
        import redis.asyncio as aioredis

        self._r = aioredis.from_url(url)

    async def publish(self, room: str, data: bytes) -> None:
        await self._r.publish(f"room:{room}", data)

    async def subscribe(self, room: str) -> AsyncIterator[bytes]:
        ps = self._r.pubsub()
        await ps.subscribe(f"room:{room}")
        try:
            async for m in ps.listen():
                if m["type"] == "message":
                    yield m["data"]
        finally:
            await ps.unsubscribe(f"room:{room}")
            await ps.aclose()
