// Shapes of the real data written by pipeline/ub6pipeline/build_tiles.py (format ub6-chunks-v2).
export interface RoadData {
  id: string; class: string; name: string | null; name_en: string | null; width: number; width_src: string;
  oneway: number; drivable: boolean; surface: string | null; subclass?: string | null; flags?: string[]; pts: [number, number, number][];
}
export interface BuildingData {
  id: string; name: string | null; name_en: string | null; subtype: string | null; class: string | null;
  height: number; height_src: string; floors: number | null; base_z: number; rings: [number, number][][];
  /** courtyards of a single-ring footprint */
  holes?: [number, number][][];
  /** V2: architectural category and drawing height, each with how it was obtained (see pipeline/ub6pipeline/enrich.py) */
  arch?: string; arch_src?: string; vis_height?: number; vis_height_src?: string; footprint_src?: string;
}
export interface AreaData {
  id: string; name: string | null; name_en: string | null; subtype: string | null; class: string | null;
  ring?: [number, number][]; line?: [number, number][];
}
export interface PlaceData { id: string; name: string; category: string | null; pos: [number, number] }
export interface ChunkData {
  chunk: [number, number]; grid_n: number; height_grid_dm: number[];
  roads: RoadData[]; buildings: BuildingData[]; water: AreaData[]; land_use: AreaData[]; places: PlaceData[];
  /** V2: objects that exist in the source. Point props are [east, north, towardRoadE, towardRoadN, ...]. */
  props?: Props;
  /** real intersections: [east, north, radius, arms, signalised] */
  junctions?: [number, number, number, number, number][];
  /** stop lines at signalised junctions: [east, north, travelE, travelN, roadWidth, halfWidth] */
  stops?: [number, number, number, number, number, number][];
  /** mapped pedestrian crossings snapped to their road: [east, north, roadE, roadN, roadWidth, marked(0 no,1 yes,2 not stated), signalised] */
  crossings?: [number, number, number, number, number, number, number][];
}
export type PointProp = [number, number, number, number];
export interface Props {
  lamps?: PointProp[]; signals?: PointProp[]; benches?: PointProp[]; towers?: PointProp[]; poles?: PointProp[]; bins?: PointProp[]; bollards?: PointProp[];
  /** [east, north, towardRoadE, towardRoadN, shelter(0 no,1 yes,2 not stated), name] */
  bus_stops?: [number, number, number, number, number, string | null][];
  /** [east, north, kind(0 mapped tree, 1 placed along a mapped tree row), conifer] */
  trees?: [number, number, number, number][];
  barriers?: { k: string; h: number; h_src: string; pts: [number, number][] }[];
  parking?: [number, number][][]; fountain?: [number, number][][]; woods?: [number, number][][];
}
export interface Manifest {
  format: string; origin: { lat: number; lon: number }; chunk_size_m: number; height_grid_n: number;
  attribution: string[]; stats: Record<string, number>; chunks: { x: number; y: number; roads: number; buildings: number }[];
}
export interface Overview { x0: number; y0: number; x1: number; y1: number; per: number; w: number; h: number; cell_m: number; height_dm: number[] }
export interface Landmark { name: string; kind: string; lat: number; lon: number; east: number; north: number; ground_m: number }
