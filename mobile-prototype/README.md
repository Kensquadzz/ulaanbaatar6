# ULAANBAATAR 6 — Mobile Game Project

Mobile-first open-world game prototype based on real Ulaanbaatar map/terrain data. The web renderer uses Three.js/WebGL and is wrapped for iOS and Android with Capacitor 8.

## Current project features

- 520 real geographic chunks around Sukhbaatar Square, Peace Avenue and Zaisan, streamed by distance.
- 13,604 building footprints and 7,626 road objects in the source dataset.
- Third-person character controller, touch joystick, camera drag, run and jump.
- Drivable player sedan with acceleration, steering, reverse, braking, boost and building collision.
- Kenney Car Kit CC0 GLB vehicles: sedan, SUV, taxi, police, delivery van, ambulance and truck.
- Four nearby AI traffic cars following real drivable road centerlines.
- Eighteen lightweight pedestrian NPCs animated along mapped footways/paths.
- Live Ulaanbaatar clock and sun position, live Open-Meteo weather, manual weather/time controls.
- Procedural ambience, engine, footsteps and weather audio; these are synthesized game sounds, not a recorded SFX library.
- Minimap, destination GPS, district/street labels, quality profiles and adaptive resolution.
- Capacitor 8.6.2 iOS and Android native project scaffolds. Both launch in landscape.

## Run in a browser

Requirements: Node.js 22.12+.

    npm ci
    npm run dev

## Build and sync native projects

    npm ci
    npm run cap:sync
    npm run cap:open:android
    npm run cap:open:ios

cap:sync runs TypeScript/Vite production build then copies assets into both native projects.

## iOS build

Use macOS with Xcode 26 or later and Xcode Command Line Tools:

    npm ci
    npm run cap:sync
    npm run cap:open:ios

Select the correct Apple Developer Team and signing profile in Xcode, verify the Bundle ID is registered, run on a physical iPhone, Archive, validate and upload to App Store Connect.

## Android build

Install Android Studio 2025.2.1 or later, Android SDK, JDK and platform-tools. Open the android folder in Android Studio, sync Gradle, run on a real device, then create a signed Android App Bundle (AAB) for Google Play.

## Important

This archive contains source code and native project scaffolds, not a signed IPA or AAB. It has not yet been tested on physical iPhones/Android phones or submitted to either app store. See docs/RELEASE_READINESS.md and docs/APP_STORE_SUBMISSION.md before release.

## Data and asset licences

- Geographic roads/buildings/places: Overture Maps Foundation and OpenStreetMap contributors; see the attribution supplied in the in-game settings and source tile metadata. Respect OSM ODbL and the source dataset's CDLA-Permissive terms.
- Terrain: AWS Terrain Tiles / Mapzen / Tilezen and source data attribution in the game.
- Vehicle models: Kenney Car Kit 2.0, CC0 1.0. The original Kenney-Car-Kit-License.txt is preserved in public/models/vehicles/.
- The app does not include extracted proprietary GTA files.
