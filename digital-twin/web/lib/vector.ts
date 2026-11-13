// Vector data drawn into imagery tiles on the fly (canvas), so roads, water, vegetation and
// boundaries drape exactly onto the terrain at almost no GPU cost. This is much lighter on a
// phone than thousands of ground-clamped polyline/polygon primitives.
import { Credit, Event, Math as CMath, Rectangle, WebMercatorTilingScheme } from "cesium";

export type Geom = { type: string; coordinates: any };
export type Feat = { geometry: Geom; properties: any; bbox?: [number, number, number, number] };

export interface DrawContext {
  ctx: CanvasRenderingContext2D;
  /** lon/lat (deg) -> tile pixel */
  px: (lon: number, lat: number) => [number, number];
  /** pixels per metre at this tile */
  ppm: number;
  level: number;
  bbox: [number, number, number, number];
}

export function featureBBox(g: Geom): [number, number, number, number] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const visit = (c: any) => {
    if (typeof c[0] === "number") {
      if (c[0] < w) w = c[0];
      if (c[0] > e) e = c[0];
      if (c[1] < s) s = c[1];
      if (c[1] > n) n = c[1];
    } else for (const x of c) visit(x);
  };
  visit(g.coordinates);
  return [w, s, e, n];
}

export function withBBox(features: Feat[]): Feat[] {
  for (const f of features) f.bbox = featureBBox(f.geometry);
  return features;
}

export function intersects(a: [number, number, number, number], b: [number, number, number, number]) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function strokeLines(d: DrawContext, g: Geom) {
  const parts = g.type === "LineString" ? [g.coordinates] : g.type === "MultiLineString" ? g.coordinates :
    g.type === "Polygon" ? g.coordinates : g.type === "MultiPolygon" ? g.coordinates.flat() : [];
  d.ctx.beginPath();
  for (const line of parts) {
    for (let i = 0; i < line.length; i++) {
      const [x, y] = d.px(line[i][0], line[i][1]);
      if (i === 0) d.ctx.moveTo(x, y);
      else d.ctx.lineTo(x, y);
    }
  }
  d.ctx.stroke();
}

export function fillPolygons(d: DrawContext, g: Geom) {
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  d.ctx.beginPath();
  for (const rings of polys) {
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const [x, y] = d.px(ring[i][0], ring[i][1]);
        if (i === 0) d.ctx.moveTo(x, y);
        else d.ctx.lineTo(x, y);
      }
      d.ctx.closePath();
    }
  }
  d.ctx.fill("evenodd");
}

const scheme = new WebMercatorTilingScheme();

function mercY(lat: number) {
  const r = CMath.toRadians(lat);
  return Math.log(Math.tan(Math.PI / 4 + r / 2));
}

/** A Cesium ImageryProvider whose tiles are painted by a callback. */
export class VectorImageryProvider {
  readonly tilingScheme = scheme;
  readonly tileWidth = 256;
  readonly tileHeight = 256;
  readonly minimumLevel: number;
  readonly maximumLevel: number;
  readonly rectangle: Rectangle;
  readonly errorEvent = new Event();
  readonly credit: Credit;
  readonly hasAlphaChannel = true;
  readonly ready = true;
  readonly tileDiscardPolicy = undefined;
  readonly proxy = undefined;
  readonly readyPromise = Promise.resolve(true);
  private draw: (d: DrawContext) => void | Promise<void>;

  constructor(opts: {
    draw: (d: DrawContext) => void | Promise<void>;
    rectangle: [number, number, number, number];
    minimumLevel?: number;
    maximumLevel?: number;
    credit: string;
  }) {
    this.draw = opts.draw;
    this.rectangle = Rectangle.fromDegrees(...opts.rectangle);
    this.minimumLevel = opts.minimumLevel ?? 0;
    this.maximumLevel = opts.maximumLevel ?? 18;
    this.credit = new Credit(opts.credit);
  }

  getTileCredits() {
    return [];
  }

  pickFeatures() {
    return undefined;
  }

  async requestImage(x: number, y: number, level: number): Promise<HTMLCanvasElement> {
    const rect = scheme.tileXYToRectangle(x, y, level);
    const w = CMath.toDegrees(rect.west), e = CMath.toDegrees(rect.east);
    const s = CMath.toDegrees(rect.south), n = CMath.toDegrees(rect.north);
    const my0 = mercY(n), my1 = mercY(s);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext("2d")!;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const midLat = CMath.toRadians((s + n) / 2);
    const tileMetres = (CMath.toRadians(e - w) * 6378137 * Math.cos(midLat));
    const d: DrawContext = {
      ctx,
      px: (lon, lat) => [((lon - w) / (e - w)) * 256, ((my0 - mercY(lat)) / (my0 - my1)) * 256],
      ppm: 256 / tileMetres,
      level,
      bbox: [w, s, e, n],
    };
    await this.draw(d);
    return canvas;
  }
}
