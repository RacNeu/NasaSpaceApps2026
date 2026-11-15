"""Country and province outlines for every sector, so the globe can select them with a click.

Source: Natural Earth 1:10m admin-1 states and provinces (public domain). For each sector this keeps
the provinces of the sector's countries that touch its box, simplifies them so the website stays
light, dissolves them into whole countries, and lists which of the sector's grid cells fall inside
each outline (by cell centre). An outline too small to hold a cell centre takes the cells it
overlaps most, and is flagged as approximate.

Writes web/public/data/[sectors/<id>/]boundaries.json.

Usage:
    python pipeline/build_boundaries.py --ne <ne_10m_admin_1_states_provinces.geojson>
"""
import argparse, json, os

from shapely.geometry import box as sbox, mapping, shape
from shapely.ops import unary_union
from shapely.prepared import prep

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "web", "public", "data")

# Natural Earth country names per sector, and how to label them
SECTORS = {
    "sea": ["Indonesia", "Malaysia", "Brunei", "Singapore"],
    "mainland_sea": ["Thailand", "Myanmar", "Laos", "Cambodia", "Vietnam"],
    "australia": ["Australia"],
    "brazil": ["Brazil"],
    "united_states": ["United States of America"],
    "canada": ["Canada"],
}
COUNTRY_LABEL = {"United States of America": "United States"}
# tiny city-states are one unit, not their districts
WHOLE = {"Singapore", "Brunei"}


def rounded(geom, nd=3):
    def r(c):
        if isinstance(c[0], (int, float)):
            return [round(c[0], nd), round(c[1], nd)]
        return [r(x) for x in c]
    g = mapping(geom)
    return {"type": g["type"], "coordinates": r(g["coordinates"])}


def cells_for(geom, cells, box, cell):
    pg = prep(geom)
    inside = []
    for ci, (cx, cy, _) in enumerate(cells):
        lon = box[0] + (cx + 0.5) * cell
        lat = box[1] + (cy + 0.5) * cell
        if pg.contains(shape({"type": "Point", "coordinates": (lon, lat)})):
            inside.append(ci)
    if inside:
        return inside, False
    # too small for any cell centre: take the cells it overlaps, largest overlap first
    over = []
    for ci, (cx, cy, _) in enumerate(cells):
        sq = sbox(box[0] + cx * cell, box[1] + cy * cell, box[0] + (cx + 1) * cell, box[1] + (cy + 1) * cell)
        if pg.intersects(sq):
            a = geom.intersection(sq).area
            if a > 0:
                over.append((a, ci))
    over.sort(reverse=True)
    return [ci for _, ci in over[:2]], True


def build(sid, path, ne):
    meta = json.load(open(os.path.join(path, "meta.json")))
    grid = json.load(open(os.path.join(path, "grid.json")))
    box, cell, cells = meta["box"], meta["cell"], grid["cells"]
    area = sbox(*box)
    big = cell >= 1
    tol_p, tol_c = (0.04, 0.08) if big else (0.015, 0.03)

    provinces = []
    by_country = {}
    for f in ne["features"]:
        p = f["properties"]
        if p["admin"] not in SECTORS[sid]:
            continue
        g = shape(f["geometry"]).buffer(0)
        if not g.intersects(area):
            continue
        g = g.intersection(area.buffer(0.5))
        by_country.setdefault(p["admin"], []).append(g)
        if p["admin"] in WHOLE:
            continue
        provinces.append((p.get("name_en") or p["name"], COUNTRY_LABEL.get(p["admin"], p["admin"]), g))

    def feature(fid, name, country, geom, tol):
        cs, approx = cells_for(geom, cells, box, cell)
        simple = geom.simplify(tol, preserve_topology=True)
        if simple.is_empty:
            simple = geom
        minx, miny, maxx, maxy = geom.bounds
        return {
            "type": "Feature",
            "properties": {"id": fid, "name": name, "country": country, "n": len(cs), "approx": approx,
                           "bbox": [round(minx, 2), round(miny, 2), round(maxx, 2), round(maxy, 2)]},
            "geometry": rounded(simple),
        }, cs

    out = {"source": "Natural Earth 1:10m admin-1 states and provinces", "levels": {}, "cells": {}}
    countries = []
    for admin, geoms in by_country.items():
        name = COUNTRY_LABEL.get(admin, admin)
        f, cs = feature(f"c:{name}", name, name, unary_union(geoms), tol_c)
        countries.append(f)
        out["cells"][f"c:{name}"] = cs
    provs = []
    for name, country, g in provinces:
        fid = f"p:{country}:{name}"
        f, cs = feature(fid, name, country, g, tol_p)
        if cs:
            provs.append(f)
            out["cells"][fid] = cs
    out["levels"]["country"] = {"type": "FeatureCollection", "features": countries}
    out["levels"]["province"] = {"type": "FeatureCollection", "features": provs}
    with open(os.path.join(path, "boundaries.json"), "w", encoding="utf-8") as fh:
        json.dump(out, fh, separators=(",", ":"), ensure_ascii=False)
    size = os.path.getsize(os.path.join(path, "boundaries.json")) / 1e3
    approx = sum(1 for f in provs if f["properties"]["approx"])
    print(f"{sid}: {len(countries)} countries, {len(provs)} provinces ({approx} approximate), {size:.0f} KB", flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ne", required=True)
    args = ap.parse_args()
    ne = json.load(open(args.ne, encoding="utf-8"))
    for sid in SECTORS:
        path = DATA if sid == "sea" else os.path.join(DATA, "sectors", sid)
        if os.path.exists(os.path.join(path, "grid.json")):
            build(sid, path, ne)


if __name__ == "__main__":
    main()
