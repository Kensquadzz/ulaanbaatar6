# Geographic data

Everything here is real open data for the Sukhbaatar Square to Zaisan slice. Nothing is
invented; values the sources lack are flagged inside the files (`height_src`, `width_src`).

| Path | Contents | Size |
|---|---|---|
| `raw/*.parquet` | Unmodified Overture Maps extracts (release 2026-10-21.0) for bbox 106.885,47.872 to 106.950,47.930: road segments, buildings, water, land use, places | 7 MB |
| `raw/terrain/*.png` | AWS Terrain Tiles (terrarium encoding), zoom 13 | 0.4 MB |
| `tiles/manifest.json` | Chunk index, statistics, attribution | |
| `tiles/chunks/*.json` | 520 streaming chunks of 256 m | 13 MB |
| `tiles/nav/roadgraph.txt` | GPS routing graph (11,883 nodes, 15,858 edges) | 1.9 MB |
| `tiles/landmarks.json` | Key landmarks located in the source data | |

`raw/` is committed so the tiles can be rebuilt even if the upstream release is retired:
`python -m ub6pipeline.build_tiles ../data/raw ../data/tiles` from `pipeline/`.

Licences: Overture Maps (includes OpenStreetMap, ODbL; CDLA-Permissive-2.0) and AWS Terrain
Tiles. Attribution is required in the game credits (see `tiles/manifest.json`).
No file is large enough to need Git LFS (largest: 4 MB).
