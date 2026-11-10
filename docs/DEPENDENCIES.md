# External dependencies and what each one needs from you

| Dependency | Used for | Needs | State |
|---|---|---|---|
| Unreal Engine 5.5 | The game | Epic account, Windows/macOS machine with GPU | Not available in the cloud workspace |
| Overture Maps (incl. OpenStreetMap) | Roads, buildings, water, places | Nothing; attribution in credits (ODbL / CDLA) | In use |
| AWS Terrain Tiles | Elevation | Nothing; attribution | In use |
| Open-Meteo | Weather fallback | Free tier is non-commercial; a commercial release needs their paid plan | In use for development |
| Google Maps Platform: Weather API | Preferred weather | Google Cloud project, billing, key in `GOOGLE_WEATHER_API_KEY` on the server | Adapter written, untested |
| Google Photorealistic 3D Tiles + Cesium for Unreal | Visual reference and optional streamed 3D context | Map Tiles API key, Cesium plugin; Google's terms forbid extracting geometry into permanent assets, and coverage/quality for Ulaanbaatar and mobile cost must be checked first | Not integrated |
| Google Street View | Facade reference by eye | Key; reference only, no bulk download or texture extraction | Not integrated |
| NAMEM (Mongolian met agency) | Official weather | No documented public API found; needs an agreement | Placeholder adapter |
| Air quality | HUD value | A verified source (for example a licensed AQ API) | Not integrated; HUD shows nothing rather than a guess |
| Higgsfield | Concept and reference images, trailer shots | Connected account, credits | No generations run yet |
| Apple Developer Program | iOS signing, TestFlight | Paid membership, team id | Needed for the first iPhone build |
| Google Play Console | Android release | Account, upload keystore | Needed for release only |
| Vehicle trademarks | Real car names and shapes | Licences from the makers, or original look-alike designs | Decision needed before art starts |

No credentials are stored in this repository.
