// Copies CesiumJS runtime files (web workers, widgets CSS, assets) into public/cesium,
// where the viewer loads them at runtime via CESIUM_BASE_URL.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = join(dirname(require.resolve("cesium/package.json")), "Build", "Cesium");
const dest = join(process.cwd(), "public", "cesium");
if (!existsSync(root)) {
  console.error("cesium build folder not found:", root);
  process.exit(1);
}
mkdirSync(dest, { recursive: true });
for (const dir of ["Workers", "ThirdParty", "Assets", "Widgets"]) {
  cpSync(join(root, dir), join(dest, dir), { recursive: true });
}
console.log("Cesium runtime copied to public/cesium");
