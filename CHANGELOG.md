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

## 2.17.0 — 2026-10-17
Owner requests:
- Don't unpack everything at once. Unpack only where the player is; the ride is the loader; pack away the place
  they left.
- "Agodi garden… where they are spawned to when they choose Ibadan".
- "Akobo will be the hardest place, so it will be for the event, we won't match people to play there yet".

Changes:
- Changes `P41`: **places load one at a time.**
  - The start-up download carries only a summary of each place: names, zones, safe houses, bounds. Its props were
    the bulk; the download is now about 20 KB in total.
  - A place's full plan is fetched from `GET /api/maps/{id}` (cached, with an ETag) when you go there.
  - The ride screen is the loader: it ends when its time is up *and* the place is downloaded and built. A slow
    phone stays on the bus a little longer rather than arriving in a half-built place (25 s at most).
  - Only where you are and where you just were stay on the phone; anything older is packed away. The 3D of the
    place you left is freed, its ground texture included.
  - Watching a game fetches that place's plan only for the watch screen.
  - Low-end check: on start only Lagos was downloaded; the arena was fetched during an 8 s ride; the ride screen
    lifted at 9.7 s with the place built; no main-thread task over 1 s; no errors.
  - Test: `test_places_load_one_at_a_time`.
- Changes `P26`: **Ibadan players live at Agodi Gardens** (they spawn there). **Akobo is for events only**: it
  moved to the city's `event_arenas`, so Match me and quick games never send anyone there; it still exists for
  events.

## 2.16.0 — 2026-10-17
Owner request: "let's pack the buy house, etc and just make it about the game only". Users come in to a storefront
where a Yoruba man introduces the game. With anyone else online they get "Play with online players" (Match me, or
Join a group); with nobody online, "Play with NPCs". Location is optional: if it says Lagos or Ibadan they live
there, otherwise they choose, and they always spawn there. "Instead of belle and energy… money and win streak broken
into hide streak and win streak".

Changes:
- **Storefront.** Everyone arrives at Baba Boju's stall: an elder in a face cap (3D) and a typed welcome in pidgin
  ("Welcome <name>, na you we dey wait for! You remember that time we dey play Boju Boju?…"). Tap the bubble to
  skip the typing. Then:
  - **City.** The first time, "📍 Use my location" checks the phone's location: within about 70 km of Lagos or about
    45 km of Ibadan makes that your city. Otherwise, or if location is refused, you choose 🌆 Lagos or 🌳 Ibadan.
    The choice is saved on your account (and can be changed there), and you always spawn in your city: Lagos at
    the hub, Ibadan at Akobo. Games you start are played in your city.
  - **Someone else online** (`/api/online`): "🎮 Play with online players" → **⚡ Match me** or **🔑 Join a group**.
    Join a group is unchanged (code, invite, Live games).
  - **Nobody else online:** "🤖 Play with NPCs".
  - "Walk around first" closes the storefront. The guided tour and move hints wait until it's closed.
- **Match me (new).** It puts you in the best waiting match: same city first, then the fullest (it starts soonest),
  then the one waiting longest. No match waiting: a new one opens with you as host, and the next "Match me" lands
  there. Matches start themselves:
  - with 4 real players;
  - or 12 s after a second real player joins;
  - alone for 40 s: NPCs fill in to 3 and it starts ("Nobody else free right now — you're playing NPCs").
  - The coach shows "Finding players… n/4".
  - Tests: `test_match_me_pairs_players_and_starts_itself`, `test_match_me_alone_plays_npcs`.
- **Money and streaks replace belle and energy.**
  - The top bar shows money and 🥷 hide streak and 🏆 win streak; the breath bar stays on the Run ring.
  - Hide streak: rounds in a row you weren't found (being found resets it). Win streak: games in a row you finished
    first (losing or leaving resets it). Bests are kept, for events later.
  - Stored on the account, sent with the wallet, and shown on the phone's home screen and in Wallet.
  - Hunger no longer stops anyone playing, and rounds no longer use it up.
  - Test: `test_streaks_count_wins_and_hides`.
