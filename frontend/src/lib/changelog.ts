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
