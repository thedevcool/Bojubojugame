# Boju Boju — Engineering Standards

These standards are binding for every change to this repository, by humans or agents.
They exist so that a live, multiplayer, money-like (but virtual) game ships without
cheats, crashes, or player harm. When a rule here conflicts with convenience, the rule wins.

---

## 1. Non‑negotiable principles

1. **Server is authoritative.** Timers, dice, tags, phase transitions, positions, hunger,
   wallet balances and results are decided on the server. The client only *requests*.
   Every client message is treated as hostile input.
2. **Naira is virtual.** No real money, payments, withdrawals, bank names, account-number
   fields, card fields, or payment-style UI. Every wallet surface shows
   *"In-game naira — not real money"*.
3. **No personal data.** No email, phone, precise location, or real names. "Home" is an
   area name from a fixed list.
4. **Config over code.** Every tunable number (scoring, prices, timers, speeds, hunger,
   limits) lives in `backend/app/content/game_config.json`. Items, maps and places are
   data, not code. Adding an item or a prop must not require a code change.
5. **Pure core, thin shell.** Game rules and geometry are pure functions with unit tests
   (`backend/app/engine/`). Networking, DB, and timers wrap them; they never re‑implement them.
6. **Mobile first.** Every feature must run at ≥30 fps on a mid‑range Android phone and
   respect the data budget (§7). If it can't, it ships behind the quality setting.
7. **Small phases, always shippable.** `main` must always build, pass CI, and be deployable.

## 2. Repository layout

```
backend/            FastAPI app (Python 3.12+)
  app/engine/       Pure rules + geometry. No I/O, no globals, no time.time().
  app/content/      game_config.json + maps/*.json (single source of truth)
  app/realtime/     WebSocket protocol, rooms, server tick
  app/*.py          settings, db, auth, economy, safety, REST api
  tests/            pytest suites (engine, economy, room state machine, API smoke)
frontend/           Next.js App Router + TypeScript + Tailwind + R3F
  src/game/         3D scene, controls, netcode client, interpolation
  src/ui/           HUD and screens
  src/lib/          api client, store (Zustand), shared types
docker-compose.yml  Local Postgres + Redis + backend
```

The backend serves map and config JSON to the frontend (`GET /api/content`), so there is
exactly one copy of every number and every map.

## 3. Language standards

### Python (backend)
- Python ≥3.12, full type hints on every function; `mypy --strict`‑clean for `app/engine`.
- Lint/format with **ruff** (`ruff check`, `ruff format`). No unused imports, no bare `except`.
- Every inbound payload (REST body, query, WS message) is parsed with a **Pydantic** model
  with explicit bounds (`max_length`, `ge`/`le`). Unknown fields are ignored, never trusted.
- Async all the way in request paths. No blocking I/O on the event loop.
- Randomness that affects outcomes uses `secrets.SystemRandom` (dice) and is injectable for tests.
- Time is injected (`now: float`) into anything with timers so it can be tested deterministically.
- Money is **integer naira**. Never floats for money.

### TypeScript (frontend)
- `strict: true`; no `any` (use `unknown` + narrowing). ESLint (next config) must pass.
- React components are function components; 3D per‑frame logic lives in `useFrame` and mutates
  refs — never `setState` per frame.
- Zustand stores hold UI/session state; high‑frequency data (positions) lives in mutable refs
  / plain objects outside React.
- All user text renders via React (auto‑escaped). `dangerouslySetInnerHTML` is forbidden.

## 4. Networking protocol rules

- One WebSocket per player at `/ws?token=<jwt>`; messages are **msgpack** maps with a `t` type key.
- Client → server movement at ~12 Hz; server snapshots at 10 Hz; positions quantized to
  centimetres (ints).
- Server validates every movement: max speed (with stamina), map bounds, solid collision,
  and wall tunnelling (segment test). Invalid ⇒ reject and send a correction (`corr`).
- Interest management: hub players receive only players within the interest radius;
  arena players receive only their room. **Seekers never receive a hider's position unless
  that hider is within visibility range and has line of sight** (server‑side culling).
- Out‑of‑phase actions are rejected with an `err` message, never silently applied.
- Every message type has a per‑connection rate limit. Oversized frames (>4 KB) close the socket.
- Reconnect is first‑class: on connect the server re‑attaches the player to their group,
  phase and last validated position.
- Protocol changes must update both `backend/app/realtime/protocol.py` and
  `frontend/src/lib/protocol.ts` in the same commit.

## 5. Economy & data integrity

