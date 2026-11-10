export type QualityName = 'low' | 'medium' | 'high';
export interface Quality {
  name: QualityName;
  nearRings: number;      // chunks (256 m) around the player built in full detail with collision
  farRings: number;       // further chunks built simplified
  pixelRatio: number;     // cap on devicePixelRatio
  shadowMap: number;      // 0 = off
  pbr: boolean;           // MeshStandardMaterial vs cheaper Lambert
  groundTexNear: number; groundTexFar: number;
  particles: number;
}
export const QUALITY: Record<QualityName, Quality> = {
  low:    { name: 'low',    nearRings: 1, farRings: 2, pixelRatio: 1.0, shadowMap: 0,    pbr: false, groundTexNear: 256, groundTexFar: 128, particles: 500 },
  medium: { name: 'medium', nearRings: 1, farRings: 3, pixelRatio: 1.5, shadowMap: 1024, pbr: true,  groundTexNear: 512, groundTexFar: 128, particles: 1000 },
  high:   { name: 'high',   nearRings: 2, farRings: 5, pixelRatio: 2.0, shadowMap: 2048, pbr: true,  groundTexNear: 512, groundTexFar: 256, particles: 1600 },
};
export const TARGET_FPS = 30;
export const SPAWN = { east: 3.63, north: -6.9 };   // Sukhbaatar Square, from data/tiles/landmarks.json
