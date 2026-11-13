// Shapes of the real data written by pipeline/ub6pipeline/build_tiles.py (format ub6-chunks-v1).
export interface RoadData {
  id: string; class: string; name: string | null; name_en: string | null; width: number; width_src: string;
  oneway: number; drivable: boolean; surface: string | null; pts: [number, number, number][]; flags?: string[] | null;
}
export interface BuildingData {
  id: string; name: string | null; name_en: string | null; subtype: string | null; class: string | null;
  height: number; height_src: string; floors: number | null; base_z: number; rings: [number, number][][];
}
export interface AreaData {
  id: string; name: string | null; name_en: string | null; subtype: string | null; class: string | null;
  ring?: [number, number][]; line?: [number, number][];
}
export interface PlaceData { id: string; name: string; category: string | null; pos: [number, number] }
export interface ChunkData {
  chunk: [number, number]; grid_n: number; height_grid_dm: number[];
  roads: RoadData[]; buildings: BuildingData[]; water: AreaData[]; land_use: AreaData[]; places: PlaceData[];
}
export interface Manifest {
  format: string; origin: { lat: number; lon: number }; chunk_size_m: number; height_grid_n: number;
  attribution: string[]; stats: Record<string, number>; chunks: { x: number; y: number; roads: number; buildings: number }[];
}
export interface Overview { x0: number; y0: number; x1: number; y1: number; per: number; w: number; h: number; cell_m: number; height_dm: number[] }
export interface Landmark { name: string; kind: string; lat: number; lon: number; east: number; north: number; ground_m: number }
