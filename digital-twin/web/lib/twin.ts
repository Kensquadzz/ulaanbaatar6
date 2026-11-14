// Cesium scene for ULAANBAATAR 3D. Everything shown comes from /data (built by the pipeline from
// real open data) or from live imagery/terrain providers; nothing is generated here.
import {
  ArcGisMapServerImageryProvider,
  BillboardCollection,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Cesium3DTileFeature,
  Cesium3DTileStyle,
  Cesium3DTileset,
  Color,
  Credit,
  CustomShader,
  DistanceDisplayCondition,
  EllipsoidTerrainProvider,
  HeightReference,
  ImageryLayer,
  LabelCollection,
  LabelStyle,
  LightingModel,
  Math as CMath,
  NearFarScalar,
  PolygonHierarchy,
  PrimitiveCollection,
  Rectangle,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  UrlTemplateImageryProvider,
  Viewer,
  VerticalOrigin,
  ClassificationType,
  Entity,
  PolylineGraphics,
  ConstantProperty,
  PolygonGraphics,
  CallbackProperty,
  JulianDate,
  HorizontalOrigin,
  defined,
} from "cesium";
import { createTerrariumTerrain } from "./terrain";
import { DrawContext, Feat, fillPolygons, intersects, strokeLines, VectorImageryProvider, withBBox } from "./vector";
import { formatArea, formatDistance, LonLat, pathLength, polygonArea } from "./geo";

export const UB_HOME = { lon: 106.9176, lat: 47.9025, height: 2600, heading: 0, pitch: -38 };
export const UB_BBOX: [number, number, number, number] = [106.3626, 47.302, 108.5008, 48.2719];

export type ImageryMode = "satellite" | "sentinel" | "map" | "none";
export type LayerKey =
  | "buildings" | "unknownHeights" | "roads" | "terrain" | "vegetation" | "trees" | "water" | "transit" | "boundaries"
  | "signals" | "traffic";

/** Live traffic flow (congestion) from TomTom; needs the user's own API key. */
export const TRAFFIC_KEY_STORAGE = "ub3d.tomtomKey";
export function trafficKey(): string {
  try {
    return localStorage.getItem(TRAFFIC_KEY_STORAGE) || process.env.NEXT_PUBLIC_TOMTOM_KEY || "";
  } catch {
    return process.env.NEXT_PUBLIC_TOMTOM_KEY || "";
  }
}

export interface BuildingInfo {
  id: string;
  name: string;
  cls: string;
  height: number;
  heightSource: "source" | "floors" | "unknown";
  floors: number;
  dataset: string;
  area: number;
  ground: number;
  lon: number;
  lat: number;
}

export interface PickInfo {
  lon: number;
  lat: number;
  height: number;
}

type FC = { type: "FeatureCollection"; features: { geometry: { type: string; coordinates: any }; properties: any }[] };

const DATA = "/data";
const HS = ["source", "floors", "unknown"] as const;
const DATASETS = ["OpenStreetMap", "Microsoft ML Buildings", "Google-Microsoft Open Buildings (doi:10.5281/zenodo.8174931)", "unknown"];

// Cartographic display widths in metres (the sources rarely give real widths; these are styling only).
type RoadStyle = { color: string; widthM: number; minPx: number; minLevel: number };
const RS = (color: string, widthM: number, minPx: number, minLevel: number): RoadStyle => ({ color, widthM, minPx, minLevel });
const ROAD_STYLE: Record<string, RoadStyle> = {
  motorway: RS("#ffb35c", 22, 1.4, 9), trunk: RS("#ffc46b", 18, 1.3, 9), primary: RS("#ffd88a", 15, 1.1, 10),
  secondary: RS("#fff0b3", 12, 1, 12), tertiary: RS("#ffffff", 10, 1, 13), residential: RS("#f7f7f7", 7, 0.9, 14),
  unclassified: RS("#f0f0f0", 6, 0.9, 14), living_street: RS("#f0f0f0", 6, 0.9, 15), service: RS("#ececec", 4, 0.8, 15),
  track: RS("#dcc9a0", 3, 0.8, 15), path: RS("#e0d6c4", 1.8, 0.8, 16), footway: RS("#f0dcd4", 2, 0.8, 16),
  cycleway: RS("#b9d9ff", 2, 0.8, 16), steps: RS("#f0dcd4", 2, 0.8, 16), pedestrian: RS("#ece6f4", 5, 1, 15),
  unknown: RS("#e6e6e6", 4, 0.8, 15),
};
const RANK = ["path", "footway", "cycleway", "steps", "track", "service", "pedestrian", "unknown", "living_street",
  "unclassified", "residential", "tertiary", "secondary", "primary", "trunk", "motorway"];
