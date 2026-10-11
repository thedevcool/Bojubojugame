/**
 * Player-facing release notes. TEMPLATE for every update that players can see:
 * add a new entry at the TOP of this list (bump ``version``). The "What's new"
 * sheet then pops up once for every player on their next visit, and the full
 * list stays available under Settings → What's new.
 */
export interface ChangeItem { emoji: string; title: string; text: string; tryIt?: string }
export interface Release { version: string; date: string; title: string; items: ChangeItem[] }

export const CHANGELOG: Release[] = [
  {
    version: "2.9.0",
    date: "2026-10-11",
    title: "Oh no, I passed there! 👀",
    items: [
      { emoji: "👀", title: "Where were they hiding?", text: "When time runs out, the camera flies to every hider Boju never found — and shows how close Boju came. \"You passed just 2 m away!\"" },
      { emoji: "🎤", title: "Sing along", text: "The words of the Boju Boju song appear while Boju counts: Boju Boju o! · Ṣé kí n ṣí?" },
      { emoji: "🏆", title: "A proper finish", text: "A new game-over screen with the winner crowned, a podium, your stats, awards for sharpest eyes and master hider, and one tap to Play again." },
    ],
  },
  {
    version: "2.8.1",
    date: "2026-10-11",
    title: "Boju Boju, the song 🎤",
    items: [
      { emoji: "🎤", title: "The real Boju Boju song", text: "While Boju closes their eyes and counts, everyone hears the song, sung by real voices. Male and female voices take turns each round.", tryIt: "⚙️ Settings → Boju Boju song" },
    ],
  },
  {
    version: "2.8.0",
    date: "2026-10-11",
    title: "The game now teaches you 🧭",
    items: [
      { emoji: "❓", title: "How to play", text: "Six quick cards explain Boju Boju the first time you join a game. Open them again any time from 🙈 Boju Boju or ⚙️ Settings.", tryIt: "📱 → 🙈 Boju Boju → How to play" },
      { emoji: "🧭", title: "Always know what to do", text: "The bar at the top tells you the one thing to do right now — board the bus, walk into the circle, RUN & HIDE, FIND THEM — with an arrow when you need to go somewhere." },
      { emoji: "📣", title: "Big moments, big signs", text: "\"RUN & HIDE!\" and \"FIND THEM!\" flash on screen, and your phone closes so nothing is in the way." },
    ],
  },
  {
    version: "2.7.1",
    date: "2026-10-11",
    title: "Rematch, the proper way 🔁",
    items: [
      { emoji: "🔁", title: "Play again = rematch request", text: "Tap Play again and the other players get Accept / No. If anyone accepts, the rematch starts with everyone who said yes. No NPCs fill in, and if nobody accepts in 30 seconds, there's no rematch." },
    ],
  },
  {
    version: "2.7.0",
    date: "2026-10-11",
    title: "Rematch! 🔁",
    items: [
      { emoji: "🔁", title: "Play again", text: "After the final whistle, tap Play again: same arena, same settings, and everyone from the game gets a rematch invite." },
      { emoji: "🚗", title: "Proper driving", text: "◀ ▶ to steer, ⛽ Gas and 🛑 Brake (hold it to reverse). The camera follows behind your car. The joystick and W/A/S/D work too." },
      { emoji: "🧍🏾", title: "No more walking through people", text: "Players and NPCs are solid: you walk round them, and your car brakes for them." },
      { emoji: "🏟️", title: "Explore after the game", text: "If you were caught in the last round you're brought back onto the field, so Stay & explore and the map work again." },
    ],
  },
  {
    version: "2.6.0",
    date: "2026-10-11",
    title: "Lagos traffic with wahala 🚦",
    items: [
      { emoji: "🚗", title: "Drive on the roads", text: "Tap somewhere while driving and your car follows the streets instead of cutting across compounds." },
      { emoji: "🛑", title: "Nothing passes through anything", text: "Cars stop for people and for other cars, and your car can't drive through anyone. You can't walk through a danfo either." },
      { emoji: "📢", title: "Comot for road!", text: "Stand in the road and the traffic waits, leans on the horn, and the driver lets you hear word." },
      { emoji: "🚪", title: "Out through the door", text: "At your front door, tap outside and you step out and keep going. Anywhere else inside, use the door or the 🗺️ map." },
    ],
  },
  {
    version: "2.5.0",
    date: "2026-10-11",
    title: "Boju Boju is coming to LagosLife 🎮",
    items: [
      { emoji: "🎮", title: "Play inside LagosLife", text: "A mini version of Boju Boju is on its way to LagosLife's Games app: same Lagos, same hide & seek, signed in with your LagosLife account." },
      { emoji: "🤝", title: "Matches with LagosLife friends", text: "Share a 6-letter code and play together. LagosLife players and players here meet in the same games." },
      { emoji: "🏡", title: "Full version stays here", text: "Houses, cars, shops and the whole city life stay on this site. Nothing changes for your account." },
    ],
  },
  {
    version: "2.4.0",
    date: "2026-10-11",
    title: "Your brand on Lagos walls 📢",
    items: [
      { emoji: "📢", title: "Wall ads", text: "Businesses can now put a poster on kiosks, shops, billboards and arena walls — right where people walk and hide. Never on anyone's house.", tryIt: "Tap a shop wall → 📢 Place ad here" },
      { emoji: "📐", title: "Four sizes, no overlaps", text: "Small poster to full billboard. The size picker only offers what fits, and never covers someone else's ad." },
      { emoji: "💳", title: "Paid with Paystack", text: "Ads are the only thing paid with real money, and they're kept apart from your game naira. Every poster is checked before it goes up; if we can't approve it you get a full refund." },
      { emoji: "🙈", title: "Neater logo", text: "The peeking monkey now sits right in the middle of its badge." },
    ],
  },
  {
    version: "2.3.0",
    date: "2026-10-11",
    title: "Our own map of Naija 🗺️",
    items: [
      { emoji: "🗺️", title: "The Boju Boju map", text: "A brand-new map drawn just for the game: coast, rivers, highways and every place you can go. Zoom into Lagos to see our own streets and houses.", tryIt: "Tap the round map → Naija" },
      { emoji: "💰", title: "Bigger prizes", text: "Round rewards are 100× bigger — finding hiders and staying hidden now pays hundreds of thousands." },
      { emoji: "🛏️", title: "Starter furniture", text: "Your first house comes with a bed, an armchair and a standing fan. The rest is up to you." },
      { emoji: "🚪", title: "Proper front doors", text: "Panelled double doors with frames — no more floating door slab." },
    ],
  },
  {
    version: "2.2.0",
    date: "2026-10-11",
    title: "Play with real people 👥",
    items: [
      { emoji: "📺", title: "Live games", text: "See every game waiting for players and join in one tap — or watch games in progress on the map without leaving your spot.", tryIt: "📱 → Live games" },
      { emoji: "🙈", title: "New game menu", text: "Create a game for real players, a private one for friends, or play with NPCs. Tapping a player and choosing to play now opens the same menu." },
      { emoji: "🚌", title: "Straight to the Motor Park", text: "Starting a game takes everybody to the bus stop, ready to board." },
      { emoji: "👆🏾", title: "Smarter tap-to-go", text: "Taps stop at walls, stay inside your house (use the door to go out) and lead to the door of other people's houses." },
      { emoji: "🛋️", title: "Your house, your money", text: "New houses come empty — buy every piece of furniture yourself at Ọ̀ṣọ́ Home & Furniture." },
    ],
  },
  {
    version: "2.1.0",
    date: "2026-10-11",
    title: "Real homes, cars & travel Naija 🚗🏡",
    items: [
      { emoji: "🛋️", title: "Room & parlour + decorate", text: "Houses now have a parlour and bedroom (duplexes add a kitchen). Buy furniture at Ọ̀ṣọ́ Home & Furniture and arrange it your way.", tryIt: "Go home and tap 🛋️ Decor" },
      { emoji: "😴", title: "Sleep and sit", text: "Tap a bed to sleep (or sit on the edge); sofas and chairs work too. A nap refills your stamina." },
      { emoji: "🗺️", title: "Map, pins & travel", text: "Tap the round map to pin any place. Board at the bus stop to any city venue — no game needed.", tryIt: "Tap the map (top left)" },
      { emoji: "🚗", title: "Buy a car and drive", text: "Tokunbo Autos is beside the motor park. Drive around Lagos or straight to Abuja." },
      { emoji: "⭕", title: "Fairer Boju + new phone look", text: "Everyone gathers in the circle before the dice, Boju catches you just by reaching you, and your phone got a full glow-up." },
    ],
  },
  {
    version: "2.0.0",
    date: "2026-10-11",
    title: "Boju Boju v1: your life in Lagos 📱🏠",
    items: [
      { emoji: "📱", title: "Your own phone", text: "Buy any phone at the shop beside the park. Everything lives in it now: games, chats, houses, wallet, settings.", tryIt: "Tap the 📱 at the top right" },
      { emoji: "🏠", title: "Rent a house & move in", text: "Pick a free house on the street map — one family per house, 17 to choose from. Pay the rent and it's yours for 7 days. Visitors knock — you decide who comes in.", tryIt: "📱 → Houses" },
      { emoji: "💬", title: "Friends & messages", text: "Add friends by username, chat privately and invite them to your game in one tap.", tryIt: "📱 → Messages" },
      { emoji: "👆🏾", title: "Tap to go + real map view", text: "Choose joystick or tap-to-go. Pinch with two fingers to zoom; the aerial map glides like a real map app." },
      { emoji: "🪑", title: "Sit, look around, go home", text: "Sit on beds and benches, look all around your room, and after a match ride home or stay to explore." },
    ],
  },
  {
    version: "1.4.0",
    date: "2026-10-11",
    title: "Proper accounts + install the app 📲",
    items: [
      { emoji: "🔑", title: "Username & password", text: "Log in on any phone with your username (or email) and password.", tryIt: "⚙️ Settings → Your account" },
      { emoji: "✉️", title: "Forgot password? No wahala", text: "Add an email (optional) and reset your password any time. We never show it to other players." },
      { emoji: "📲", title: "Install Boju Boju", text: "Add the game to your home screen — it opens full-screen like a real app.", tryIt: "⚙️ Settings → Install app" },
      { emoji: "🕹️", title: "Joystick fixed on iPhone", text: "The stick no longer gets stuck when you lift your thumb." },
      { emoji: "💰", title: "₦100M to start", text: "Everybody gets ₦100,000,000 in-game naira while we test — go and fly to Abuja!" },
    ],
  },
  {
    version: "1.3.0",
    date: "2026-10-11",
    title: "Travel Naija 🇳🇬",
    items: [
      { emoji: "🗺️", title: "Real maps, real rides", text: "Watch your danfo, keke, bus or plane travel the real route from your area to the venue.", tryIt: "Start a game and board at the Motor Park" },
      { emoji: "🏙️", title: "New cities", text: "Play in Ibadan (Agodi Gardens-style hills) and Abuja (Millennium Park-style gardens) with your friends.", tryIt: "Play Boju → pick a city on the map" },
      { emoji: "🛰️", title: "Aerial view", text: "Hiders can fly up and scan the whole map, with labels for every section and the safe house." },
      { emoji: "🔊", title: "Sound & music", text: "Afrobeat groove, street noise, danfo horns, footsteps — and a heartbeat when Boju dey near you!" },
      { emoji: "🧎🏾", title: "Bend down", text: "Real knees now! Bend down behind hedges to hide, and see proper walking and running." },
      { emoji: "🕹️", title: "Smoother controls", text: "The stick never gets stuck again, push it all the way to run, and the camera won't go through walls." },
    ],
  },
  {
    version: "1.2.0",
    date: "2026-10-11",
    title: "Fresh new look 🙈",
    items: [
      { emoji: "💙", title: "Boju blue", text: "A brand-new blue look with smooth, springy animations everywhere." },
      { emoji: "🎬", title: "Build your game step by step", text: "See the arena in 3D, watch the hide/search timer, and fly the camera to your safe house before you create.", tryIt: "Tap Play Boju → Next" },
      { emoji: "🪞", title: "See yourself", text: "Your avatar spins in 3D while you choose skin, ankara shirt and trousers." },
      { emoji: "🧭", title: "Safe-house compass", text: "While hiding, a compass points to the safe house and tells you how far it is." },
      { emoji: "✨", title: "What's new", text: "This card! It shows up whenever we ship something new." },
    ],
  },
  {
    version: "1.1.0",
    date: "2026-10-11",
    title: "Living Lagos",
    items: [
      { emoji: "🏠", title: "Your own house", text: "You now start inside your home on Adeniji Street or Palm View Estate.", tryIt: "Walk out the front door" },
      { emoji: "🛣️", title: "Real streets", text: "Roads, kerbs, gutters, zebra crossings, electric poles, shops and a motor park." },
      { emoji: "🚌", title: "Street life", text: "People walking, vendors calling, danfos and kekes on the road. Walk up to someone — they greet you!" },
      { emoji: "🤖", title: "NPC players", text: "No friends online? Play with NPCs who hide, seek and tag like real people.", tryIt: "Play Boju → Quick game vs 3 NPCs" },
    ],
  },
  {
    version: "1.0.0",
    date: "2026-10-11",
    title: "Boju Boju is here",
    items: [
      { emoji: "🎲", title: "Hide & seek, Lagos style", text: "Groups of 2–6, dice to pick Boju, hide, seek, tag and a safe house." },
      { emoji: "💸", title: "Naira economy", text: "Earn in-game naira (not real money), pay fares, chop suya and jollof." },
    ],
  },
];

export const LATEST = CHANGELOG[0];
