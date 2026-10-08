# p2p - cross-network clipboard & file viewport

Zero-install web bridge between a phone (cellular) and a locked-down corporate laptop (Wi-Fi/VPN, P2P blocked). Phone sends text/files; laptop receives, renders, and stores them. Built to leave no footprint in enterprise tools and avoid DLP flags.

## Architecture (non-negotiable principles)
- **The cloud is a relay that never logs or reads content.** It forwards WebSocket frames between the two paired devices. The ONE exception, by the user's decision: an end-to-end encrypted text envelope is held in the room's Durable Object for an offline device until that device acknowledges it, and is deleted at once on ack or after 30 minutes (`HOLD_MS`) at the latest. The relay can't read it. Nothing else is ever stored; files are not held (the laptop must be online to receive them). Don't add any other server-side persistence, caching or content logging.
- **Host (laptop) is the stateful side.** Files live only in the Host browser's IndexedDB, tagged by Room ID. Client (phone) stores nothing but the Room ID.
- **Pairing secret** = 256 random bits, carried only in the QR link's URL fragment (never sent to any server) and saved in `localStorage` on both devices for auto-resume. Everything else is derived from it (`web/src/lib/crypto.ts`): a membership token (proves to the relay you hold the secret), the room name the relay sees (SHA-256 of the token, so the URL path reveals nothing usable), and the AES-GCM key. Treat the secret as the only credential: never log it, never put it in analytics, never put it in a URL path or query.
- **Known limits of the encryption:** only TEXT is end-to-end encrypted. Files (bytes, names, sizes), acks and progress messages still pass through the relay unencrypted (transient, never stored); a TLS-inspecting proxy or the relay could see them. Encrypting file chunks is a possible next step. A device that sees only the room name can't join, read or consume anything.

## Built vs still to build
Pairing, text wormhole, file transfer + stash, and the file viewer (images, PDFs, thumbnails) are built. Protocol and storage details are in `web/src/lib/CLAUDE.md` (client) and `relay-worker/CLAUDE.md` (relay). Still to build:
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
- Clipboard API needs **HTTPS (secure context)** and, for `readText`, a **user gesture** + permission prompt. Mobile Safari/Chrome differ; test on the real phone.
- **A web page cannot write the clipboard while its tab is unfocused, and cannot run at all with the browser closed** (the user wants no installs, so a background helper/extension is off the table). Design around it, don't fight it: closed laptop = the relay holds the encrypted text and the page syncs on open; unfocused tab = store uncopied, raise a generic desktop alert (never the text itself), mark the tab title, and copy the newest text that arrived THIS session when the tab regains focus or the alert is clicked. Never auto-copy old uncopied clips from earlier sessions: it would silently overwrite what the user has on their clipboard.
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

## Current status
@.claude/STATUS.md
