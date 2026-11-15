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
from sectors import SECTORS, SUBREGIONS  # noqa: E402

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


def plain(name):
    import unicodedata
    return unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower().strip()


def subregion_cells(sid, sec, df, ne_path):
    """Give every grid cell the group of states its centre falls in (or the nearest one, for coasts)."""
    from shapely.geometry import Point, shape
    from shapely.ops import unary_union
    spec = SUBREGIONS[sid]
    ne = json.load(open(ne_path, encoding="utf-8"))
    by_name = {plain(f["properties"]["name"]): shape(f["geometry"]).buffer(0) for f in ne["features"] if f["properties"]["admin"] == spec["admin"]}
    groups = []
    used = set()
    for name, colour, states in spec["groups"]:
        geoms = []
        for st in states:
            k = plain(st)
            if k not in by_name:
                print(f"  warning: no outline for {st}", flush=True)
                continue
            geoms.append(by_name[k])
            used.add(k)
        groups.append(unary_union(geoms))
    missing = sorted(set(by_name) - used)
    if missing:
        print(f"  warning: states in no group: {missing}", flush=True)
    w, s, _, _ = sec["box"]
    cell = sec["cell"]
    region = {}
    for cx, cy in df[["cx", "cy"]].drop_duplicates().itertuples(index=False):
        pt = Point(w + (cx + 0.5) * cell, s + (cy + 0.5) * cell)
        hit = next((g for g, geom in enumerate(groups) if geom.contains(pt)), None)
        if hit is None:
            hit = min(range(len(groups)), key=lambda g: groups[g].distance(pt))
        region[(cx, cy)] = hit
    df["region"] = [region[(a, b_)] for a, b_ in zip(df["cx"], df["cy"])]
    return {slug(name): (name, colour, None) for name, colour, _ in spec["groups"]}


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
    ap.add_argument("--ne", help="Natural Earth admin-1 GeoJSON, to split single countries into groups of states")
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
        if sid in SUBREGIONS and args.ne:
            regions = subregion_cells(sid, sec, df, args.ne)
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
