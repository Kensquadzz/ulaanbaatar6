# Asset production tracker

Every art asset moves through the same gates. Higgsfield output never decides where a road or
building is (the map data does).

Update 2026-11-13 (owner's request): 3D models from the owner's Higgsfield 3D Jutsu project ARE now
imported into the iPhone prototype as runtime assets. See `higgsfield/README.md` for what is used,
what is stylised, and the licence question that must be settled before a store release.

    reference -> model -> blender_cleanup -> uv_pbr -> rig -> ue_import -> optimised -> qa_passed

`asset_manifest.csv` is the single list. Columns:

- `id`, `name`, `category` (character / vehicle / horse / building / prop / material / cinematic)
- `priority` (P1 = needed for the Sukhbaatar Square to Zaisan slice)
- `stage` (one of the gates above, or `not_started`)
- `reference_sources` (photo credit, Higgsfield job id, dataset)
- `license` (who owns it, what terms; "original" for in-house work)
- `version`, `ue_path`, `tri_budget`, `texture_budget`, `notes`

Mobile budgets in the file are starting targets for MEDIUM and must be confirmed by
profiling. `python assets/validate_manifest.py` checks the file.
