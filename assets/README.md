# Asset production tracker

Every art asset moves through the same gates. Higgsfield output is **reference only**: it
is never imported as a game asset and never decides where a road or building is (the map
data does).

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
