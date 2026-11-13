# App Store Connect and Google Play — Submission Checklist

## Product identity

- App name: ULAANBAATAR 6
- Suggested subtitle: Explore the living capital
- Suggested bundle ID: com.ulaancreative.ub6 (provisional; verify availability and legal ownership before registering)
- Current source package version: 0.2.0
- Orientation: Landscape
- Platform wrapper: Capacitor 8.6.2

## Suggested App Store description

ULAANBAATAR 6 is an open-world mobile game built around a playable digital version of Ulaanbaatar. Explore streets and landmarks, walk through city neighbourhoods, drive vehicles, discover changing weather and watch the city move around you.

The game is designed around the real geography of the capital, from Sukhbaatar Square and Peace Avenue toward Zaisan. Its world combines mapped roads and buildings with original 3D assets, mobile controls and a dynamic day/night environment.

**Current description must be updated to match the final shipped feature set.** Do not claim story missions, combat, full traffic AI, vehicle variety or full-city coverage until those features are actually implemented and tested.

## Suggested keyword candidates

Ulaanbaatar, Mongolia, open world, driving, city exploration, mobile game

Do not use GTA, Grand Theft Auto, Rockstar or another publisher's trademarks in the app name, icon, keywords, screenshots or metadata unless a licence is obtained.

## Required release materials

- [ ] Final app icon (1024×1024 PNG, opaque background).
- [ ] iPhone screenshots in the accepted App Store Connect sizes, captured from the signed app on real devices.
- [ ] iPad screenshots if iPad distribution remains enabled.
- [ ] Android phone/tablet screenshots for Google Play.
- [ ] Public HTTPS privacy policy URL.
- [ ] Public support URL and monitored support email.
- [ ] Marketing URL if available.
- [ ] Age rating questionnaire completed for the actual final build.
- [ ] App privacy labels completed accurately.
- [ ] Copyright / legal owner confirmed.
- [ ] App Store Connect app record and registered Bundle ID.
- [ ] Apple Developer Team, certificates, provisioning profiles and signing.
- [ ] Xcode archive built and validated.
- [ ] TestFlight testing completed.
- [ ] Google Play developer record, app record, signing key and Android App Bundle.
- [ ] Google Play internal testing completed.

## Current Apple toolchain requirements

As of November 2026, App Store Connect uploads must be built with Xcode 26 or later using an iOS 26 SDK or later. Capacitor 8 requires macOS and Xcode 26+ for iOS builds. A Linux cloud build cannot produce the signed Xcode archive required for App Store release.

## Current Android toolchain

Use Android Studio 2025.2.1 or later with an installed Android SDK, JDK and platform tools. Open the android folder in Android Studio, sync Gradle, set package/signing details and create a signed AAB. Test on physical devices before production release.

## IP and licensing

Apple's App Review Guidelines require apps to include only content the developer created or has permission to use. This project uses the included Kenney Car Kit 2.0 CC0 assets and bundled map data with attribution. Any additional commercial-game assets, music, voice, trademarks or extracted files must be removed unless written rights are obtained.
