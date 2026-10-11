# Credits & asset licenses

| Asset | Source | License |
|---|---|---|
| All 3D models (houses, danfo, keke, trees, stalls, props, avatars) | Built in code from three.js primitives in `frontend/src/game/props.tsx` and `Scene.tsx` | Original work, part of this repo |
| Maps (hub plaza, Freedom Park‑style arena) | `backend/app/content/maps/*.json` | Original work |
| App icon (`icon.svg`) | Original | Original work |
| Fonts | The player's system font stack; the OG card uses Next.js's bundled default font | Platform / Next.js (MIT) |

No third‑party 3D models, textures, sounds, real brand logos or images of real people are used.
Places are *inspired by* Lagos and are not copies of real buildings.

Before adding any CC0 or licensed asset (e.g. Kenney, Quaternius, Poly Haven), add a row here
with its source URL and license **in the same commit**.

### Maps & data
| What | Source | License |
|---|---|---|
| Game map | Original Boju Boju map (`frontend/src/lib/geo.ts`): simplified, hand-placed shapes of Nigeria's coast, rivers, roads and cities | Our own work |
| Road routes (cached once per route) | [OSRM](https://project-osrm.org) public demo server | BSD-2 software; OSM data (ODbL) |

All sound effects and music are synthesised in code at runtime (Tone.js) — no audio files.

### Software
three.js (MIT), @react-three/fiber and drei (MIT), Next.js (MIT), React (MIT), Zustand (MIT),
Tailwind CSS (MIT), Tone.js (MIT), postprocessing / @react-three/postprocessing (Zlib/MIT), httpx (BSD-3), @msgpack/msgpack (ISC), FastAPI (MIT), SQLAlchemy (MIT), Pydantic (MIT),
msgpack‑python (Apache‑2.0), PyJWT (MIT).
