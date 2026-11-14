import { CustomHeightmapTerrainProvider, Credit, WebMercatorTilingScheme } from "cesium";
import { resampleHeights, terrariumHeight } from "./geo";

// AWS Terrain Tiles (Tilezen terrarium encoding), public S3 with CORS enabled.
// The data pipeline samples the same tiles at zoom 14 to seat buildings on the ground.
export const TERRARIUM_URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
export const TERRARIUM_MAX_ZOOM = 14;
const GRID = 65;

const cache = new Map<string, Promise<Float32Array | undefined>>();

async function loadTile(z: number, x: number, y: number): Promise<Float32Array | undefined> {
  const key = `${z}/${x}/${y}`;
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const url = TERRARIUM_URL.replace("{z}", String(z)).replace("{x}", String(x)).replace("{y}", String(y));
      const res = await fetch(url, { mode: "cors" });
      if (!res.ok) return undefined;
      const bmp = await createImageBitmap(await res.blob());
      const canvas = new OffscreenCanvas(256, 256);
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(bmp, 0, 0);
      const px = ctx.getImageData(0, 0, 256, 256).data;
      const out = new Float32Array(256 * 256);
      for (let i = 0; i < out.length; i++) out[i] = terrariumHeight(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      return out;
    })();
    cache.set(key, p);
    if (cache.size > 400) cache.delete(cache.keys().next().value!);
  }
  return p;
}

/** Global terrain from AWS terrarium tiles; deeper levels are bilinear upsamples of zoom 14. */
export function createTerrariumTerrain(): CustomHeightmapTerrainProvider {
  return new CustomHeightmapTerrainProvider({
    width: GRID,
    height: GRID,
    tilingScheme: new WebMercatorTilingScheme(),
    credit: new Credit("Terrain: AWS Terrain Tiles (Tilezen; SRTM, GMTED2010)"),
    callback: async (x: number, y: number, level: number) => {
      let z = level, sx = 0, sy = 0, size = 1, tx = x, ty = y;
      if (level > TERRARIUM_MAX_ZOOM) {
        const d = level - TERRARIUM_MAX_ZOOM;
        const k = 2 ** d;
        z = TERRARIUM_MAX_ZOOM;
        tx = Math.floor(x / k);
        ty = Math.floor(y / k);
        size = 1 / k;
        sx = (x - tx * k) * size;
        sy = (y - ty * k) * size;
      }
      try {
        const src = await loadTile(z, tx, ty);
        if (!src) return new Float32Array(GRID * GRID);
        return resampleHeights(src, GRID, sx, sy, size);
      } catch {
        return new Float32Array(GRID * GRID);
      }
    },
  });
}
