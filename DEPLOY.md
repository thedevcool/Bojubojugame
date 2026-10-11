# Deploying Boju Boju

Order: **database → backend → frontend → set the backend's allowed origin.**

## 1. Postgres (Neon, free tier)

1. Create a project at neon.tech in the region closest to the backend (e.g. `aws-eu-central-1`).
2. Copy the connection string (`postgres://…?sslmode=require`). The backend converts it to
   the asyncpg format by itself. Tables are created on first boot.

## 2. Backend (Fly.io, Johannesburg, always on)

```bash
cd backend
fly launch --no-deploy --copy-config        # keep fly.toml (region jnb, never sleeps)
fly secrets set \
  DATABASE_URL='postgres://USER:PASS@HOST/DB?sslmode=require' \
  JWT_SECRET="$(python -c 'import secrets;print(secrets.token_urlsafe(48))')" \
  FRONTEND_ORIGIN='https://YOUR-APP.vercel.app'
fly deploy
curl https://boju-boju-api.fly.dev/health    # {"ok": true, ...}
```

- Keep **one machine** for v1, because live rooms are kept in memory (`min_machines_running = 1`,
  auto‑stop off). Don't use free tiers that sleep: they break live games.
- With `ENV=prod`, the server refuses to start with the default JWT secret, rejects WebSocket
  connections from other origins, and sends HSTS headers.

## 3. Frontend (Vercel, Hobby)

1. Import the GitHub repo in Vercel and set **Root Directory = `frontend`**.
2. Environment variables:
   - `NEXT_PUBLIC_API_URL=https://boju-boju-api.fly.dev`
   - `NEXT_PUBLIC_SITE_URL=https://YOUR-APP.vercel.app`
3. Deploy. Build assets are served from Vercel's CDN with immutable cache headers and cached
   again by the service worker.
4. If the final domain differs from what you set, update `FRONTEND_ORIGIN` on Fly
   (`fly secrets set FRONTEND_ORIGIN=…`).

## 4. Smoke test (two phones)

1. Phone A: open the site, sign up, tap **Play Boju → Create group**, then tap **Invite friends**.
2. Phone B: open the invite link, sign up, and you join the group automatically.
3. A taps **Start game**. Both walk to the yellow **Bus Stop** and board (or wait 60 s to be
   auto‑boarded).
4. Pick dice numbers, hide, seek, tag with **BOJU!**, and check the results, the game‑over
   card, **Share on X**, and **🏆 Leaderboards**.
5. Open the wallet: the balance should equal the sum of the entries listed.

## Operations

- Logs: `fly logs`. Health: `/health` shows DB status, uptime, and how many groups and players are online.
- Chat messages older than 30 days are deleted every hour by the server.
- Reports are stored in the `reports` table; review them with `psql`.
- Tuning: edit `backend/app/content/game_config.json`, commit, and `fly deploy`.