- Wallet balance = `SUM(ledger.amount)` for the player. The ledger is **append‑only**:
  no UPDATE or DELETE on ledger rows, ever.
- Every ledger write carries an `idempotency_key` (unique). Retrying a request must never
  double‑charge or double‑pay. Round rewards use `round:<game>:<n>:<player>` keys.
- Spends run in one transaction that locks the player row, recomputes the balance, and
  refuses if the result would be negative.
- Penalties clamp at zero (balance never below ₦0).
- No player‑to‑player transfers in v1 (pickup tips are the only exception, capped per day).
- Schema changes go through SQLAlchemy models; destructive migrations need a written plan.

## 6. Security & safety checklist (every PR)

- [ ] Inputs validated with Pydantic, with length/number bounds.
- [ ] No secret in code or git. Secrets only via env vars; `.env.example` updated.
- [ ] CORS allows only `FRONTEND_ORIGIN`. Security headers middleware untouched or improved.
- [ ] New REST endpoint has a rate limit; new WS message type has a rate limit.
- [ ] User text (nicknames, chat) passes `safety.clean_text` (length, profanity, no links).
- [ ] No real‑money wording, payment UI, or real brand logos/people.
- [ ] Server decides the outcome; client value is only a request.
- [ ] Chat rules: 300 chars max, text only, no links, disabled for in‑game players during
      hide/seek (taunt emotes only), 30‑day retention.

## 7. Performance budget

| Item | Budget |
|---|---|
| Initial JS+assets (gzipped) | < 15 MB (target < 2 MB in Phase 1) |
| Frame rate | 30 fps mid Android, 60 fps desktop |
| Draw calls (Low quality) | < 150 |
| Movement upstream | ≤ 15 msgs/s, < 64 bytes each |

- Repeated props use instancing; geometry is shared and memoised.
- Shadows only on High; Low uses DPR ≤ 1 and fog to cut draw distance.
- Big downloads show their size first; static assets cached by a service worker.

## 8. Testing

- `app/engine` has unit tests for **every** rule in the spec: dice, scoring, next seeker,
  retirement, end condition, tag validation, LOS, collision, speed validation.
- Economy tests cover idempotency, insufficient funds, and ledger/balance agreement.
- The group room state machine is tested end to end with a fake clock and fake RNG
  (lobby → travel → dice → hide → seek → tag → results → game over).
- Frontend: `tsc --noEmit`, `next lint`, and `next build` must pass.
- A bug fix lands with a test that fails before the fix.

## 9. Git & CI

- Branch per change; small commits with imperative subjects (`Add safe-house capacity check`).
- CI (`.github/workflows/ci.yml`) runs ruff, pytest, tsc, lint and build. Red CI never merges.
- Never commit `.env`, build output, `node_modules`, or large binaries. Assets >1 MB go to the CDN.
- Never disable, skip or delete a failing test to get green.

## 10. Observability & operations

- Structured logs (one line per event) with `player_id`/`game_id`, never tokens or secrets.
- `/health` returns DB connectivity and process uptime. Fly health checks use it.
- Unhandled exceptions in a room are caught and logged; one broken room must never crash
  the process or other rooms.
- Backend runs on an always‑on instance (no sleeping free tiers) — live rooms are in‑process.

## 11. Content & assets

- Only original, CC0 or properly licensed assets. Every third‑party asset gets a row in
  `CREDITS.md` with its license and source *before* it is committed.
- Lagos‑inspired, not replicas: no real brand logos, real people, or exact buildings.
- Places and props are assembled from the modular kit defined by map JSON.

## 12. Player-facing changelog

- Every release that players can notice adds an entry at the **top** of
  `frontend/src/lib/changelog.ts` (new `version`, a short title, 2–5 items with emoji,
  and an optional "Try it" hint). The "What's new" sheet then appears once for each
  player, and the full list stays under Settings → What's new.
- Write in the game's playful voice; no internal jargon.

## 13. UI look & motion

- UI theme is **Boju blue** (`--accent` tokens in `app/globals.css`). The 3D world keeps
  real Lagos colours (yellow danfos, laterite, zinc); don't recolour the scene to match the UI.
- Motion follows iOS feel: sheets slide up with `--ease-ios`, cards pop with `--ease-spring`,
  buttons compress on press. Use the `anim-*` classes; honour `prefers-reduced-motion`.
- Every choice a player makes should show a preview (3D, animation or live summary).

## 14. Definition of done (per feature)

A feature is done when: it follows these standards, its rules are config‑driven, it has
tests, CI is green, it works on a phone‑sized viewport, and the README is updated if setup
or behaviour changed.