- Changes `P21`, Changes `P22`, Changes `P23`: **the extras are packed away, not deleted** (`frontend/src/lib/scope.ts`,
  `GAME_ONLY = true`). Shops (phones, furniture, cars, food), the Houses app, decorating, sleeping and driving are
  hidden. Everyone gets a phone for free.
- Changes `P04`: the tour is game-only for everyone (walk, look, Aerial, hiding vs seeking, first game).
- Changes `P20`: no Houses app; the phone's Home card is now Streaks.
- Changes `P25`: the map is the area you're in (no Naija trips); the bus stop only rides you home (your city).
- Games can now start from Ibadan: everyone is taken to their own bus stop to board.
- Housekeeping: `.opencode/server.lock.json` (a local editor lock file with a password) is no longer tracked and is
  ignored.

## 2.15.1 — 2026-10-17
Owner reports:
- LagosLife review rule 4: "Handle onPause and onResume so sound and timers stop."

Changes:
- **Solo games pause (Changes `P33`).** In a game with only you and NPCs, the whole game stops while you're away:
  LagosLife's pause, minimising or closing the app. The countdown, the bus ride, the circle and the NPCs all
  freeze, and everything carries on from the same second when you're back.
  - LagosLife: `onPause` sends `g_pause`, `onResume` sends `g_resume`. A fresh connection un-pauses too, in case
    the resume was sent while offline.
  - A game with other people never pauses, because they're still playing; your stand-in holds your place as before.
  - Tests: `test_solo_game_pauses_and_resumes`, `test_multiplayer_game_never_pauses`.

## 2.15.0 — 2026-10-15
- **Player directory.** Admins can search and page through all player accounts, then open a live detail view with profile, account state, visit time, gameplay, social/property counts and ad payment history. Credentials and device secrets are never returned.
- **Paystack ad revenue.** Admin totals include only charges confirmed by Paystack's verify API or signed webhook, with refunds subtracted from net collected. Fake checkout and LagosLife ad purchases are excluded; net collected is not the Paystack settlement amount after fees.

## 2.14.0 — 2026-10-15
- **Admin analytics.** The protected admin page now shows player and visit totals, connected players, current and completed games, activity by day, seeker and hider leaderboards, time-spent rankings, and popular arenas. The dashboard refreshes every 15 seconds and keeps wall-ad review.
- **Visit and time tracking.** Authenticated game connections are recorded by the backend. Time spent is measured from those connections; earlier visits cannot be reconstructed. Abandoned open sessions are closed when the backend starts again.
- **Backend-owned metrics.** The frontend renders the protected `/api/admin/analytics` response; it does not calculate or persist analytics.

## 2.13.0 — 2026-10-13
Owner reports:
- "A user cannot cancel a game".
- After coming back, "I can't seem to click on the dice till the time ran out… the overlay is just like that there".
- "The NPCs more competitive… more smart when hiding".
- The dice should be "more minimal… an actual dice, the numbers round the dice… then the dice rolls for real… the
  number glows… the person that will Boju will have the icon on his head".
- "The you win cannot be scrolled up on this device size".
- "The game logic is correct end to end".
- "Redesign the maps a little more realistic… names of the places".
- "Taking the player back a few frames back while walking or running is still happening".
- Icons for the Vatar listing.

Changes:
- **Snapping back while running (root cause).** The phone kept refilling your breath while you ran, but the server
  didn't. After a few seconds the server saw an honest runner as out of breath, capped them to walking speed and
  dragged them back.
  - Now both count breath the same way: it drains while running and refills only when you're not running.
  - The server also refills it during a nap.
  - Test: `test_running_out_of_breath_never_snaps_back`.
