# Boju Boju — Changelog

This file is a **hard gate**. CI (`scripts/changelog_gate.py`) fails a pull request when it:

1. changes game code (`backend/app`, `frontend/src`, `frontend/app`, `frontend/public`) without adding a
   new release section at the top of this file;
2. has a top release version different from the newest `version` in `frontend/src/lib/changelog.ts`
   (the player-facing "What's new");
3. removes or rewrites a line in **Protected features** without saying so in its release section with
   "Removes `Pxx`" or "Changes `Pxx`" (and why: the owner asked for it, or the new update needs it).

**Protected features** are approved by the owner and working. They must never disappear or change as a
side effect of other work (see ENGINEERING_STANDARDS.md §1.8). New approved features are added to the
register in the release that ships them.

---

## 2.11.2 — 2026-10-12
- New players get the guided tour again, and never the What's New sheet. Tour progress, tour
  completion and the first-game guide answer were kept per phone, so on a phone where someone had already
  taken the tour, every new account skipped it (and saw What's New instead). They are now kept per account.
- The welcome card waits until the city has actually been built (before, it flashed up for a moment and
  vanished until the build finished).
- This changelog, the protected-features register and the CI gate that enforces both.

## Protected features (approved & working)

### Accounts & first run
- `P01` **Username + password accounts** — sign up with username, password (twice), optional email; log in by username or email; forgot password by email.
- `P02` **Welcome back screen** — returning phones see Enter Lagos, Log in as someone else, and Create new account (which opens the sign-up form).
- `P03` **Look picker** — male/female body, 4 hairstyles each, skin, ankara top, trousers/wrapper, live 3D preview at sign-up; change any time in Settings → My look (others see it at once).
- `P04` **Guided tour for new players** — "Show me around" (or Not now): walk, look, buy a phone, rent a house, walk home, map, Aerial, hiding vs seeking, start a game; skippable; progress kept per account; short version in LagosLife.
- `P05` **First-game guide** — a small "Want a quick guide?" card; Yes starts the shortest practice game (you + 1 NPC) and the guide card walks through code/invite, Start, bus, circle, dice, hide or seek (Run, Bend, safe house, Aerial to watch Boju) and the result; the button to press glows; new info pulses; Exit any time.
- `P06` **What's New** — shows once per release for returning players only (never for new players), plus Settings → What's new.

### Playing Boju Boju
- `P10` **Game flow** — lobby with code/invite/NPCs → bus to the arena → gather circle → dice pick → hide (song) → seek → result → game over; Quick game with NPCs, play with friends, public games, live games.
- `P11` **Coach bar** — the one thing to do now for your role, with the timer; big RUN & HIDE / FIND THEM / BOJU IS COMING flashes.
- `P12` **Boju Boju song** — male/female recordings while Boju counts, with lyric captions in sync ("Boju Boju o!" ×2, "Ṣé kí n ṣí?" ×2); Settings choice.
- `P13` **Catching** — Boju catches by walking close (no button); safe house protects for 20 s in total; safe-house compass.
- `P14` **Hiding-spot reveal** — after a round, the camera visits unfound hiders' spots with how close Boju came.
- `P15` **Game over + rematch** — podium/winner screen; Play again asks the other players (Accept/No).
- `P16` **Aerial view** — look from the sky (and during games).

### Life in Lagos
- `P20` **Phone** — opens/closes (tap outside closes it; dialogs over it don't); apps: Boju Boju, Houses, Messages, Map, Wallet, Settings, etc.; swipeable shop lists.
- `P21` **Shops** — Tini Tech phones, furniture, Tokunbo Autos cars, food (belle).
- `P22` **Houses** — rent, walk in through your door, room & parlour, decorate, sleep and sit; neighbours knock.
- `P23` **Cars & driving** — pedals/steering, tap-to-drive on roads; the whole car collides with stalls, parked cars and lamp posts; shop menus become a hint while driving.
- `P24` **Streets** — traffic that waits and honks, crowds (incl. market women), nobody walks or drives through anybody.
- `P25` **Map & travel** — minimap, full map with pins, real map of Naija, rides between cities and venues.
- `P26` **Places** — Lagos hub (Adeniji Street, Church Street, Palm View Estate, Market & Motor Park, Events Ground, Football Pitch); Ibadan (Agodi Gardens, Akobo); Abuja.
- `P27` **Controls** — tap to go by default, joystick option, drag to look, pinch to zoom, Bend, Run, Sit, emotes.

### Money, ads & LagosLife
- `P30` **Virtual naira** — in-game naira only, never real money; daily bonus.
- `P31` **Wall ads** — place on kiosks/shops/billboards/arena walls, admin approves, Paystack on our site.
- `P32` **LagosLife mini version** (`/lagoslife`) — signed in by LagosLife; never shows Paystack, payment links, our naira, a login or an email field; play-with-friends matches; LagosLife leaderboard; ads paid with LagosLife's pay sheet (My ads refreshes itself).

### Look & performance
- `P40` **Neon-glass look** — deep-space background, glass panels with a gradient edge, gradient glowing buttons, glass fields, Space Grotesk titles; redesigned sign-in screen.
- `P41` **Low-end phones first** — city builds in a few seconds on the low-end profile, no main-thread task over ~1 s, pauses drawing while building; UI never sits under the browser toolbar.
- `P42` **iPhone layout** — safe areas respected when installed; Install app.

---

## History

| Version | Date | Title |
|---|---|---|
| 2.11.2 | 2026-10-12 | New players get the tour, not What's New; changelog gate |
| 2.11.1 | 2026-10-12 | A fresh new look ✨ |
| 2.11.0 | 2026-10-12 | Akobo, new looks, and a guide for your first game 🙈 |
| 2.10.0 | 2026-10-12 | A guide for new players 🧭 |
| 2.9.2 | 2026-10-12 | No more freezing on start 🧊 |
| 2.9.1 | 2026-10-12 | Smoother, and tap to go 👆🏾 |
| 2.9.0 | 2026-10-11 | Oh no, I passed there! 👀 |
| 2.8.1 | 2026-10-11 | Boju Boju, the song 🎤 |
| 2.8.0 | 2026-10-11 | The game now teaches you 🧭 |
| 2.7.1 | 2026-10-11 | Rematch, the proper way 🔁 |
| 2.7.0 | 2026-10-11 | Rematch! 🔁 |
| 2.6.0 | 2026-10-11 | Lagos traffic with wahala 🚦 |
| 2.5.0 | 2026-10-11 | Boju Boju is coming to LagosLife 🎮 |
| 2.4.0 | 2026-10-11 | Your brand on Lagos walls 📢 |
| 2.3.0 | 2026-10-11 | Our own map of Naija 🗺️ |
| 2.2.0 | 2026-10-11 | Play with real people 👥 |
| 2.1.0 | 2026-10-11 | Real homes, cars & travel Naija 🚗🏡 |
| 2.0.0 | 2026-10-11 | Boju Boju v1: your life in Lagos 📱🏠 |
| 1.4.0 | 2026-10-11 | Proper accounts + install the app 📲 |
| 1.3.0 | 2026-10-11 | Travel Naija 🇳🇬 |
| 1.2.0 | 2026-10-11 | Fresh new look 🙈 |
| 1.1.0 | 2026-10-11 | Living Lagos |
| 1.0.0 | 2026-10-11 | Boju Boju is here |
