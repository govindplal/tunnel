from fastapi.testclient import TestClient

from app.main import app

ROOM = "A" * 22


def test_health():
    assert TestClient(app).get("/health").json() == {"status": "ok"}


def test_relays_to_peer_not_sender():
    c = TestClient(app)
    with c.websocket_connect(f"/ws/{ROOM}") as host, c.websocket_connect(f"/ws/{ROOM}") as client:
        client.send_bytes(b"hello")
        assert host.receive_bytes() == b"hello"


def test_rooms_are_isolated():
    c = TestClient(app)
    ra, rb = f"/ws/{ROOM}", f"/ws/{'B' * 22}"
    with c.websocket_connect(ra) as a1, c.websocket_connect(ra) as a2, c.websocket_connect(rb) as b1, c.websocket_connect(rb) as b2:
        a1.send_bytes(b"x")
        b1.send_bytes(b"y")
        assert a2.receive_bytes() == b"x"
        assert b2.receive_bytes() == b"y"


def test_bad_room_rejected():
    import pytest
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect), TestClient(app).websocket_connect("/ws/short"):
        pass