- **Coming back to the app.** Phones pause the browser clock in the background, so a dead connection looked fresh
  after you returned: taps went nowhere and the dice screen froze.
  - Returning after more than about 2.5 s now always opens a fresh connection.
  - The silent-socket watchdog uses wall-clock time.
- **Dice (Changes `P10`).** If you don't pick in time, the server picks for you ("Time up — we picked 4 for you"),
  and the screen never sits there waiting.
  - **New dice:** a real 3D die in the middle with the six numbers in a ring around it. Tap yours (it shows "you"
    and who holds the others). The die tumbles and lands, the winning number glows orange, and "<name> dey Boju!"
    appears.
  - **Boju marker:** Boju gets a 🙈 "Boju" badge over their head and an orange ring at their feet, for everyone,
    until hiding time is over.
  - **Cleaner screen:** the Coach card and the controls step aside while the dice is up.
  - **Fits small screens:** the dice fits any frame, down to the LagosLife window on a phone.
- **Cancel a game (Changes `P10`).** The host now has **Cancel game** in the lobby (everyone gets told and returns),
  and others have Leave. A lobby left with only NPCs closes at once instead of lingering.
- **Loophole closed.** If someone left while the others were picking, the dice could still land on them, giving a
  wasted round with an absent Boju. Now only people still in the game can be Boju, and if the new Boju leaves before
  the round starts, the dice rolls again. Test: `test_dice_never_picks_someone_who_left`.
