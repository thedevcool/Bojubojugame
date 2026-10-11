# Boju Boju in LagosLife (mini version)

LagosLife shows web games inside its **Games app** using the Vatar Games SDK v1
(<https://lagoslife.app/developers/docs>). Our mini version lives at **`/lagoslife`**.

| | Full version (our site) | Mini version (inside LagosLife) |
|---|---|---|
| Sign-in | Username + password | LagosLife signs the player in (no login screen, no email) |
| Money | Our virtual naira | LagosLife's: none of our naira is shown; rides are free |
| Home, shops, cars, food | ✅ | Live in LagosLife (shops are hidden, "home" = tap ← in LagosLife) |
| Hide & seek, Live games, NPCs, exploring | ✅ | ✅ (same server and arenas: both sets of players meet) |
| Friends | Boju friends + invites | 🤝 **Play with friends**: LagosLife match codes (6 letters), optional stakes in LagosLife game money |
| Leaderboard | Ours | LagosLife's (your best game counts) |
| Wall ads | Paystack (real money) | Free to send → we approve → pay in LagosLife (📱 → My ads) |

LagosLife players are separate accounts from our site's. Their IDs only exist inside LagosLife,
so a LagosLife player who wants the full version makes a normal account on our site.

## How it works (code)
- `frontend/app/lagoslife/page.tsx` loads the SDK, calls `Vatar.init()`, signs in through
  `POST /api/vatar/session`, then runs the normal game with `mini` set in the store.
- `backend/app/vatar.py`:
  - checks the session token with LagosLife, then makes or finds the mini account (`players.vatar_id`);
  - verifies ad purchases (`ad_s`, `ad_m`, `ad_l`, `ad_xl`) with LagosLife, gives each one once, then marks it delivered;
  - verifies the webhook signature;
  - links a LagosLife match to one private game, and posts the signed winner when the game ends
    (most points wins; a tie is a draw).
- Only `/lagoslife` can be framed, and only by LagosLife's addresses (`frontend/next.config.ts`).
  Every other page keeps `X-Frame-Options: DENY`.
- The mini version never shows Paystack, payment links, our naira, logins or emails
  (LagosLife review rule 8).

## Set it up
1. In LagosLife → Developers → **Get your keys**:
   - studio and contact email;
   - game **Boju Boju**;
   - address `https://<your-vercel-app>/lagoslife`;
   - webhook `https://<your-render-service>.onrender.com/api/vatar/webhook`.
2. On Render, set:
   - `VATAR_SECRET` (`vtr_test_…` for now);
   - `VATAR_WEBHOOK_SECRET` (`vtr_whsec_test_…`);
   - `VATAR_RESULTS_SECRET` (the results secret shown with your keys).

   Leave `VATAR_API` at its default.
3. In the dashboard, add four **consumable** products. The ids must match exactly:

   | Product id | Name | Price |
   |---|---|---|
   | `ad_s` | Small wall poster (7 days) | ₦5,000 |
   | `ad_m` | Medium wall poster (7 days) | ₦10,000 |
   | `ad_l` | Large wall banner (7 days) | ₦18,000 |
   | `ad_xl` | Billboard (7 days) | ₦30,000 |

4. Tick **multiplayer** for the game, so that "Play with friends" matches work.

## Test in the sandbox (no money)
Open `/developers/sandbox/<draft>` in LagosLife, then:
1. The game opens straight into Lagos; the top-left shows your LagosLife name and **TEST**.
2. Tap a shop wall, tap **📢 Place ad here** and send a poster. Approve it at `https://<your-vercel-app>/admin`.
   Then 📱 → **My ads** → **Pay**, choose **Pay (test)**, and the poster goes live.
3. Open a second sandbox player. On the first: 📱 → **Play with friends** → **Create**. On the second: enter the code.
   Both land in one game at the Motor Park, and the game starts on its own.
4. Finish the game. The winner is posted to LagosLife, and your score shows in 📱 → **Leaderboard**.

The dashboard checklist should tick itself as you go. Then add the listing (512 px icon, 3–5
screenshots at 375×812, short description) and **Submit for review**. After approval,
swap the Render secrets for the `vtr_live_…` ones.

## Later: what to ask LagosLife for
If they allow the full experience inside LagosLife, these are the gaps their SDK doesn't cover yet:
- **Invite a LagosLife friend:** a sheet that sends a friend a game link with a code, plus `Vatar.friends()`.
- **Go home:** a call that closes the game and takes the player to their LagosLife home.
- **Game money for players:** per-player credits and debits in LagosLife's game money. Our server would send
  a request signed like match results; their server checks it against limits and replies with the result.
  For example:
  ```
  POST /api/games/v1/wallet/credit   { playerId, amount, reason: "round_win", ref: "<our game id>:<round>" }
  POST /api/games/v1/wallet/debit    { playerId, amount, reason: "bus_fare", ref: "<unique id>" }
  → { id, status: "applied" | "refused", balance? }  (refs are idempotent; they set daily caps)
  ```
  With that, fares, food and round prizes could use LagosLife money instead of being hidden.
