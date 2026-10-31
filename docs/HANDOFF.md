# Project handoff — Scorched Tanks

**Updated:** 2026-10-31 — static source audit of `main` at `26b9c8b`. Previous handoff dated 2026-10-19 targeted v1.11 and is superseded by this file.

## Source state (not live-server certification)

- Game, Worker and landing source advertise **v1.15** (`GAME_VER`, `APP_VER`, footer).
- Core gameplay supports offline 2–10 tanks, 7 CPU types, map editor, modern/classic graphics, save/continue, shops, 30+ weapons and destructible terrain.
- Online uses the Cloudflare Worker and `Lobby`/`Room` Durable Objects. Private room creation requests four seats; the Room DO maximum is six.
- Connection handling includes retry, host/peer state sync, host migration and CPU takeover, but trust/cheat resilience is limited.
- Browser/Android game sources and binary APK coexist in the repo. The checked-in binary's internal version/signature were not verified.
- No complete automated test suite or valid repository-root GitHub Actions workflow was found.

## Current documented priorities

1. **Release reproducibility:** remove workspace-specific paths in `build.sh`; align Gradle/manual build versioning, target SDK, signer and asset inputs.
2. **Verification baseline:** move/add a valid root CI workflow and static/browser/Worker checks; conduct real Android install, update and 2-phone online session.
3. **Trust hardening:** authenticate/authorize player IDs and room actions; validate shop transactions and relay payloads; control API creation rates.
4. **Reliability:** fix quick-match room-collision exhaustion path; enforce protocol compatibility/testing; strengthen migration/snapshot behavior.
5. **Visual polish:** validate Modern mode performance and decor persistence before adding more effects.

These are engineering recommendations, **not already-open GitHub issues** and not implemented by the documentation-only PR.

## Reference documents

- [DOCS.md](../DOCS.md) — developer index and quickstart
- [ARCHITECTURE.md](ARCHITECTURE.md) — system, gameplay and storage
- [PROTOCOL.md](PROTOCOL.md) — HTTP/WS messages and trust boundaries
- [TESTING.md](TESTING.md) — acceptance matrix and test plan
- [REVIEW-2026-10-31.md](REVIEW-2026-10-31.md) — prioritized, code-linked audit
- [DEPLOY.md](../DEPLOY.md) — release checklist and precautions
- [AGENTS.md](../AGENTS.md) — contributor/agent guardrails

## Operational guardrails

Do not deploy automatically or mutate existing Durable Object migrations during a documentation/code review. Do not include keystore material, passwords, private backup archives, or Cloudflare tokens in Git. A previous historical handoff noted private backup documents containing credentials: treat the backup storage as sensitive; rotate exposed credentials if a breach is confirmed.

## Definition of done for next reliability milestone (proposal)

A clean checkout can reproducibly build web + signed test APK; required checks run on PR; an Android install/update is verified on a physical device; a two-device private game completes with shop, round transition, reconnect and host migration; release artifacts and signer are recorded. The milestone is **not yet achieved**.