- **Smarter NPCs.**
  - **As Boju:** it chases a step ahead of where you're running, at a bit faster than before but still slower than
    a running human. It hears hiders within about 4.5 m round corners (less if they're bent down). It searches
    the spots near where it last saw someone, then sweeps hiding spots nearest-first, ticking off ones it can
    already see are empty. It waits by the safe house rather than leaving.
  - **As hiders:** they pick spots out of Boju's sight from where Boju starts, spread out from each other, and slip
    away quietly when Boju gets close without seeing them.
- **Small screens.** The game-over, round-result and ad panels now scroll by touch. Game screens block touch
  scrolling unless a panel allows it, and these didn't. The round result also fits narrow frames. Checked at
  340×480.
- **Map (Changes `P25`).** The area map now reads like a printed street map: dashed road centre lines, building
  shadows, hedges in green. Place names are always shown and never overlap:
  - district names, large and faint;
  - safe houses, bus stops, shops and food spots as pills;
  - "🏠 My house";
  - named buildings when zoomed in (internal IDs like "adeniji_7" are skipped).
- **Store assets.** `store/`: app icon (1024 and 512) and five 1080×1920 screenshots with captions.

## 2.12.0 — 2026-10-13
Owner requests: "clear the screen better… a small round i", "when user minimize the app it shouldn't act weird by
logging them out… replace them with an npc… (generally, for LagosLife and our full gameplay)", "when they said the
user should sit it out, he is still able to move within the field", "the phone should have a close at the top", "the
controls should be round, not listed like that, and should be hideable", "when the player is hiding, highlight the
Aerial".
- **Stand-ins.** Minimising or closing the app no longer takes you out of anything. Your stand-in stays exactly where
  you last were, in Lagos, in LagosLife and in a game, looking like any other player (no "offline" or "NPC" label).
  - **It never moves, and every rule applies to it.** A hider's stand-in stays hidden and can be found. A Boju's
    stand-in stays put, so the round runs out on the timer as usual. The circle and dice go ahead on their timers.
  - **When you come back** you carry on from there. Coming back reconnects at once: phones often hand back a dead
    socket after a minimise, and that's now detected and replaced.
  - **Away for 30 minutes**, you go offline.
    - In a game, you're taken out of it and everyone sees "<name> was away too long and left the game".
    - In a two-player game that ends the game, and the player who stayed wins (anyone who left ranks below everyone
      who stayed). With more players, the game carries on.
    - When you're back, you're told "You were away for over 30 minutes, so you were taken out of game <code>".
    - Out of a game, you go offline after 30 minutes, and the server remembers your spot so you come back there.
  - This replaces 2.11.4's "offline 45 s = left the game". Pressing Leave still leaves, and a game with only one
    person left still ends.
- **Sitting out means sitting out.** Anyone out of the round can't walk around the field and waits in the stands
  until the next round. That covers Boju once retired, caught players, and anyone told to sit the round out. A
  retired Boju goes to the stands the moment the round ends, not after it, and doesn't stay where they were.
- Changes `P11`: the Coach card shows what to do, then after 6 s (9 s for new players) tucks into a small round ⓘ in
  the corner, with the timer and the safe-house seconds. Tap it to open it again; tap the card to close it. It opens
  by itself when there's something new. The lobby card for the host stays open.
- The location and "Game over" notes at the top fade after a few seconds. The safe-house compass is now a small round
  arrow with the distance, under the map.
- Changes `P27`: the controls are now round buttons on arcs around Run, in thumb reach, instead of a row. A small
  ✕ / ⋯ button folds them away, leaving only Run, and the choice is remembered. While you hide and Boju is looking,
  Aerial glows and reads "Watch", so you can see how close Boju is. It stays visible even when the controls are
  folded.
- Changes `P20`: the phone has a "✕ Close" button at the top.

## 2.11.4 — 2026-10-12
Owner reports (LagosLife): "a two-person game, after the second person left, the game still continues for the person to
Boju for who?!", "make LagosLife onboarding be just on the game", "we are packing our other extras and focusing on the
game", "not responsive at the moment".
- A game ends when everyone else has gone. Closing the tab never sent "leave", so a player who did that stayed in the
  game. Now a player offline for 45 s mid-game counts as having left. If the last hider leaves, the round ends at once,
  even during the countdown, instead of Boju seeking no one. Everyone sees "<name> left the game", and the last player
  sees "Everyone else left — game over".
- The big FIND THEM! / RUN & HIDE! flash could get stuck over the round result and game over screens. A phase change
  within 2 s cancelled its timer. It now has its own timer and clears as soon as hiding or seeking ends.
- Changes `P32`: LagosLife is just the game. The tour covers walking, looking, Aerial, hiding vs seeking and a first
  game; the phone, house, home and map steps are gone (the phone was already free). The welcome greets you by your
  LagosLife name. The bus stop only says "buses leave when your game starts" and, after a game, offers a ride back to
  the Motor Park; there are no trips to other cities. The map shows only the area you're in, with no Naija tab.
- LagosLife layout: the name card no longer wraps into the coach bar. On a short, landscape screen the phone is wider,
  fills the height, and its home screen scrolls, so the apps can be reached.
Player reports: "I can't even move about freely in my house", "I'm not really understanding the movements", and "they
keep saying I can follow the arrows but none is indicative".
- Inside your house, the camera turns to face into the house when you walk in. Before, it faced the front door, so
  tapping the middle of the screen walked you back outside.
- Inside, the camera also sits higher, follows behind you as you walk, and settles facing the other rooms when you
  stop, so every room is on screen to tap. Your own house's walls no longer block a tap on the room behind them; you
  walk there through the doorway.
- Changes `P04`: the guide arrows are now a trail of glowing chevrons on the ground, unaffected by fog. When the goal
  is off screen, a pointer at the screen edge shows the place and the distance; tapping it walks you there and turns
  the camera to face the way. Before, the arrow was a small dim cone hidden under your feet.
- Changes `P04`: the walk and look tour steps show an animated tap and swipe. A new player who hasn't moved 20 seconds
  after the city is built gets a one-time "Tap here to walk" hint.

## 2.11.3 — 2026-10-12
- Run works with tap-to-go: tap Run to keep running (tap again to walk), or hold it. A cyan ring shows your breath
  and turns red when you're nearly out; out of breath, you slow to a walk.
- Changes `P27`: Run is now tap-to-toggle as well as hold (the owner reported Run not working — a tap released it at once).
- New control styling: round glass buttons with an icon and a small label, a gradient when on; glass steering pads, a
  red brake and a green gas pedal.
- LagosLife runs much smoother on slow phones (low-end profile: ~8 → ~13–14 fps, triangles 88k → 43k, longest task
  < 0.8 s): no street crowd, traffic or house interiors there, fewer pixels, other players without tiny face details,
  and on low quality the house windows skip their louvres and burglar bars.
- Changes `P32`: the LagosLife version draws only what the Boju Boju game needs (no crowd, traffic or house interiors).

## 2.11.2 — 2026-10-12
- New players get the guided tour again, and never the What's New sheet. Tour progress, tour
  completion and the first-game guide answer were kept per phone, so on a phone where someone had already
  taken the tour, every new account skipped it (and saw What's New instead). They are now kept per account.
- The welcome card waits until the city has actually been built (before, it flashed up for a moment and
  vanished until the build finished).
- The display font (Space Grotesk) is now served from our own files instead of fetched from Google Fonts at
  build time, which had started failing builds.
- This changelog, the protected-features register and the CI gate that enforces both.

## Protected features (approved & working)

### Accounts & first run
- `P01` **Username + password accounts** — sign up with username, password (twice), optional email; log in by username or email; forgot password by email.
- `P02` **Welcome back screen** — returning phones see Enter Lagos, Log in as someone else, and Create new account (which opens the sign-up form).
- `P03` **Look picker** — male/female body, 4 hairstyles each, skin, ankara top, trousers/wrapper, live 3D preview at sign-up; change any time in Settings → My look (others see it at once).
- `P04` **Guided tour for new players** (after the storefront; game-only) — "Show me around" (or Not now): walk, look (animated tap/swipe hints; a one-time "Tap here to walk" if you haven't moved), follow the glowing ground arrows or tap the edge-of-screen pointer to walk there, buy a phone, rent a house, walk home, map, Aerial, hiding vs seeking, start a game; skippable; progress kept per account; short version in LagosLife.
- `P05` **First-game guide** — a small "Want a quick guide?" card; Yes starts the shortest practice game (you + 1 NPC) and the guide card walks through code/invite, Start, bus, circle, dice, hide or seek (Run, Bend, safe house, Aerial to watch Boju) and the result; the button to press glows; new info pulses; Exit any time.
- `P06` **What's New** — shows once per release for returning players only (never for new players), plus Settings → What's new.

### Playing Boju Boju
- `P10` **Game flow** — lobby with code/invite/NPCs (host can cancel); 3D dice with numbers round it, auto-pick at time-up, Boju marked over their head → bus to the arena → gather circle → dice pick → hide (song) → seek → result → game over; Quick game with NPCs, play with friends, public games, live games.
- `P11` **Coach bar** — the one thing to do now for your role, with the timer (tucks into a round ⓘ after a few seconds; tap to open); big RUN & HIDE / FIND THEM / BOJU IS COMING flashes.
- `P12` **Boju Boju song** — male/female recordings while Boju counts, with lyric captions in sync ("Boju Boju o!" ×2, "Ṣé kí n ṣí?" ×2); Settings choice.
- `P13` **Catching** — Boju catches by walking close (no button); safe house protects for 20 s in total; safe-house compass.
- `P14` **Hiding-spot reveal** — after a round, the camera visits unfound hiders' spots with how close Boju came.
- `P15` **Game over + rematch** — podium/winner screen; Play again asks the other players (Accept/No).
- `P16` **Aerial view** — look from the sky (and during games).

### Life in Lagos
- `P20` **Phone** — opens/closes (✕ Close at the top; tap outside closes it; dialogs over it don't); apps: Boju Boju, Messages, Map, Wallet, Settings, etc.; swipeable shop lists.
- `P21` **Shops** — (packed away by GAME_ONLY; phones are free) Tini Tech phones, furniture, Tokunbo Autos cars, food.
- `P22` **Houses** — (packed away by GAME_ONLY) rent, walk in through your door, room & parlour, decorate, sleep and sit; neighbours knock.
- `P23` **Cars & driving** — (packed away by GAME_ONLY) pedals/steering, tap-to-drive on roads; the whole car collides with stalls, parked cars and lamp posts; shop menus become a hint while driving.
- `P24` **Streets** — traffic that waits and honks, crowds (incl. market women), nobody walks or drives through anybody.
- `P25` **Map & travel** — minimap, full map with pins and always-visible place names; your city (Lagos or Ibadan, from location or chosen) is where you spawn; buses to games and home (Naija trips packed away).
- `P26` **Places** — Lagos hub (Adeniji Street, Church Street, Palm View Estate, Market & Motor Park, Events Ground, Football Pitch); Ibadan (Agodi Gardens, Akobo); Abuja. Ibadan home is Agodi Gardens; Akobo is for events only.
- `P27` **Controls** — tap to go by default, joystick option, drag to look, pinch to zoom, Bend, Run (tap to keep running or hold; breath ring), Sit, emotes; round glass buttons on arcs round Run, foldable; Aerial glows while you hide.

### Money, ads & LagosLife
- `P30` **Virtual naira** — in-game naira only, never real money; daily bonus.
- `P31` **Wall ads** — place on kiosks/shops/billboards/arena walls, admin approves, Paystack on our site.
- `P34` **Storefront & Match me** — Baba Boju's welcome, city from location or chosen, Play with online players (Match me / Join a group) or with NPCs; matches start themselves; money + hide/win streaks in the top bar.
- `P33` **Stand-ins** — minimise or close the app and you stay where you were (Lagos, LagosLife, games), standing still under the same rules (a hider can be found) until you're back; no NPC/offline label; away 30 min = offline, taken out of a game (2 players: the other wins), told when back. In a solo game (you + NPCs) the whole game pauses instead, and carries on when you're back.
- `P32` **LagosLife mini version** (`/lagoslife`) — only the Boju Boju game (no crowd, traffic or house interiors, tuned for slow phones; game-only tour; no trips round Naija, buses only to and from games; area-only map); signed in by LagosLife; never shows Paystack, payment links, our naira, a login or an email field; play-with-friends matches; LagosLife leaderboard; ads paid with LagosLife's pay sheet (My ads refreshes itself).

### Look & performance
- `P40` **Neon-glass look** — deep-space background, glass panels with a gradient edge, gradient glowing buttons, glass fields, Space Grotesk titles; redesigned sign-in screen.
- `P41` **Low-end phones first** — city builds in a few seconds on the low-end profile, no main-thread task over ~1 s, pauses drawing while building; UI never sits under the browser toolbar. Places load one at a time (the ride is the loader; the place you left is packed away).
- `P42` **iPhone layout** — safe areas respected when installed; Install app.

---

## History

| Version | Date | Title |
|---|---|---|
| 2.17.0 | 2026-10-17 | Places load one at a time; Agodi is Ibadan's home; Akobo for events |
| 2.16.0 | 2026-10-17 | Just the game: storefront, Match me, your city, streaks |
| 2.15.1 | 2026-10-17 | Solo games pause while you're away |
| 2.15.0 | 2026-10-15 | Admin player directory and Paystack ad revenue |
| 2.14.0 | 2026-10-15 | Admin analytics |
| 2.13.0 | 2026-10-13 | Real dice, smarter NPCs, no more snap-backs |
| 2.12.0 | 2026-10-13 | Stand-ins, a cleaner screen, round controls |
| 2.11.4 | 2026-10-12 | Arrows you can follow, moving freely at home, LagosLife = just the game, games end when others leave |
| 2.11.3 | 2026-10-12 | Run fixed, new controls, smoother LagosLife |
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
