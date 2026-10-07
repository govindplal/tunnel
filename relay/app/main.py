"""Stateless WebSocket relay. Never persists or logs payloads."""
import asyncio
import os
import re
import uuid

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from app.bus import Bus, MemoryBus, RedisBus

ROOM_RE = re.compile(r"^[A-Za-z0-9_-]{22,64}$")  # >=128-bit base64url IDs
MAX_BYTES = int(os.getenv("MAX_MESSAGE_BYTES", "1048576"))


def make_bus() -> Bus:
    url = os.getenv("REDIS_URL")
    return RedisBus(url) if url else MemoryBus()


app = FastAPI()
app.state.bus = make_bus()
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("ALLOWED_ORIGINS", "http://localhost:3000").split(","),
    allow_methods=["GET"],
)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.websocket("/ws/{room}")
async def ws_room(ws: WebSocket, room: str) -> None:
    if not ROOM_RE.match(room):
        await ws.close(code=1008)
        return
    await ws.accept()
    bus: Bus = app.state.bus
    me = uuid.uuid4().bytes  # 16-byte sender tag so we don't echo to ourselves

    async def pump_out() -> None:
        async for data in bus.subscribe(room):
            if data[:16] != me:
                await ws.send_bytes(data[16:])

    task = asyncio.create_task(pump_out())
    try:
        while True:
            msg = await ws.receive()
            if msg["type"] == "websocket.disconnect":
                break
            data = msg.get("bytes") or (msg.get("text") or "").encode()
            if len(data) > MAX_BYTES:
                await ws.close(code=1009)
                break
            await bus.publish(room, me + data)
    except WebSocketDisconnect:
        pass
    finally:
        task.cancel()
