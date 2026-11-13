export type QualityName = 'low' | 'medium' | 'high';
export interface Quality {
  name: QualityName;
  nearRings: number;      // chunks (256 m) around the player built in full detail with collision
  farRings: number;       // further chunks built simplified (no road mesh, no small buildings)
  pixelRatio: number;     // cap on devicePixelRatio
  shadowMap: number;      // sun shadow map size, 0 = off
  softShadows: boolean;   // PCF soft filtering (4x the shadow samples) vs plain PCF
  pbr: boolean;           // buildings and character: MeshStandardMaterial vs cheaper Lambert
  groundTexNear: number; groundTexFar: number;
  farMinAreaM2: number;   // footprints smaller than this are skipped in far chunks
  anisotropy: number;
  particles: number;
}
// Three fixed profiles. AUTO starts on MEDIUM and moves between them from the measured frame rate.
export const QUALITY: Record<QualityName, Quality> = {
  low:    { name: 'low',    nearRings: 1, farRings: 2, pixelRatio: 1.0, shadowMap: 0,    softShadows: false, pbr: false, groundTexNear: 256, groundTexFar: 128, farMinAreaM2: 90, anisotropy: 2,particles: 500 },
  medium: { name: 'medium', nearRings: 1, farRings: 3, pixelRatio: 1.25, shadowMap: 1024, softShadows: false, pbr: false, groundTexNear: 512, groundTexFar: 256, farMinAreaM2: 60, anisotropy: 4, particles: 1000 },
  high:   { name: 'high',   nearRings: 2, farRings: 5, pixelRatio: 2.0, shadowMap: 2048, softShadows: true,  pbr: true,  groundTexNear: 512, groundTexFar: 256, farMinAreaM2: 40, anisotropy: 8, particles: 1600 },
};
export const TARGET_FPS = 30;
/** Frame-rate cap choices. 30 is the default on phones: half the GPU work of 60, so far less heat. */
export type FpsCap = 30 | 60;
// Sukhbaatar Square (centre from data/tiles/landmarks.json); the player starts 30 m south of the statue
export const SPAWN = { east: 3.63, north: -36.9 };
