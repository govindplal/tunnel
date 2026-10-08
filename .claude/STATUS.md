# Status (rewrite at every checkpoint; snapshot, not a log; under ~40 lines)

Updated: 2026-10-09

## Now
- Built and live: pairing (QR), text wormhole (E2E-encrypted, relay holds an offline message for up to 30 min), file transfer + stash, file viewer (images, PDFs, thumbnails).
- Latest commit: eb657cb, a restyle (beige/black, a single nested-loop tunnel drawing; other art and dark mode dropped).
- Live: https://tunnel-govindplals-projects.vercel.app (relay: tunnel-relay.govindplal.workers.dev).

## Next
- Reverse sync: phone requests a stashed file; laptop reads IndexedDB and streams it back. Needs a WS protocol change, so ask before changing it.
- Possible: encrypt file chunks end-to-end (only text is E2E today).

## Open questions / blocked on the user
- (none recorded)

## Learned this project (not yet in CLAUDE.md)
- (none)
