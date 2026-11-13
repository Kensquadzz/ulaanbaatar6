# ULAANBAATAR 6 — Release Readiness

Last updated: 13 November 2026.

## Implemented and verified in the cloud build

- [x] Three.js/WebGL production build succeeds.
- [x] TypeScript checks succeed.
- [x] Automated test suite: 32 tests passed.
- [x] 520 geographic chunks and overview terrain sync.
- [x] Player movement, camera, touch controls, jump and run.
- [x] Drivable vehicle controller with throttle, reverse, steering, brake and boost.
- [x] Kenney CC0 GLB vehicle loading; fallback procedural car retained.
- [x] Four traffic models load at runtime.
- [x] Eighteen pedestrian instances are created in the local crowd.
- [x] Weather, clock, minimap and travel HUD load without browser errors in headless Chromium.
- [x] Capacitor 8.6.2 iOS and Android project scaffolds created.
- [x] Landscape orientation configured in both native shells.
- [x] cap sync completes successfully.
- [x] npm audit: zero reported vulnerabilities after upgrading to Vite 8.3.8 / Vitest 5.1.0.

## Not yet release-ready

- [ ] Run on multiple real iPhone devices (including older supported models).
- [ ] Run on multiple Android phones with different GPU vendors.
- [ ] Measure FPS, GPU memory, loading time, thermal throttling and battery drain on-device.
- [ ] Test Bluetooth/headphone audio, background/foreground resume and interruptions.
- [ ] Test car entry/exit, collisions, traffic, NPCs and camera against actual hardware.
- [ ] Improve and validate 3D player/NPC quality, clothing, facial detail and animations.
- [ ] Add a full road traffic rules / junction / pedestrian crossing system.
- [ ] Add mission progression, save/load, economy and game settings persistence.
- [ ] Replace procedural audio placeholders with selected, licensed high-quality SFX and master/mix them.
- [ ] Review every third-party asset and preserve its licence/attribution.
- [ ] Produce app icon, launch assets and store screenshots from a real device build.
- [ ] Create and publish a production privacy policy and support page.
- [ ] Confirm the Bundle ID and the legal entity that owns the app.
- [ ] Configure Apple signing, App Store Connect records, privacy labels and age rating.
- [ ] Create a signed iOS archive and upload using Xcode 26+.
- [ ] Create a signed Android App Bundle and test via Play internal testing.
- [ ] Complete platform review submissions and resolve any rejections.

## Performance note

Headless Chromium uses a software WebGL renderer in the cloud. Its FPS readings are not representative of an iPhone or Android GPU. They must not be used as device performance claims.

## Known gameplay scope

This is an expanding mobile gameplay build, not a complete GTA-scale commercial game. It does not yet contain a finished story campaign, full combat system, complex mission scripting, persistent economy, interiors, multiplayer or all planned vehicle/character variations.
