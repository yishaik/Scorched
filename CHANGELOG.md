# Changelog

Newest at the bottom. The live version is in DEPLOY.md.

- DOS-style HUD and controls with clear stat cells; Angle/Power steppers show their values.
- Fast forward: ⏩ button (1×/2×/4×), auto 8× once all humans are dead, and SKIP ROUND to jump to the round's results.
- v1.7: fixed overlapping numbers in the HUD and the Angle/Power boxes on narrow screens.
- v1.8: clear player handoff + DONE confirmation in the shop; in-game menu (resume, save/continue, settings, quit).
- v1.9: ONLINE multiplayer (quick match, rooms with code + 'fill with strangers', turn timer, CPU takeover on disconnect, host migration, simultaneous shop). Server in server/ (Cloudflare Worker + Durable Objects).
- v1.10: online shop before round 1.
- v1.11: version tags + non-blocking mismatch warning, invite links (/join/CODE) with a branded landing page, play-in-browser (/play), APK download (/download), Android deep links.
- v1.12: rotating mid-round keeps the world (uniform letterbox scaling instead of stretching); game setup (options + tank line-up) remembered between launches; online clients use the host's world size.
- v1.13: MATCH SETTINGS in the online lobby (host edits, guests see read-only; relayed as `cfg`).
- v1.14: modern graphics with a Classic toggle; prices are a tenth of the original, sold one unit at a time; map builder (setup + online lobby).
- v1.15: press-and-hold BUY/SELL repeats; trees, bushes and old wrecks on the battlefield (burnt when hit) and placeable in the map builder; wrecked-tank silhouettes in the background; button labels auto-shrink to fit.

- v1.16: online hardening from the 2026-10-31 code review: secret per-seat rejoin tokens (no seat takeover by player id), host-only authoritative messages, rate limits and size caps, protocol revision 2 (v1.15 still accepted), quick match never shares a room that failed to start; shop purchases validated against prices; host picks 2–6 players per room (Quick Match stays 4); burnt scenery kept in saves and resyncs. Build: reproducible APK from `game/`, fail-closed signing, verified deploy, root CI with tests.

- v1.17: Play Store release preparation only — no gameplay changes. Version bump to 1.17 / versionCode 17 in GAME_VER, APP_VER, the landing footer and Gradle. Added a 512×512 high-res Play icon (`marketing/play-icon-512.png`, rendered from the existing launcher vector) and `docs/store/PLAY_RELEASE_CHECKLIST.md`. The committed sideload APK `apk/ScorchedTanks.apk` stays at v1.16 / VC 16 until a signed VC17 AAB/APK is added later.

- v1.18: on-device age-group selection (under 13 / 13–17 / 18+) on first launch; parent controls locked with a 4-digit PIN (online play off by default for under 13 until a parent enables it; optional restriction of room codes / Quick Match / Share); a safety reminder before entering online play. All of this is stored only in localStorage — no accounts, no new network calls, no new Android permissions. Version bump to 1.18 / versionCode 18. Play already has 1.17, so the next upload must be VC18. The committed sideload APK stays at v1.16 / VC 16.
