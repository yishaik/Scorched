# Scorched Tanks

> Picking this up? Read [docs/HANDOFF.md](docs/HANDOFF.md) and [AGENTS.md](AGENTS.md) first.

A tribute recreation of **Scorched Earth** (1991, DOS, Wendell Hicken), playable in the browser and on Android with touch.

- `game/index.html` is the whole game: HTML5 Canvas plus WebAudio. Open it in a browser to play.
- `android/` is a minimal WebView wrapper. It runs fullscreen and rotates with the phone, portrait or landscape.
- `apk/ScorchedTanks.apk` is the latest Android build.
- `DOCS.md` holds the full documentation: architecture, features, controls, how to build, and known gaps.
- `build.sh` builds the APK without Gradle, using aapt, d8, zipalign and apksigner.
  - It needs `android.jar` (platform 34) and the build-tools jars.
  - Edit the `A=` path at the top of `build.sh` to point at those.
  - It signs with `key.jks`. The key is kept out of git, so keep using the same key or updates won't install over the old version.

## Features
- 2–10 tanks, human or CPU: Moron, Shooter, Poolshark, Tosser, Chooser, Spoiler, Cyborg.
- All the classic weapons: nukes, MIRVs, rollers, diggers, napalm, dirt weapons, laser and more.
- Shields, parachutes, fuel, guidance.
- A shop between rounds.
- Destructible pixel terrain.
- Options for wind, walls, gravity, terrain and sky.
- Touch: drag on the battlefield to aim, then press FIRE.
- Online multiplayer: quick match, private rooms, invite links; the host edits match settings in the lobby.
- Map builder: draw the ground with a finger, place trees, bushes and wrecks; maps work online too.
- Modern hand-painted look (sky, parallax hills, grass, rocks, trees that burn, smoke) or the Classic look.

## Recent changes (v1.9, Oct 2026)
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

Marketing assets and store copy: `marketing/` (feature graphic 1024×500, screenshots, square promo, COPY.md). Re-render with `tools/render/` (node + node-canvas).

See DEPLOY.md for live links and the release checklist.
