"""Build the website data for the extra sectors, with the same harmonization as Southeast Asia.

Reads the caches written by pull_countries.py and writes, per sector,
web/public/data/sectors/<id>/{meta,daily,grid}.json, plus web/public/data/sectors.json, the index
the website uses to list every sector (Southeast Asia first, as the detailed default).

Usage:
    python pipeline/build_sector.py --cache <folder> [--sectors australia,brazil]
"""
import argparse
import glob
import json
import math
import os
import re
import sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_dataset as bd  # noqa: E402
from sectors import SECTORS  # noqa: E402

DATA = os.path.join(os.path.dirname(HERE), "web", "public", "data")

SEA_ENTRY = {
    "id": "sea",
    "name": "Southeast Asia: Malaysia, Sumatra and Borneo",
    "short": "Southeast Asia",
    "group": "Asia",
    "path": "data/",
    "detailed": True,
    "box": bd.BOX,
    "story": "Peat and land-clearing fires whose haze reaches Malaysia and Singapore. The detailed sector, with sub-regions, detection matching and demo days.",
}


def slug(s):
    return re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_")


def load(cache, sid):
    frames = []
    for path in sorted(glob.glob(os.path.join(cache, sid, "*_*.csv"))):
        sensor = os.path.basename(path).split("_")[0]
        df = pd.read_csv(path)
        df["sensor"] = sensor
        frames.append(df)
    if not frames:
        return None
    return pd.concat(frames, ignore_index=True)


def write_index(built):
    entries = [SEA_ENTRY]
    for sid, sec in SECTORS.items():
        if sid not in built:
            continue
        entries.append({
            "id": sid, "name": sec["name"], "short": sec["short"], "group": sec["group"],
            "path": f"data/sectors/{sid}/", "detailed": False, "box": sec["box"], "story": sec["story"],
            "countries": [c[1] for c in sec["countries"]],
        })
    with open(os.path.join(DATA, "sectors.json"), "w") as f:
        json.dump({"sectors": entries}, f, separators=(",", ":"))
    print("index:", [e["id"] for e in entries])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    ap.add_argument("--sectors", default=",".join(SECTORS))
    args = ap.parse_args()
    for sid in args.sectors.split(","):
        sec = SECTORS[sid]
        df = load(args.cache, sid)
        if df is None:
            print(f"{sid}: no cache yet, skipped")
            continue
        w, s, e, n = sec["box"]
        cell = sec["cell"]
        regions = {slug(disp): (disp, colour, None) for _, disp, colour in sec["countries"]}
        multi = len(regions) > 1
        cfg = {
            "box": sec["box"], "cell": cell,
            "nx": math.ceil(round((e - w) / cell, 6)), "ny": math.ceil(round((n - s) / cell, 6)),
            "regions": regions,
            "all_name": f"All of {sec['short']}" if multi else sec["name"],
            "out": os.path.join(DATA, "sectors", sid),
            "sector": {"id": sid, "name": sec["name"], "detailed": False, "story": sec["story"]},
        }
        print(f"=== {sid}: {len(df):,} cache rows, sensors {sorted(df.sensor.unique())}", flush=True)
        bd.build(df, cfg)
    # the index lists every sector that has been built so far
    built = {sid for sid in SECTORS if os.path.exists(os.path.join(DATA, "sectors", sid, "meta.json"))}
    write_index(built)


if __name__ == "__main__":
    main()
