# Multiplayer trust model, limits and protocol compatibility

Applies to `server/worker.js` (Worker + `Lobby`/`Room` Durable Objects) and the `Net` layer in `game/index.html`.
Covers issues #15 (seat takeover), #17 (quick-match allocation), #18 (relay authorization), #19 (abuse limits), #20 (protocol revision).

## Protocol revision (`proto`)

`proto` is separate from the app version (`GAME_VER` / `APP_VER`).

| proto | Clients | What it adds |
|---|---|---|
| 1 | v1.15 and older (send **no** `proto` query param) | — |
| 2 | this change | `proto` + `tok` query params, `tok` in `hello`, `proto` per roster player, host `{t:"max"}` |

- Server constants: `PROTO = 2`, `PROTO_MIN = 1`. A client with `proto < PROTO_MIN` gets `{t:"err", code:"upgrade"}` and close `4026` **before** it takes a seat; the client shows "Please update Scorched Tanks to play online."
- **Compatibility window:** the server accepts every proto from `PROTO_MIN` up. Today `PROTO_MIN = 1`, so v1.15 phones/APKs and `/play` keep working against the new Worker. Different versions or protos in one room only **warn** (lobby notice + toast), as before.
- Raise `PROTO_MIN` only when an old protocol is known to break a match (a gameplay message whose meaning changed). Plan: ship clients with the new proto, wait for the APK update to spread, then raise `PROTO_MIN` in its own Worker release. `/health` reports `proto` and `minProto`.
- New fields are additive: v1.15 clients ignore `tok`/`proto` in `hello`/`roster`; the new client treats a roster without `proto` (old Worker) as "no info" and does not warn on it.

## Seat ownership (rejoin tokens) — #15

- `pid` stays public (it is in the roster). Ownership is proven by `tok`, a 128-bit random hex token the Room creates when a seat is first taken. It is sent **only** in that socket's `hello`, never in `roster`, never in invite URLs, and is stored in Room DO storage with the seat.
- The client keeps tokens in `localStorage["st-tok"]` keyed by room code (max 8 rooms, 12 h TTL — rooms are re-initialisable after 6 h). localStorage, not sessionStorage, because the Android WebView (`file:///android_asset`) and browsers both keep `st-pid` there, and an app restart must still be able to reclaim the seat.
- Token lifetime = the seat's lifetime: a seat leaves on lobby disconnect or kick; every seat is wiped when the room code is re-initialised.
- Takeover rules when a socket presents an existing `pid`:
  1. Correct `tok` → takeover (the old socket is closed `4000 replaced`), same token kept.
  2. Seat owned by a proto≥2 client and no/wrong `tok` → refused: `{t:"err", code:"seat"}` + close `4003`.
  3. Seat owned by a proto-1 client (v1.15, cannot hold tokens) → allowed **only if** the old socket is closed or has been silent for `staleMs` (30 s; clients ping every 20 s). A live seat is refused with a bare close `4003` (no `err`), so a v1.15 client backs off and retries instead of stopping. On a legacy takeover a fresh token is issued.
- **Tradeoff of rule 3:** someone who knows a v1.15 player's pid (every room member sees it) can still take that player's seat while the player is disconnected — the same exposure as before, now narrowed to dead/silent seats only. A v1.15 player whose connection is half-open may wait up to ~30 s (or one RETRY) before reconnecting. Rule 3 disappears for a room once all players run proto 2, and entirely once `PROTO_MIN` is raised to 2.
- A proto-2 player who clears site storage mid-match loses the token and cannot reclaim that seat (they see "That seat is in use by another player").

## Relay authorization — #18

Enforced by the Room before relaying `{t:"relay", d, to?}`:

| `d.k` | Who may send | Extra checks |
|---|---|---|
| `cfg`, `begin`, `state`, `shopOpen`, `shopReady` | current server host only | `state.d`/`cfg.cfg` objects, `begin.players` array ≤ 12, `shopReady.pids` ≤ 16 |
| `shop` | anyone, for themselves | `d.pid` must equal the sender's pid; `stock`/`items` arrays ≤ 128 |
| `aim`, `fire`, `item`, `move` | anyone (turn ownership is checked by clients) | `ti` integer 0–63 |
| `needState`, others | anyone | object with string `k` ≤ 24 chars |
| `rejoin` | server only | always dropped from clients |

`to` must be a connected pid. Room control messages (`start`, `end`, `snap`, `public`, `kick`, `max`) are host-only as before; `snap` must be an object. `pid` `"server"` is reserved and replaced.

**Remaining limits (documented, not fixed):** the server does not know turns, physics or economy. The host is trusted: a malicious host can still send any state. Turn ownership of `aim/fire/item/move` and the shop economy are checked by clients/host (the host re-validates shop totals, #16). This is casual friendly play, not anti-cheat.

## Abuse limits — #19

| Limit | Value | Response |
|---|---|---|
| `POST /api/room` per IP (kept in the Lobby DO) | 10/min and 60/h | `429` + `retry-after` |
| `POST /api/room` body | 1 KB | `413` |
| WebSocket upgrades per IP | 30/min per room, 30/min for quick match | `err code:"rate"`, close `4029` |
| Frame size before `JSON.parse` | host 2,000,000 chars, others 32,768 | dropped |
| Per-kind caps | `begin`/`cfg` 64 KB, `shopOpen` 4 KB, `shopReady` 8 KB | dropped |
| Messages per socket | bucket 60, refill 30/s | dropped; close `4029` after 300 drops |
| Lobby socket | 256 chars, 10 burst, 1/s | dropped |

Counters (`Room.stats`: auth/big/shape/rate/seat) and `console.log` lines record only counts and room codes — never tokens or snapshots.

**CORS:** `/api/*` echoes the request `Origin` only when it is `https://tanks.yishaik.com`, `https://scorched-tanks.yishai-k.workers.dev`, `null` (the Android WebView loads `file:///android_asset/index.html`, whose fetches send `Origin: null`), or `http://localhost|127.0.0.1[:port]`. Extra origins: Worker var `ALLOWED_ORIGINS` (comma-separated); `CORS_ANY=1` restores `*`. `/health` stays `*`. CORS only limits browsers; the per-IP limits are the real control.

## Quick-match allocation — #17

`Lobby.launch()` sends `matched` only after a `Room.init` answered 200. If eight attempts fail (409/503/network), the group goes back to the front of the queue with `{t:"err", code:"retry"}` (a toast on clients) and is retried after 3 s, 6 s; after the third failed launch players get `{t:"err", code:"busy"}` and close `1013` (clients show "Disconnected from the server" and return to the online menu). `POST /api/room` returns `503` without a code on exhaustion.

## Tests

`node --test tests/*.test.mjs` (Node 18+, no dependencies). `tests/worker.test.mjs` runs the Worker with mocked `WebSocketPair`, DO storage and namespaces.
