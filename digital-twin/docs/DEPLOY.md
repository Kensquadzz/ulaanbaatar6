# Deployment

The app is a static export (`next build` writes `web/out/`), so any static host works.

## Vercel (recommended for previews)

1. New Vercel project from the GitHub repository.
2. Root directory: `digital-twin/web`. Framework preset: Next.js. Build command `npm run build`,
   output directory `out` (Vercel detects the export automatically).
3. Node 20 or newer.
4. Leave the production branch on `main`; branch pushes create preview URLs.

The generated data (about 151 MB, 2,520 files) ships inside the deployment. JSON is compressed by
the CDN; `.b3dm` tiles are already meshopt-compressed.

## Cloudflare (when the data grows)

* Put `web/public/data/` in a Cloudflare R2 bucket with a public custom domain and CORS
  `GET` from the app origin.
* Set the data base URL in `lib/twin.ts` (`DATA`) and in `components/Explorer.tsx` fetches to the
  R2 domain (a single constant is enough to change).
* Host `web/out/` on Cloudflare Pages or Vercel.

## Third-party services used at runtime

* AWS Terrain Tiles (public S3, CORS enabled, no key).
* Esri World Imagery (no key in this prototype; production use requires an ArcGIS Location
  Platform key and Esri attribution).
* EOX Sentinel-2 cloudless (non-commercial licence).
* OpenStreetMap tiles (follow the tile usage policy; switch to a paid tile provider for traffic).

No Cesium ion token is used.