const roadRank = (p: any) => (p.k === "rail" ? 100 : RANK.indexOf(p.c));
type RoadIndex = { cells: { f: string; b: [number, number, number, number]; n: number }[] };
const OVERLAY_RECT: [number, number, number, number] = [106.3, 47.25, 108.56, 48.33];
const OVERLAY_ORDER: LayerKey[] = ["vegetation", "trees", "water", "roads", "traffic", "boundaries"];

export const isMobile = () =>
  typeof navigator !== "undefined" && (/iPhone|iPad|Android/i.test(navigator.userAgent) || window.innerWidth < 760);

async function getJSON<T>(path: string): Promise<T> {
  const r = await fetch(`${DATA}/${path}`);
  if (!r.ok) throw new Error(`${path}: ${r.status}`);
  return r.json();
}

function polygons(geom: { type: string; coordinates: any }): number[][][][] {
  if (geom.type === "Polygon") return [geom.coordinates];
  if (geom.type === "MultiPolygon") return geom.coordinates;
  return [];
}

function iconCanvas(draw: (ctx: CanvasRenderingContext2D) => void, size = 32): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!);
  return c;
}

const SIGNAL_ICON = (pedestrian: boolean) => iconCanvas((ctx) => {
  ctx.fillStyle = "#222";
  ctx.beginPath();
  ctx.roundRect(9, 1, 14, 30, 4);
  ctx.fill();
  const lamps = ["#ff4d4d", "#ffd23f", "#3ddc6a"];
  lamps.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.arc(16, 7 + i * 9, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.globalAlpha = 1;
  if (pedestrian) {
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(9, 1, 14, 30);
  }
});

const BUS_ICON = () => iconCanvas((ctx) => {
  ctx.fillStyle = "#1e6fd9";
  ctx.beginPath();
  ctx.roundRect(3, 3, 26, 26, 6);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 18px system-ui";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("A", 16, 17);
});

export class Twin {
  viewer: Viewer;
  buildings?: Cesium3DTileset;
  private overlays = new Map<LayerKey, ImageryLayer>();
  private labels = new Map<LayerKey, { show: boolean }>();
  private baseLayer?: ImageryLayer;
  private visible: Record<LayerKey, boolean> = {
    buildings: true, unknownHeights: true, roads: true, terrain: true, vegetation: true, trees: true,
    water: true, transit: true, boundaries: true, signals: true, traffic: false,
  };
  private roadCells = new Map<string, Promise<Feat[]>>();
  private handler: ScreenSpaceEventHandler;
  private sidecars = new Map<string, Promise<any>>();
  private measure: { mode: "distance" | "area" | null; points: Cartesian3[]; entity?: Entity; label?: Entity } = {
    mode: null, points: [],
  };
  private highlighted?: { feature: Cesium3DTileFeature; color: Color };
  private street = { on: false, keys: new Set<string>(), heading: 0, pitch: 0, move: { f: 0, r: 0, t: 0 } };
  onPick: (b: BuildingInfo | null, p: PickInfo | null) => void = () => {};
  onSignal: (s: { kind: string; id: string; lon: number; lat: number } | null) => void = () => {};
  onMeasure: (text: string) => void = () => {};
  onCamera: (p: PickInfo & { altitude: number }) => void = () => {};

  constructor(container: HTMLElement) {
    const mobile = isMobile();
    this.viewer = new Viewer(container, {
      baseLayer: false,
      terrainProvider: createTerrariumTerrain(),
      animation: false, timeline: false, geocoder: false, homeButton: false, sceneModePicker: false,
      baseLayerPicker: false, navigationHelpButton: false, fullscreenButton: false, infoBox: false,
      selectionIndicator: false, scene3DOnly: true, requestRenderMode: true, maximumRenderTimeChange: Infinity,
      msaaSamples: mobile ? 1 : 4,
    });
    const scene = this.viewer.scene;
    scene.globe.baseColor = Color.fromCssColorString("#5b5e55");
    scene.globe.depthTestAgainstTerrain = true;
    scene.globe.maximumScreenSpaceError = mobile ? 3 : 2;
    scene.globe.tileCacheSize = mobile ? 80 : 200;
    scene.fog.enabled = true;
    scene.fog.density = 1.2e-4;
    scene.highDynamicRange = false;
    scene.postProcessStages.fxaa.enabled = true;
    if (mobile) this.viewer.resolutionScale = Math.min(window.devicePixelRatio, 1.5) / window.devicePixelRatio;
    // Midday light at Ulaanbaatar (UTC+8) so facades are lit naturally regardless of the viewer's clock.
    this.viewer.clock.currentTime = JulianDate.fromIso8601("2026-06-21T04:00:00Z");
    this.viewer.clock.shouldAnimate = false;
    this.setImagery("satellite");
    this.handler = new ScreenSpaceEventHandler(scene.canvas);
    this.handler.setInputAction((e: { position: Cartesian2 }) => this.click(e.position), ScreenSpaceEventType.LEFT_CLICK);
    this.handler.setInputAction((e: { position: Cartesian2 }) => this.dblClick(e.position), ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    this.viewer.camera.changed.addEventListener(() => this.cameraChanged());
    this.viewer.camera.percentageChanged = 0.05;
    this.home(0);
  }

  // ---------- camera ----------
  home(duration = 2) {
    this.viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(UB_HOME.lon, UB_HOME.lat - 0.022, UB_HOME.height),
      orientation: { heading: CMath.toRadians(UB_HOME.heading), pitch: CMath.toRadians(UB_HOME.pitch), roll: 0 },
      duration,
    });
  }

  /** Set the camera directly (degrees, metres above the ellipsoid). Used by tests and deep links. */
  setView(lon: number, lat: number, height: number, heading = 0, pitch = -35) {
    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(lon, lat, height),
      orientation: { heading: CMath.toRadians(heading), pitch: CMath.toRadians(pitch), roll: 0 },
    });
    this.viewer.scene.requestRender();
  }

  wholeCity() {
    this.viewer.camera.flyTo({ destination: Rectangle.fromDegrees(...UB_BBOX), duration: 2.5 });
  }

  flyTo(lon: number, lat: number, bbox?: [number, number, number, number]) {
    if (bbox) {
      this.viewer.camera.flyTo({ destination: Rectangle.fromDegrees(...bbox), duration: 2 });
      return;
    }
    const target = Cartesian3.fromDegrees(lon, lat, 0);
    const h = this.viewer.scene.globe.getHeight(Cartographic.fromDegrees(lon, lat)) ?? 1300;
    this.viewer.camera.flyTo({
      destination: Cartesian3.fromDegrees(lon, lat - 0.0045, h + 420),
      orientation: { heading: 0, pitch: CMath.toRadians(-42), roll: 0 },
      duration: 2,
    });
    void target;
  }

  private cameraChanged() {
    const cam = this.viewer.camera;
    const c = cam.positionCartographic;
    const center = this.viewer.scene.pickPosition?.(new Cartesian2(this.viewer.canvas.clientWidth / 2, this.viewer.canvas.clientHeight / 2));
    let p: PickInfo = { lon: CMath.toDegrees(c.longitude), lat: CMath.toDegrees(c.latitude), height: c.height };
    if (center && defined(center)) {
      const cc = Cartographic.fromCartesian(center);
      if (cc) p = { lon: CMath.toDegrees(cc.longitude), lat: CMath.toDegrees(cc.latitude), height: cc.height };
    }
    this.onCamera({ ...p, altitude: c.height });
  }

  // ---------- imagery ----------
  async setImagery(mode: ImageryMode) {
    const layers = this.viewer.imageryLayers;
    if (this.baseLayer) layers.remove(this.baseLayer, true);
    this.baseLayer = undefined;
    const before = layers.length;
    if (mode === "none") {
      this.viewer.scene.requestRender();
      return;
    }
    if (mode === "satellite") {
      try {
        const provider = await ArcGisMapServerImageryProvider.fromUrl(
          "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer",
        );
        layers.add(new ImageryLayer(provider));
      } catch {
        layers.addImageryProvider(new UrlTemplateImageryProvider({
          url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          maximumLevel: 19,
          credit: new Credit("Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community"),
        }));
      }
    } else if (mode === "sentinel") {
      layers.addImageryProvider(new UrlTemplateImageryProvider({
        url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg",
        maximumLevel: 15,
        credit: new Credit("Sentinel-2 cloudless 2024 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2024), CC BY-NC-SA 4.0"),
      }));
    } else if (mode === "map") {
      layers.addImageryProvider(new UrlTemplateImageryProvider({
        url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        maximumLevel: 19,
        credit: new Credit("© OpenStreetMap contributors (ODbL)"),
      }));
    }
    if (layers.length > before) {
      this.baseLayer = layers.get(layers.length - 1);
      layers.lowerToBottom(this.baseLayer);
    }
    this.viewer.scene.requestRender();
  }

  // ---------- data layers ----------
  /** Load the data layers. `only` restricts loading (used by deep links like ?layers=buildings,roads). */
  async loadAll(progress: (msg: string) => void, only?: Set<string>) {
    const want = (k: string) => !only || only.has(k);
    if (want("buildings")) { progress("Барилга"); await this.loadBuildings(); }
    progress("Хил, гол замууд");
    await Promise.all([want("boundaries") && this.loadBoundaries(), want("roads") && this.loadRoads()]);
    progress("Ус, ургамал");
    await Promise.all([want("water") && this.loadWater(), want("vegetation") && this.loadVegetation()]);
    progress("Мод, автобусны буудал");
    await Promise.all([want("transit") && this.loadTransit(), want("signals") && this.loadSignals()]);
    progress("");
  }

  private async loadBuildings() {
    const mobile = isMobile();
    const ts = await Cesium3DTileset.fromUrl(`${DATA}/buildings/tileset.json`, {
      maximumScreenSpaceError: mobile ? 24 : 12,
      cacheBytes: (mobile ? 192 : 512) * 1024 * 1024,
      skipLevelOfDetail: false,
      preloadWhenHidden: false,
      dynamicScreenSpaceError: true,
    });
    // Flat normals from screen-space derivatives: tiles ship without normals to stay small.
    ts.customShader = new CustomShader({
      lightingModel: LightingModel.PBR,
      fragmentShaderText: `
        void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
          vec3 p = fsInput.attributes.positionEC;
          vec3 n = normalize(cross(dFdx(p), dFdy(p)));
          material.normalEC = n;
          float up = clamp(dot(n, normalize(czm_normal * vec3(0.0, 0.0, 1.0))), 0.0, 1.0);
          material.diffuse *= mix(1.0, 0.92, step(0.8, up));
        }`,
    });
    this.buildings = ts;
    this.applyBuildingStyle();
    this.viewer.scene.primitives.add(ts);
  }

  applyBuildingStyle() {
    if (!this.buildings) return;
    const showUnknown = this.visible.unknownHeights;
    this.buildings.style = new Cesium3DTileStyle({
      show: showUnknown ? "true" : "${hs} !== 2",
      color: {
        conditions: [
          ["${hs} === 2", "color('#d8d3ca', 1.0)"],
          ["${hs} === 1", "color('#f0cf9c', 1.0)"],
          ["true", "color('#fbf7ef', 1.0)"],
        ],
      },
    });
    this.buildings.show = this.visible.buildings;
    this.viewer.scene.requestRender();
  }

  private async loadBoundaries() {
    const fc = await getJSON<FC>("boundary.geojson");
    const feats = withBBox(fc.features as Feat[]);
    this.addOverlay("boundaries", new VectorImageryProvider({
      rectangle: OVERLAY_RECT, maximumLevel: 16, credit: "Boundaries: Overture Maps divisions",
      draw: (d) => {
        for (const f of feats) {
          if (!f.bbox || !intersects(f.bbox, d.bbox)) continue;
          const city = f.properties.kind === "city";
          d.ctx.strokeStyle = city ? "rgba(255,90,90,0.95)" : "rgba(255,209,102,0.95)";
          const k = d.level < 9 ? 0.45 : d.level < 11 ? 0.7 : 1;
          d.ctx.lineWidth = (city ? 3.5 : 2) * k;
          d.ctx.setLineDash(city ? [] : [8, 5]);
          strokeLines(d, f.geometry);
        }
        d.ctx.setLineDash([]);
      },
    }));
    const labels = new LabelCollection({ scene: this.viewer.scene });
    for (const f of fc.features) {
      if (f.properties.kind !== "district") continue;
      const rings = polygons(f.geometry).sort((a, b) => b[0].length - a[0].length)[0];
      if (!rings) continue;
      const [lon, lat] = centroid(rings[0]);
      labels.add({
        position: Cartesian3.fromDegrees(lon, lat, 2200),
        text: f.properties.name,
        font: "600 15px system-ui",
        fillColor: Color.WHITE,
        outlineColor: Color.BLACK,
        outlineWidth: 3,
        style: LabelStyle.FILL_AND_OUTLINE,
        distanceDisplayCondition: new DistanceDisplayCondition(8000, 400000),
        scaleByDistance: new NearFarScalar(10000, 1.1, 200000, 0.7),
        horizontalOrigin: HorizontalOrigin.CENTER,
      });
    }
    this.labels.set("boundaries", labels);
    labels.show = this.visible.boundaries;
    this.viewer.scene.primitives.add(labels);
  }

  private roadCell(key: string): Promise<Feat[]> {
    let p = this.roadCells.get(key);
    if (!p) {
      p = getJSON<FC>(`roads/cells/${key}.geojson`).then((fc) => withBBox(fc.features as Feat[])).catch(() => []);
      this.roadCells.set(key, p);
      if (this.roadCells.size > 120) this.roadCells.delete(this.roadCells.keys().next().value!);
    }
    return p;
  }

  private async loadRoads() {
    const [fc, index] = await Promise.all([getJSON<FC>("roads/main.geojson"), getJSON<RoadIndex>("roads/index.json")]);
    const main = withBBox(fc.features as Feat[]).sort((a, b) => roadRank(a.properties) - roadRank(b.properties));
    const drawRoads = (d: DrawContext, feats: Feat[]) => {
      // casing pass, then fill pass, so junctions look clean
      for (const pass of [0, 1]) {
        for (const f of feats) {
          if (!f.bbox || !intersects(f.bbox, d.bbox)) continue;
          const p = f.properties;
          if (p.k === "rail") {
            if (pass === 0 || d.level < 11) continue;
            d.ctx.strokeStyle = "rgba(60,60,70,0.9)";
            d.ctx.lineWidth = Math.max(1.5, 3 * d.ppm);
            d.ctx.setLineDash(d.level >= 15 ? [6, 6] : []);
            strokeLines(d, f.geometry);
            d.ctx.setLineDash([]);
            continue;
          }
          const st = ROAD_STYLE[p.c] ?? ROAD_STYLE.unknown;
          if (d.level < st.minLevel) continue;
          const wpx = Math.max(st.minPx, st.widthM * d.ppm);
          if (pass === 0) {
            if (d.level < 14) continue; // casing only when zoomed in
            d.ctx.strokeStyle = "rgba(40,40,40,0.55)";
            d.ctx.lineWidth = wpx + Math.max(1, wpx * 0.18);
          } else {
            d.ctx.strokeStyle = st.color;
            d.ctx.lineWidth = wpx;
          }
          strokeLines(d, f.geometry);
        }
      }
    };
    this.addOverlay("roads", new VectorImageryProvider({
      rectangle: OVERLAY_RECT, maximumLevel: 19, credit: "Roads: Overture Maps (OpenStreetMap contributors, ODbL)",
      draw: async (d) => {
        let feats = main;
        if (d.level >= 14) {
          const keys = index.cells.filter((c) => intersects(c.b, d.bbox)).map((c) => c.f);
          const detail = (await Promise.all(keys.map((k) => this.roadCell(k)))).flat();
          feats = [...detail, ...main].sort((a, b) => roadRank(a.properties) - roadRank(b.properties));
        }
        drawRoads(d, feats);
      },
    }));
  }

  private async loadWater() {
    const fc = await getJSON<FC>("water.geojson");
    const feats = withBBox(fc.features as Feat[]);
    this.addOverlay("water", new VectorImageryProvider({
      rectangle: OVERLAY_RECT, maximumLevel: 18, credit: "Water: Overture Maps (OpenStreetMap contributors, ODbL)",
      draw: (d) => {
        d.ctx.fillStyle = "rgba(61,143,216,0.85)";
        for (const f of feats) {
          if (!f.bbox || !intersects(f.bbox, d.bbox)) continue;
          if (f.geometry.type.endsWith("Polygon")) fillPolygons(d, f.geometry);
        }
        for (const f of feats) {
          if (!f.bbox || !intersects(f.bbox, d.bbox) || f.geometry.type.endsWith("Polygon")) continue;
          const k = f.properties.k;
          const m = k === "river" ? 8 : k === "canal" ? 3 : 2;
          if (k === "stream" && d.level < 12) continue;
          d.ctx.strokeStyle = "rgba(61,143,216,0.9)";
          d.ctx.lineWidth = Math.max(k === "river" && d.level >= 11 ? 2 : 0.8, m * d.ppm);
          d.ctx.setLineDash(f.properties.i ? [4, 3] : []);
          strokeLines(d, f.geometry);
        }
        d.ctx.setLineDash([]);
      },
    }));
  }

  private async loadVegetation() {
    const [fc, trees] = await Promise.all([getJSON<FC>("vegetation.geojson"), getJSON<FC>("trees.geojson")]);
    const feats = withBBox(fc.features as Feat[]);
    const treePts = trees.features.map((f) => f.geometry.coordinates as [number, number]);
    const colors: Record<string, string> = {
      forest: "#2f6b34", shrub: "#5f8a46", grass: "#7fb05a", wetland: "#5a9a8a", park: "#4f9a4a",
      managed: "#7fb05a", horticulture: "#6aa84f", agriculture: "#a8c070", cemetery: "#88a080", recreation: "#6ab04c",
    };
    this.addOverlay("vegetation", new VectorImageryProvider({
      rectangle: OVERLAY_RECT, maximumLevel: 18, credit: "Vegetation: Overture Maps (OpenStreetMap contributors, ODbL)",
      draw: (d) => {
        d.ctx.globalAlpha = 0.42;
        for (const f of feats) {
          if (!f.bbox || !intersects(f.bbox, d.bbox)) continue;
          d.ctx.fillStyle = colors[f.properties.k] ?? "#6a9a50";
          fillPolygons(d, f.geometry);
        }
        d.ctx.globalAlpha = 1;
      },
    }));
    // individually mapped trees: canopy dots (display size 3 m radius, not a measured canopy)
    this.addOverlay("trees", new VectorImageryProvider({
      rectangle: OVERLAY_RECT, minimumLevel: 0, maximumLevel: 19, credit: "Trees: Overture Maps (OpenStreetMap contributors, ODbL)",
      draw: (d) => {
        if (d.level < 15) return;
        const r = Math.max(1.5, 3 * d.ppm);
        d.ctx.fillStyle = "rgba(46,125,50,0.9)";
        d.ctx.strokeStyle = "rgba(20,60,20,0.8)";
        d.ctx.lineWidth = 1;
        const [w, s, e, n] = d.bbox;
        for (const [lon, lat] of treePts) {
          if (lon < w || lon > e || lat < s || lat > n) continue;
          const [x, y] = d.px(lon, lat);
          d.ctx.beginPath();
          d.ctx.arc(x, y, r, 0, Math.PI * 2);
          d.ctx.fill();
          d.ctx.stroke();
        }
      },
    }));
  }

  private async loadTransit() {
    const fc = await getJSON<FC>("transit.geojson");
    const col = new PrimitiveCollection();
    const bc = new BillboardCollection({ scene: this.viewer.scene });
    const labels = new LabelCollection({ scene: this.viewer.scene });
    const img = BUS_ICON();
    for (const f of fc.features) {
      if (f.properties.c !== "bus_stop") continue;
      const [lon, lat] = f.geometry.coordinates;
      const pos = Cartesian3.fromDegrees(lon, lat);
      bc.add({
        position: pos, image: img, width: 22, height: 22, verticalOrigin: VerticalOrigin.BOTTOM,
        heightReference: HeightReference.CLAMP_TO_GROUND,
        distanceDisplayCondition: new DistanceDisplayCondition(0, 5000),
        disableDepthTestDistance: 3000,
      });
      if (f.properties.n) {
        labels.add({
          position: pos, text: f.properties.n, font: "600 12px system-ui", fillColor: Color.WHITE,
          outlineColor: Color.fromCssColorString("#0b3b80"), outlineWidth: 3, style: LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cartesian2(0, -28), heightReference: HeightReference.CLAMP_TO_GROUND,
          distanceDisplayCondition: new DistanceDisplayCondition(0, 1200), disableDepthTestDistance: 1500,
        });
      }
    }
    col.add(bc);
    col.add(labels);
    this.labels.set("transit", col);
    col.show = this.visible.transit;
    this.viewer.scene.primitives.add(col);
  }

  private signalIds = new Map<any, { kind: string; id: string; lon: number; lat: number }>();

  private async loadSignals() {
    const fc = await getJSON<FC>("signals.geojson");
    const bc = new BillboardCollection({ scene: this.viewer.scene });
    const road = SIGNAL_ICON(false), ped = SIGNAL_ICON(true);
    for (const f of fc.features) {
      const [lon, lat] = f.geometry.coordinates;
      const b = bc.add({
        position: Cartesian3.fromDegrees(lon, lat), image: f.properties.c === "road" ? road : ped,
        width: 18, height: 18, verticalOrigin: VerticalOrigin.BOTTOM, heightReference: HeightReference.CLAMP_TO_GROUND,
        distanceDisplayCondition: new DistanceDisplayCondition(0, 4000), disableDepthTestDistance: 2000,
        scaleByDistance: new NearFarScalar(100, 1.4, 4000, 0.7),
      });
      this.signalIds.set(b, { kind: f.properties.c, id: f.properties.id, lon, lat });
    }
    this.labels.set("signals", bc);
    bc.show = this.visible.signals;
    this.viewer.scene.primitives.add(bc);
  }

  /** (Re)create the live traffic layer. Returns false when no key is configured. */
  refreshTraffic(): boolean {
    const key = trafficKey();
    const old = this.overlays.get("traffic");
    if (old) {
      this.viewer.imageryLayers.remove(old, true);
      this.overlays.delete("traffic");
    }
    if (!key) return false;
    const stamp = Math.floor(Date.now() / 120000); // new tiles every 2 minutes
    const layer = new ImageryLayer(new UrlTemplateImageryProvider({
      url: `https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?tileSize=256&key=${encodeURIComponent(key)}&t=${stamp}`,
      minimumLevel: 0,
      maximumLevel: 18,
      rectangle: Rectangle.fromDegrees(...OVERLAY_RECT),
      credit: new Credit("Live traffic flow © TomTom"),
    }), { alpha: 0.9 });
    layer.show = this.visible.traffic;
    this.overlays.set("traffic", layer);
    this.restackOverlays();
    this.trafficUpdated = new Date();
    return true;
  }

  trafficUpdated?: Date;
  private trafficTimer?: ReturnType<typeof setInterval>;

  private addOverlay(key: LayerKey, provider: VectorImageryProvider) {
    const layer = new ImageryLayer(provider as any, {});
    layer.show = this.visible[key];
    this.overlays.set(key, layer);
    this.restackOverlays();
  }

  /** Keep overlays above the base imagery in a fixed order. */
  private restackOverlays() {
    const layers = this.viewer.imageryLayers;
    for (const key of OVERLAY_ORDER) {
      const l = this.overlays.get(key);
      if (!l) continue;
      if (layers.contains(l)) layers.remove(l, false);
      layers.add(l);
    }
    this.viewer.scene.requestRender();
  }

  setLayer(key: LayerKey, on: boolean) {
    this.visible[key] = on;
    if (key === "buildings" || key === "unknownHeights") this.applyBuildingStyle();
    else if (key === "terrain") {
      this.viewer.terrainProvider = on ? createTerrariumTerrain() : new EllipsoidTerrainProvider();
    } else if (key === "traffic") {
      clearInterval(this.trafficTimer);
      if (on) {
        this.refreshTraffic();
        this.trafficTimer = setInterval(() => this.refreshTraffic(), 120000);
      } else {
        const o = this.overlays.get("traffic");
        if (o) o.show = false;
      }
    } else {
      const o = this.overlays.get(key);
      if (o) o.show = on;
      const l = this.labels.get(key);
      if (l) l.show = on;
    }
    this.viewer.scene.requestRender();
  }

  // ---------- picking ----------
  private pickGround(pos: Cartesian2): Cartesian3 | undefined {
    const scene = this.viewer.scene;
    if (scene.pickPositionSupported) {
      const p = scene.pickPosition(pos);
      if (p && defined(p)) return p;
    }
    const ray = this.viewer.camera.getPickRay(pos);
    return ray ? scene.globe.pick(ray, scene) : undefined;
  }

  private async click(pos: Cartesian2) {
    if (this.measure.mode) {
      const p = this.pickGround(pos);
      if (p) this.addMeasurePoint(p);
      return;
    }
    const picked = this.viewer.scene.pick(pos);
    const ground = this.pickGround(pos);
    const carto = ground ? Cartographic.fromCartesian(ground) : undefined;
    const info: PickInfo | null = carto
      ? { lon: CMath.toDegrees(carto.longitude), lat: CMath.toDegrees(carto.latitude), height: carto.height }
      : null;
    this.clearHighlight();
    const sig = picked?.primitive ? this.signalIds.get(picked.primitive) : undefined;
    this.onSignal(sig ?? null);
    if (sig) {
      this.onPick(null, info);
      return;
    }
    if (picked instanceof Cesium3DTileFeature) {
      this.highlighted = { feature: picked, color: Color.clone(picked.color) };
      picked.color = Color.fromCssColorString("#4fb3ff");
      this.viewer.scene.requestRender();
      this.onPick(await this.buildingInfo(picked), info);
    } else {
      this.onPick(null, info);
    }
  }

  private dblClick(pos: Cartesian2) {
    if (this.measure.mode) this.finishMeasure();
  }

  clearHighlight() {
    if (this.highlighted) {
      try { this.highlighted.feature.color = this.highlighted.color; } catch { /* tile unloaded */ }
      this.highlighted = undefined;
      this.viewer.scene.requestRender();
    }
  }

  private async buildingInfo(f: Cesium3DTileFeature): Promise<BuildingInfo> {
    const url: string = ((f as any).content?.url ?? (f as any)._content?.url ?? "") as string;
    const sideUrl = url.replace(/\.b3dm(\?.*)?$/, ".json");
    let side = this.sidecars.get(sideUrl);
    if (!side) {
      side = fetch(sideUrl).then((r) => r.json()).catch(() => null);
      this.sidecars.set(sideUrl, side);
    }
    const s = await side;
    const i = f.featureId;
    const hs = HS[f.getProperty("hs") as number] ?? "unknown";
    return {
      id: s?.id?.[i] ?? "",
      name: s?.name?.[i] ?? "",
      cls: s?.cls?.[i] ?? "",
      height: f.getProperty("height") as number,
      heightSource: hs,
      floors: s?.floors?.[i] ?? 0,
      dataset: DATASETS[s?.dataset?.[i] ?? 3],
      area: s?.area?.[i] ?? 0,
      ground: s?.ground?.[i] ?? NaN,
      lon: NaN,
      lat: NaN,
    };
  }

  // ---------- measurement ----------
  startMeasure(mode: "distance" | "area") {
    this.clearMeasure();
    this.measure.mode = mode;
    this.onMeasure(mode === "distance" ? "Газрын гадарга дээр цэгүүд дарна уу" : "Талбайн булангуудыг дарна уу");
    const positions = new CallbackProperty(() => this.measure.points, false);
    this.measure.entity = this.viewer.entities.add(
      mode === "distance"
        ? { polyline: new PolylineGraphics({ positions, width: 3, material: Color.fromCssColorString("#4fb3ff"), clampToGround: true }) }
        : {
            polygon: new PolygonGraphics({
              hierarchy: new CallbackProperty(() => new PolygonHierarchy(this.measure.points), false),
              material: Color.fromCssColorString("#4fb3ff").withAlpha(0.35),
              classificationType: new ConstantProperty(ClassificationType.BOTH),
            }),
            polyline: new PolylineGraphics({
              positions: new CallbackProperty(() => [...this.measure.points, ...this.measure.points.slice(0, 1)], false),
              width: 2, material: Color.fromCssColorString("#4fb3ff"), clampToGround: true,
            }),
          },
    );
  }

  private addMeasurePoint(p: Cartesian3) {
    this.measure.points.push(p);
    const ll: LonLat[] = this.measure.points.map((q) => {
      const c = Cartographic.fromCartesian(q);
      return [CMath.toDegrees(c.longitude), CMath.toDegrees(c.latitude)];
    });
    let text: string;
    if (this.measure.mode === "distance") {
      text = ll.length < 2 ? "Дараагийн цэгийг дарна уу" : `Зай: ${formatDistance(pathLength(ll))} (${ll.length} цэг)`;
    } else {
      text = ll.length < 3 ? "Дор хаяж 3 цэг хэрэгтэй" :
        `Талбай: ${formatArea(polygonArea(ll))}, периметр: ${formatDistance(pathLength([...ll, ll[0]]))}`;
    }
    this.onMeasure(text);
    this.viewer.scene.requestRender();
  }

  finishMeasure() {
    this.measure.mode = null;
  }

  clearMeasure() {
    if (this.measure.entity) this.viewer.entities.remove(this.measure.entity);
    this.measure = { mode: null, points: [] };
    this.onMeasure("");
    this.viewer.scene.requestRender();
  }

  // ---------- street-level ----------
  setStreetLevel(on: boolean) {
    const ctrl = this.viewer.scene.screenSpaceCameraController;
    this.street.on = on;
    if (!on) {
      ctrl.enableRotate = ctrl.enableTranslate = ctrl.enableZoom = ctrl.enableTilt = ctrl.enableLook = true;
      this.viewer.clock.onTick.removeEventListener(this.tick);
      this.viewer.scene.requestRenderMode = true;
      return;
    }
    const cam = this.viewer.camera;
    const center = this.pickGround(new Cartesian2(this.viewer.canvas.clientWidth / 2, this.viewer.canvas.clientHeight / 2));
    const carto = center ? Cartographic.fromCartesian(center) : cam.positionCartographic.clone();
    const h = this.viewer.scene.globe.getHeight(carto) ?? carto.height;
    this.street.heading = cam.heading;
    this.street.pitch = 0;
    cam.setView({
      destination: Cartesian3.fromRadians(carto.longitude, carto.latitude, h + 1.7),
      orientation: { heading: this.street.heading, pitch: 0, roll: 0 },
    });
    ctrl.enableRotate = ctrl.enableTranslate = ctrl.enableZoom = ctrl.enableTilt = false;
    ctrl.enableLook = false;
    this.viewer.scene.requestRenderMode = false;
    this.viewer.clock.shouldAnimate = true;
    this.viewer.clock.onTick.addEventListener(this.tick);
  }

  /** Street-level input: forward/back (-1..1), strafe (-1..1), turn (-1..1). */
  setStreetMove(f: number, r: number, t: number) {
    this.street.move = { f, r, t };
  }

  look(dx: number, dy: number) {
    if (!this.street.on) return;
    this.street.heading += dx * 0.004;
    this.street.pitch = Math.max(-1.2, Math.min(1.2, this.street.pitch - dy * 0.004));
  }

  keyDown(code: string) { this.street.keys.add(code); }
  keyUp(code: string) { this.street.keys.delete(code); }

  private last = 0;
  private tick = () => {
    if (!this.street.on) return;
    const now = performance.now();
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    const k = this.street.keys;
    let f = this.street.move.f + (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0);
    let r = this.street.move.r + (k.has("KeyD") ? 1 : 0) - (k.has("KeyA") ? 1 : 0);
    const t = this.street.move.t + (k.has("ArrowRight") ? 1 : 0) - (k.has("ArrowLeft") ? 1 : 0);
    const speed = k.has("ShiftLeft") ? 14 : 4.5; // m/s, walking / running
    this.street.heading += t * 1.4 * dt;
    const cam = this.viewer.camera;
    const c = cam.positionCartographic;
    const hd = this.street.heading;
    const dE = (Math.sin(hd) * f + Math.cos(hd) * r) * speed * dt;
    const dN = (Math.cos(hd) * f - Math.sin(hd) * r) * speed * dt;
    const lat = c.latitude + dN / 6378137;
    const lon = c.longitude + dE / (6378137 * Math.cos(c.latitude));
    const ground = this.viewer.scene.globe.getHeight(new Cartographic(lon, lat)) ?? c.height - 1.7;
    cam.setView({
      destination: Cartesian3.fromRadians(lon, lat, ground + 1.7),
      orientation: { heading: hd, pitch: this.street.pitch, roll: 0 },
    });
    void f; void r;
  };

  destroy() {
    this.handler.destroy();
    this.viewer.destroy();
  }
}

function centroid(ring: number[][]): [number, number] {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}
