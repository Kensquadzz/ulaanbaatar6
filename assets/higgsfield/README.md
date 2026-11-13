# Higgsfield 3D Jutsu assets

Downloaded 2026-11-13 from the owner's Higgsfield 3D Jutsu project
`f4c92c39-70f4-49bd-9f43-19fd49db7cdf` ("ULAANBAATAR 6 — Ulaanbaatar Digital Twin"), read-only.
No Higgsfield generation, render or other credit-spending operation was run.

| Path | What it is |
|---|---|
| `source/ub6-3d-jutsu-r12.glb` | The committed scene export, revision 12 (808 nodes, 787 meshes, ~213k triangles, no textures, etag `0de6d6b12bbcfdfdf855c433b49ab418`) |
| `renders/ub6-third-person-city-preview-r12.png` | Render artifact `ef6a8595743a00bd85d9cbc025f2971a` (operation `ub6-final-gta-preview-v1`), 1200x675 |
| `renders/ub6-street-preview-r11.png` | Render artifact `130589c0106f4356e6ce3d625e298066` (operation `ub6-preview-outdoor-02`), 1024x576 |
| `library/` | Assets split out of the scene that the game does not load yet (props, generic buildings, monument study) |
| `../../mobile-prototype/public/models/higgsfield/` | Assets split out of the scene that the game loads at runtime; `index.json` lists sizes and triangle counts |

Not downloaded: the two State Department Store reference images on `d8j0ntlcm91z4.cloudfront.net`
listed in the handoff return HTTP 403 (expired or private links), and the project has no image or video
generations to list. The `.blend` source (17.7 MB) exists in the project but was not needed.

`mobile-prototype/scripts/extract-higgsfield.mjs` regenerates every split file from the source GLB.

## What the game uses

| Asset | In game | Notes |
|---|---|---|
| `vehicles/hf-hybrid-sedan.glb` | Player car and one traffic car | To scale (4.56 m). Baked at load into body + 4 wheel meshes (5 draw calls); wheels spin and steer |
| `vehicles/hf-city-car.glb` | Two traffic cars | Library model built at 3.06 m, scaled x1.5 to 4.6 m; simplified to ~2.3k triangles |
| `vehicles/hf-city-bus.glb` | One traffic bus | Library model built at 4.7 m, scaled x1.35 to a 6.4 m midi bus (it is not a 12 m city bus); ~4.2k triangles |
| `characters/hf-player-winter.glb`, `hf-woman-winter.glb` | All 18 pedestrians | Rigid parts (no skeleton). Split into body / legs / arms that swing at hip and shoulder; scaled to 1.76 m and 1.64 m; ~1.7k triangles each; 10 draw calls for the whole crowd |
| `landmarks/*-study.glb` (5) | Government Palace, State Department Store, Blue Sky Tower, Shangri-La (Block C tower), Zaisan memorial | **Stylised studies, not the real buildings.** Placed on the real footprint, stretched to its minimum-area rectangle and to the game's height for that building (owner's decision, 2026-11-13). Collision stays the real footprint |

## Honest limits

- The scene is a 150 m diorama, not a survey. Landmark facades, proportions and massing are invented
  by the model author; only position, footprint extent, orientation and height come from map data.
- Characters have no skinning, no knee or elbow bend and no facial animation.
- Glass and lamps lose their separate materials when vehicles are baked to vertex colours.
- The player character is still the procedural figure from `src/player/character.ts`.

## Licence

The scene was made in the owner's own Higgsfield account. Some pieces (city car, bus, apartment
blocks, glass tower, lamp, traffic light, bus shelter, horse) carry `lowpoly` materials and look like
Higgsfield 3D asset-library models. **Before an App Store / Google Play release, the owner must confirm
in Higgsfield's terms that generated and library 3D assets may be redistributed inside a commercial
app.** Until then treat them as "owner's account content, licence for redistribution unconfirmed".
