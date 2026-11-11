"""Download the slice bbox from Overture Maps (open data on public S3).

Only the rows inside SLICE_BBOX are read; nothing is scraped from Google.
Usage: python -m ub6pipeline.fetch_overture <out_dir> [theme ...]
"""
import os
import sys
from urllib.parse import urlparse

import pyarrow.dataset as ds
import pyarrow.fs as fs
import pyarrow.parquet as pq

from . import config


def _filesystem():
    kwargs = {"anonymous": True, "region": "us-west-2"}
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if proxy:
        p = urlparse(proxy)
        kwargs["proxy_options"] = {"scheme": p.scheme, "host": p.hostname, "port": p.port}
    ca = os.environ.get("AWS_CA_BUNDLE") or os.environ.get("SSL_CERT_FILE")
    if ca:
        kwargs["tls_ca_file_path"] = ca
    return fs.S3FileSystem(**kwargs)


def fetch(theme_key: str, out_dir: str, bbox=config.SLICE_BBOX) -> str:
    w, s, e, n = bbox
    path = f"{config.OVERTURE_BUCKET}/release/{config.OVERTURE_RELEASE}/{config.OVERTURE_THEMES[theme_key]}/"
    dataset = ds.dataset(path, filesystem=_filesystem(), format="parquet")
    f = ds.field
    flt = ((f("bbox", "xmax") >= w) & (f("bbox", "xmin") <= e)
           & (f("bbox", "ymax") >= s) & (f("bbox", "ymin") <= n))
    table = dataset.to_table(filter=flt)
    os.makedirs(out_dir, exist_ok=True)
    out = os.path.join(out_dir, f"{theme_key}.parquet")
    pq.write_table(table, out)
    print(f"{theme_key}: {table.num_rows} rows -> {out}", flush=True)
    return out


if __name__ == "__main__":
    out_dir = sys.argv[1]
    for key in (sys.argv[2:] or list(config.OVERTURE_THEMES)):
        fetch(key, out_dir)
