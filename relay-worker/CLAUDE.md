# Relay (relay-worker)

Loaded only when working in this folder. Client-side protocol details are in `web/src/lib/CLAUDE.md`.

- One `Room` Durable Object per room ID relays WebSocket frames (hibernation API, size cap, origin allowlist). It holds only live sockets in memory: never add storage, logging of payloads, or caching.
- The client's `hello` frame is consumed by the relay (never forwarded) and the role is stored per socket. The relay broadcasts `presence` (distinct roles). Client frames of reserved types (`presence`, `hello`) are dropped so peers can't forge them. `ping` -> `pong` is auto-answered (keepalive). All other frames are forwarded verbatim to the other sockets in the room.
- Relay `close` handshakes are flaky (about 1 in 10 never complete, also on the deployed Worker). It doesn't affect relaying; smoke tests use `--test-force-exit` for that reason.
- Dev: `npm run dev` (ws://localhost:8787). Typecheck / smoke test: `npm run typecheck` / `npm test` (needs `npm run dev` running, or `RELAY_URL=wss://tunnel-relay.govindplal.workers.dev npm test` against the deployed Worker). Deploy: `npm run deploy` (needs `wrangler login`).
- Legacy FastAPI/Redis prototype in `../relay/` (kept for reference until removed): `cd ../relay && .venv/Scripts/python -m pytest -q`.
