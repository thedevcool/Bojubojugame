# Deploying Boju Boju

## Free route (market test, ₦0/month)

| Part | Service | Free plan notes |
|---|---|---|
| Database | **Neon** | Free Postgres; choose region **Frankfurt (aws-eu-central-1)** |
| Backend | **Render** (free web service) | Sleeps after 15 min with no players; the first visitor after that waits about 1 minute |
| Frontend | **Vercel** Hobby | Free CDN; fine for a non‑commercial test |

None of these should ask for a card on the free plan.

### 1. Neon
1. Sign up at neon.tech with GitHub. Create a project, region **AWS Frankfurt**.
2. Copy the **connection string** (`postgresql://…?sslmode=require`).

### 2. Render (backend)
1. Sign up at render.com with GitHub and allow access to the `Bojubojugame` repo.
2. Click **New → Blueprint**, pick the repo and the branch, and Render reads `render.yaml`.
3. When it asks, paste:
   - `DATABASE_URL` = the Neon string
   - `FRONTEND_ORIGIN` = `https://placeholder.vercel.app` for now (you fix it in step 4)
4. Wait for the deploy, then open `https://<your-service>.onrender.com/health`. It should show `"ok": true`.

### 3. Vercel (frontend)
1. Sign up at vercel.com with GitHub. **Add New → Project**, import `Bojubojugame`.
2. Set **Root Directory = `frontend`**.
3. Add the environment variables:
   - `NEXT_PUBLIC_API_URL` = `https://<your-service>.onrender.com`
   - `NEXT_PUBLIC_SITE_URL` = your Vercel URL (you can fill it in after the first deploy and redeploy)
4. Deploy.

### 4. Connect them
On Render: **Environment → FRONTEND_ORIGIN** = your exact Vercel URL, e.g. `https://boju-boju.vercel.app`
(no slash at the end). Save, and Render restarts. Without this, the browser will block the game's connection to the server.

### Accounts & password-reset email
- Players sign up with **username + password**; email is optional and only used for resets.
- On Render set `PUBLIC_FRONTEND_URL` = your Vercel URL (used inside reset links).
- To actually send reset emails, add an SMTP account (free options: **Brevo** — 300 emails/day,
  or a **Gmail app password**): set `SMTP_HOST` (e.g. `smtp-relay.brevo.com`), `SMTP_USER`,
  `SMTP_PASSWORD`, `MAIL_FROM`. Without SMTP the server still works and just logs the reset link.
- Accounts created before passwords existed get a username from their nickname and the temporary
  password `123456`; they must choose a new password before they can play.

### Optional: keep it awake
To skip the 1‑minute wake‑up, create a free job at cron-job.org that opens
`https://<your-service>.onrender.com/health` every 10 minutes. One service running
all month (~744 h) fits inside Render's 750 free hours. Don't run a second free service
the same way, or both get suspended for the rest of the month.

### Free‑plan limits to know
- Restarts and deploys end any game in progress. Wallets, results and chat are kept in Neon.
- Render's free bandwidth is limited, which is plenty for a test with a few hundred players.
  Watch the usage page.
- Once players are hooked, move to the paid route below with no code changes.

---

## Paid route (always on, closer to Lagos)

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
