# p2p - cross-network clipboard & file viewport

Zero-install web bridge between a phone (cellular) and a locked-down corporate laptop (Wi-Fi/VPN, P2P blocked). Phone sends text/files; laptop receives, renders, and stores them. Built to leave no footprint in enterprise tools and avoid DLP flags.

## Architecture (non-negotiable principles)
- **Cloud is a stateless relay.** The backend routes WebSocket frames between room members and **never persists** payloads (no disk, no DB, no logs of content). Durable Objects hold only live sockets in memory, no storage.
- **Host (laptop) is the stateful side.** Files live only in the Host browser's IndexedDB, tagged by Room ID. Client (phone) stores nothing but the Room ID.
- **Room ID** = cryptographically secure random (`crypto.getRandomValues`, >=128 bits), saved in `localStorage` on both devices for auto-resume. Possession of the ID is the only auth, so treat it as a secret: never log it, never put it in analytics.
- Known accepted risk: the Room ID is in the WebSocket URL path (`/ws/<room>`), so the relay/Cloudflare logs and TLS-inspecting proxies can see it. Possession of it = access to the room. Real fix is end-to-end encryption keyed from the URL fragment; not built yet.

## Built vs still to build
Pairing, text wormhole, and file transfer + stash are built. Protocol and storage details are in `web/src/lib/CLAUDE.md` (client) and `relay-worker/CLAUDE.md` (relay). Still to build:
- **File viewing:** Host renders received files (PDF.js for PDFs, `<img>`/canvas for media) and shows thumbnails in a "Stash" sidebar.
- **Reverse sync:** Client requests a stashed file; Host reads IndexedDB and streams it back.

## Stack (decided)
- `web/` - Next.js 16. NOTE: this Next.js has breaking changes; read `web/node_modules/next/dist/docs/` before writing Next code (see `web/AGENTS.md`).
- `relay-worker/` - Cloudflare Worker + Durable Objects. `relay/` is the legacy FastAPI/Redis prototype, kept for reference until removed.
- Test devices: Host = ASUS ROG Strix G15 (corp Wi-Fi/VPN); Client = Nothing Phone 4a Pro (cellular)

## Commands
- Web test: `cd web && npm test` (node:test with type-stripping: no enums/parameter properties in `src/lib`)
- Phone testing: use the live Vercel URL (HTTPS) with the deployed Worker (wss). `localhost` is unreachable from the phone on cellular.
- Relay commands: see `relay-worker/CLAUDE.md`.

## Conventions
- Never commit secrets; config in `.env` (gitignored), keys documented in `.env.example`.

## Gotchas
- Clipboard API needs **HTTPS (secure context)** and, for `readText`, a **user gesture** + permission prompt. Mobile Safari/Chrome differ; test on the real phone. `writeText` on the Host may require the tab to be focused - plan a fallback (visible "copy" button/toast).
- Corporate proxies may block or idle-kill WebSockets: add heartbeat/ping, auto-reconnect with backoff, and consider a long-poll/SSE fallback. WSS over 443 only.
- IndexedDB can be evicted/blocked (private mode, storage pressure): call `navigator.storage.persist()` and handle quota errors.
- Phone tabs get suspended in the background; resume must re-join the room and resync cleanly.
- Don't introduce anything that stores payloads server-side, even temporarily (caches, error trackers, request logging middleware).
- Windows dev machine: forward slashes in scripts, LF line endings.

## Workflow
- Explore and plan before non-trivial edits; use `/start-feature` and `/fix-bug`.
- Run tests/lint and report real results before calling work done.
- **Ship every checkpoint:** after each completed feature or checkpoint (tests/lint green), commit and `git push` to `origin` (github.com/govindplal/tunnel). Vercel auto-deploys `web/` on every push; the user reviews the live site, not localhost. After pushing, confirm the deployment reached READY (Vercel `list_deployments`/`get_deployment` or `vercel ls`) and give the user the live URL. If a build fails, fix it before moving on.
- Vercel project `tunnel` (team govindplals-projects), root directory `web`. Vercel can't hold WebSockets, so the relay runs on Cloudflare (`tunnel-relay` Worker, https://tunnel-relay.govindplal.workers.dev); stable web URL https://tunnel-govindplals-projects.vercel.app (`ALLOWED_ORIGINS` in `relay-worker/wrangler.jsonc` accepts `*` wildcards, and already covers `tunnel-*-govindplals-projects.vercel.app`; add any other web origin there). Web reads the relay from `NEXT_PUBLIC_RELAY_URL` (set in Vercel env vars).
- Ask before: adding dependencies, changing the WS protocol, or anything that adds server-side persistence.
