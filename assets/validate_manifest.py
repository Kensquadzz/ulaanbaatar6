"""Checks assets/asset_manifest.csv: unique ids, known categories/stages, licence present."""
import csv
import os
import sys

STAGES = ["not_started", "reference", "model", "blender_cleanup", "uv_pbr", "rig", "ue_import", "optimised", "qa_passed"]
CATEGORIES = {"character", "vehicle", "horse", "building", "prop", "material", "cinematic"}


def validate(path):
    errors, seen = [], set()
    with open(path, newline="", encoding="utf-8") as f:
        for n, row in enumerate(csv.DictReader(f), start=2):
            if row["id"] in seen:
                errors.append(f"line {n}: duplicate id {row['id']}")
            seen.add(row["id"])
            if row["category"] not in CATEGORIES:
                errors.append(f"line {n}: unknown category {row['category']}")
            if row["stage"] not in STAGES:
                errors.append(f"line {n}: unknown stage {row['stage']}")
            if row["priority"] not in ("P1", "P2", "P3"):
                errors.append(f"line {n}: bad priority {row['priority']}")
            if not row["license"]:
                errors.append(f"line {n}: licence missing")
            if STAGES.index(row["stage"]) >= STAGES.index("ue_import") and not row["ue_path"] if row["stage"] in STAGES else False:
                errors.append(f"line {n}: stage {row['stage']} needs ue_path")
            if row["stage"] != "not_started" and not row["reference_sources"]:
                errors.append(f"line {n}: reference_sources missing for a started asset")
    return errors


if __name__ == "__main__":
    errs = validate(os.path.join(os.path.dirname(os.path.abspath(__file__)), "asset_manifest.csv"))
    print("\n".join(errs) if errs else "asset manifest ok")
    sys.exit(1 if errs else 0)
