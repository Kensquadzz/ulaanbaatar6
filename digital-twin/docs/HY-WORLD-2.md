# Tencent HY-World 2.0: research and workflow

Researched 2026-11-13 from the official repository (github.com/Tencent-Hunyuan/HY-World-2.0),
its DOCUMENTATION.md and License.txt, and the Hugging Face model card (tencent/HY-World-2.0).
**Not run**: the build machine has no GPU and cannot reach huggingface.co.

## What it is

A multi-modal "world model" with two halves:

* **World Reconstruction** (WorldMirror 2.0, about 1.2B parameters): multi-view images or a video
  in, one forward pass predicts depth, surface normals, camera parameters, a coloured point cloud
  and 3D Gaussian Splatting (3DGS) attributes. Weights released 2026-04-16.
* **World Generation** (text or a single image in): HY-Pano 2.0 (panorama, about 80B, or a 425M
  Qwen LoRA variant), WorldNav (trajectory), WorldStereo 2.0 (about 17B, expands into 3D), then
  WorldMirror 2.0 for 3DGS. Released 2026-05-11 / 2026-05-18.

For a digital twin only **World Reconstruction** is acceptable: World Generation invents
unseen content, which our rules forbid presenting as real.

## Outputs (WorldMirror 2.0)

`gaussians.ply` (3DGS), `points.ply` (coloured point cloud), `depth/*.npy` + PNG, `normal/*.png`,
`camera_params.json` (extrinsics relative to the first view, intrinsics in pixels), optional COLMAP
`sparse/0/*.bin`, optional fly-through MP4. No GLB export is documented; meshes for Blender, Unity,
Unreal or Isaac are mentioned without a file format.

Important: the documentation does not claim **metric scale** or **georeferencing**. Camera poses
are relative to the first frame. Every result must therefore be scaled and placed using real
reference points before it can be shown on the map.

## Requirements

* CUDA 12.8, Python 3.11+, PyTorch (version not pinned), a custom gsplat build, FlashAttention 2
  or 3 (3 recommended on Hopper GPUs).
* VRAM: not stated officially. A third-party hosting guide (docs.clore.ai) lists 12 to 24 GB for
  WorldMirror 2.0 on one GPU (16 GB minimum, 24 to 80 GB recommended), 32 to 64 GB RAM and 80 GB
  disk. Treat as unverified.
* Inputs: video 1 to 32 frames by default (1 fps sampling), images resized to 952 px on the long
  edge; multi-GPU needs at least as many images as GPUs.
* Gradio app: `python -m hyworld2.worldrecon.gradio_app` (port 8081).

## Licence (Tencent HY-World 2.0 Community License)

* Territory excludes the **European Union, United Kingdom and South Korea**. Mongolia is inside
  the territory.
* Royalty-free, commercial use allowed, but products with more than **1 million monthly active
  users** must request a separate licence from Tencent.
* Outputs may not be used to improve other AI models; Tencent claims no rights in outputs.
* Distribution needs a copy of the licence, a NOTICE file, change notices, and a statement that
  Tencent does not endorse the service. Acceptable Use Policy applies (no military use, machine
  generated public content must be identified as such).

## Workflow for ULAANBAATAR 3D (planned, not yet executed)

1. **Pick a site** with clear public access, e.g. Sukhbaatar Square, Gandan Monastery forecourt,
   Peace Avenue at the State Department Store.
2. **Capture** our own photos/video (rights cleared): 30 to 200 overlapping photos or a slow
   walk-around video, plus 4+ ground control points measured with phone GNSS or taken from
   surveyed features in the footprint data (building corners).
3. **Run WorldMirror 2.0** on a rented GPU (24 GB+, for example an L4 / A10 / 4090 class card):
   `python -m hyworld2.worldrecon.pipeline --input_path photos --output_path out --save_colmap`.
4. **Georeference**: solve a similarity transform (scale, rotation, translation) from the
   ground control points to WGS84/ENU; reject the run if residuals exceed 0.5 m.
5. **Verify**: overlay on the building footprints and satellite imagery, compare rendered views
   against held-out photos (PSNR/SSIM plus a manual check). Mark anything hallucinated or blurred.
6. **Convert**: 3DGS `.ply` to Gaussian-splat 3D Tiles (recent CesiumJS releases load splat
   tiles; check the exact extension support of the pinned Cesium version first), or the point
   cloud to `.pnts` / glTF.
7. **Publish**: add an entry to `web/public/data/reconstructions.json` with status `verified`,
   the capture date, the photo source, the residual error and the licence; the viewer's
   "3D сэргээлт" mode lists it and flies to it.

What it cannot do: reconstruct the whole city in one pass (single scenes only, up to tens of
metres to a few hundred metres), produce correct geometry for areas not seen in the photos, or
replace GIS data as the source of truth.
