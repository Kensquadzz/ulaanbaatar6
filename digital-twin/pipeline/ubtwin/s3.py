"""Anonymous access to Overture Maps on public S3, through the HTTPS proxy when one is set."""
import os
from urllib.parse import urlparse

import pyarrow.dataset as ds
import pyarrow.fs as fs

OVERTURE_BUCKET = "overturemaps-us-west-2"
OVERTURE_RELEASE = os.environ.get("OVERTURE_RELEASE", "2026-10-21.0")


def filesystem():
    kwargs = {"anonymous": True, "region": "us-west-2"}
    proxy = os.environ.get("HTTPS_PROXY") or os.environ.get("https_proxy")
    if proxy:
        p = urlparse(proxy)
        kwargs["proxy_options"] = {"scheme": p.scheme, "host": p.hostname, "port": p.port}
    ca = os.environ.get("AWS_CA_BUNDLE") or os.environ.get("SSL_CERT_FILE")
    if ca:
        kwargs["tls_ca_file_path"] = ca
    return fs.S3FileSystem(**kwargs)


def dataset(theme: str, typ: str):
    path = f"{OVERTURE_BUCKET}/release/{OVERTURE_RELEASE}/theme={theme}/type={typ}/"
    return ds.dataset(path, filesystem=filesystem(), format="parquet")


def bbox_filter(bbox):
    w, s, e, n = bbox
    f = ds.field
    return ((f("bbox", "xmax") >= w) & (f("bbox", "xmin") <= e)
            & (f("bbox", "ymax") >= s) & (f("bbox", "ymin") <= n))
