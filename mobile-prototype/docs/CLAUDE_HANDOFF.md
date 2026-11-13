# CLAUDE HANDOFF — ULAANBAATAR 6 (UB6)

Date: 2026-11-13. Continue the existing project; do not rebuild completed work from scratch.

## Mandatory rules
1. Read this file, the root README and mobile-prototype/docs/RELEASE_READINESS.md first.
2. Preserve working systems. Inspect before editing. Make incremental changes and run tests/build/audit after changes.
3. Do not report features complete unless implemented and tested.
4. Use a separate preview branch/deployment. Never overwrite production main without owner approval.
5. Do not invent API keys, Apple/Google credentials, legal identity or contact details.
6. Do not rip/package GTA/Rockstar files. Create original game assets with similar broad open-world mobile quality; verify every asset licence.
7. Optimise and test on real iPhone and Android devices. Cloud browser is not physical-device QA.

## Project
ULAANBAATAR 6: mobile open-world game based on real Ulaanbaatar. iOS + Android, TypeScript + Three.js + WebGL 2 + Vite, Capacitor native shells. Initial geography: Sukhbaatar Square, Peace Avenue, central UB and Zaisan. Visual target: polished third-person mobile open world, recognisably Mongolian, original IP.

## Existing systems to preserve
- Geographic UB road/building/terrain chunk data in data/tiles and mobile-prototype/public/data.
- World chunk streaming, building footprints, roads, terrain.
- Third-person player controller, touch joystick, camera, run and jump.
- Drivable player sedan and vehicle controls.
- Kenney CC0 vehicle GLBs and texture.
- AI road-following traffic (4 agents) and pedestrian crowd (18 NPCs).
- HUD, minimap, destinations and city labels.
- Ulaanbaatar live clock/day-night and Open-Meteo weather.
- Procedural ambience/engine/footstep/weather audio.
- Adaptive quality settings, Capacitor iOS/Android wrappers, landscape orientation.

## Important paths
- mobile-prototype/src/main.ts — app entry
- mobile-prototype/src/player/ — player and vehicle
- mobile-prototype/src/world/traffic.ts — traffic
- mobile-prototype/src/world/npcs.ts — pedestrians
- mobile-prototype/src/audio/ — audio
- mobile-prototype/src/core/ — world/time/weather
- mobile-prototype/src/ui/ — HUD and touch controls
- mobile-prototype/public/models/vehicles/ — GLBs and texture
- mobile-prototype/public/data/ — bundled map data
- data/tiles/ — source map dataset
- assets/kenney-car-kit/ — Kenney source and licence
- mobile-prototype/ios and mobile-prototype/android — native shells
- mobile-prototype/docs/ — release/privacy/submission docs

## Higgsfield 3D project and downloadable materials
Existing Higgsfield 3D Jutsu project:
https://higgsfield.ai/3d-jutsu/f4c92c39-70f4-49bd-9f43-19fd49db7cdf
Project ID: f4c92c39-70f4-49bd-9f43-19fd49db7cdf

Known successful scene state: revision 12, 808 objects. Facade details for Blue Sky Tower, State Department Store, Shangri-La and Government Palace; city street canyon, traffic signals, tactile paving, Zaisan ridgelines and winter trees.

Latest known render:
- Operation: ub6-final-gta-preview-v1
- Artifact ID: ef6a8595743a00bd85d9cbc025f2971a
- Name: ub6-third-person-city-preview.png
- 1200 x 675 PNG

Earlier render artifact: 130589c0106f4356e6ce3d625e298066 (operation ub6-preview-outdoor-02).

State Department Store reference images:
https://d8j0ntlcm91z4.cloudfront.net/user_3Lu2SKunb0oHwa3wJTdOUNdg8Ik/hf_20261111_112347_654a3666-60fe-4cd5-a0f2-dfc059eaca63.png
https://d8j0ntlcm91z4.cloudfront.net/user_3Lu2SKunb0oHwa3wJTdOUNdg8Ik/hf_20261111_112854_234a466a-0ab6-4a5a-9531-42070294aa3d.png

These Higgsfield assets may not yet be in this ZIP. Open the project, inspect artifacts, download PNG/GLB/source assets using available Higgsfield UI/API, and add them under assets/higgsfield/ or mobile-prototype/public/models/landmarks/. A PNG concept is not a 3D model: export actual GLB/GLTF for runtime. Work on a copy/branch. Check credit balance before costly generations; do not spend paid credits without owner approval. Tool notes: scene_builder_3d_get_operation retrieves operation metadata; inspect get_artifact schema before use; run_python mutates scene/exports GLB; query_python renders PNG.

## Owner visual requirements
Owner supplied mobile open-world reference screenshots and wants detailed character/vehicle, roads/lanes/sidewalks/signs/lights, believable traffic and NPCs, clothing details, day/night and weather lighting, sound effects, mobile HUD controls, and authentic modern Ulaanbaatar rather than generic western city. It must be playable on mobile, not just a static render.

## Licences / mapping
Do not scrape Google Street View or use Google Maps imagery as permanent game textures outside permitted API terms. Verify licences for all models, textures, sound, fonts and images. OSM ODbL obligations apply; preserve attribution for Overture/terrain data. Kenney Car Kit in this ZIP is CC0 and its licence is included. Do not package proprietary GTA/Rockstar game files, models, textures, sounds, logos or characters.

## Immediate work list
1. Run the local game and inspect startup, world streaming, touch, player and vehicle.
2. Inspect vercel.json rewrites and confirm map chunk routes.
3. Verify every GLB and texture URL; fix 404s and all runtime errors.
4. Improve UB landmarks with real exported GLBs downloaded from the Higgsfield project.
5. Improve NPC animation/clothing, traffic rules, vehicle diversity and collision.
6. Replace placeholder synthesized audio with a properly licensed, mixed SFX pack if needed.
7. Profile on physical devices: FPS, memory, load time, heat, battery and touch latency.
8. Deploy preview from the exact source ZIP and verify all network requests.
9. Produce signed iOS/Android builds only after device testing and account/signing details are available.

## QA facts — do not overstate
- Last automated suite: 32 tests passed.
- Last npm audit: zero vulnerabilities after Vite 8.3.8 / Vitest 5.1.0 upgrade.
- Cloud headless browser check: player sedan GLB and 4/4 traffic GLBs loaded, 18 NPC instances created; no page errors/texture warnings in that test.
- Not tested on physical iPhone/Android.
- No signed IPA/AAB and no App Store/Google Play submission.
- Vercel deployment was READY but used existing GitHub branch, not the latest local source snapshot. Latest local changes may not be online. Check actual preview assets before claiming otherwise.

## Expected delivery
Return updated source and ZIP, verified Vercel preview URL, actual gameplay screenshots/video, test report, asset licence inventory, known issues and remaining release blockers. If signing credentials/accounts are unavailable, provide build-ready source and exact owner steps; do not claim upload completed.
