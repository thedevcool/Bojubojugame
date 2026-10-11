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
    version: "2.0.0",
    date: "2026-10-11",
    title: "Boju Boju v1: your life in Lagos 📱🏠",
    items: [
      { emoji: "📱", title: "Your own phone", text: "Buy any phone at the shop beside the park. Everything lives in it now: games, chats, houses, wallet, settings.", tryIt: "Tap the 📱 at the top right" },
      { emoji: "🏠", title: "Rent a house & move in", text: "Pick a free house on the street map — one family per house, 17 to choose from. Pay the rent and it's yours for 7 days; friends can visit any time.", tryIt: "📱 → Houses" },
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
