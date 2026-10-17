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
| Ibadan places: Iwo Road, Gate, Bashorun, Oke Mapo, Airport Road (`backend/app/content/maps/arena_{iwo_road,gate,bashorun,oke_mapo,airport_road}.json`, built by `backend/tools/build_ibadan_osm.py`) | © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors: buildings, streets and points of interest, from the Overpass API or HOT's OSM export ([production-raw-data-api](https://production-raw-data-api.s3.amazonaws.com/ISO3/NGA/catalog.json)). Credited in game on the map screen | ODbL 1.0 (the derived maps are shared under the same terms) |
| Realistic characters (`frontend/public/characters/*.glb`, built by `tools/characters/build_characters.py`) | [MakeHuman](https://github.com/makehumancommunity/makehuman): base human mesh, shape targets, default skeleton and skin weights; clothes, hair, shoes and all textures made procedurally in Blender by the build script | CC0 (MakeHuman assets); our own work for the rest |
| Ground heights round those places (the hills past the fence) | [Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (Terrarium PNGs, AWS Open Data), from SRTM and other public sources | See the tiles' [attribution list](https://github.com/tilezen/joerd/blob/master/docs/attribution.md); SRTM is public domain |

All sound effects and music are synthesised in code at runtime (Tone.js) — no audio files.

### Fonts
- **Space Grotesk** by Florian Karsten — SIL Open Font License 1.1 — https://fonts.google.com/specimen/Space+Grotesk
  (`frontend/public/fonts/`, latin + latin-ext subsets).

### Software
three.js (MIT), @react-three/fiber and drei (MIT), Next.js (MIT), React (MIT), Zustand (MIT),
Tailwind CSS (MIT), Tone.js (MIT), postprocessing / @react-three/postprocessing (Zlib/MIT), httpx (BSD-3), @msgpack/msgpack (ISC), FastAPI (MIT), SQLAlchemy (MIT), Pydantic (MIT),
msgpack‑python (Apache‑2.0), PyJWT (MIT).
