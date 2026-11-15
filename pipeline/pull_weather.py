"""Daily rainfall and wind for every forecast region, from NASA POWER (MERRA-2 / GEOS).

For each region the four grid cells with the most fire detections in the record stand in for the
region, weighted by how much each burns, so the rainfall is the rainfall where fires actually
happen. Wind at 50 m is kept for the haze outlook (which way smoke travels).

Writes <cache>/weather_<sector>.json with, per region, daily rainfall (mm) and the daily wind
direction and speed, from 2001 to the latest day POWER has. No key is needed.

Usage:
    python pipeline/pull_weather.py --cache ../NasaSpaceApps/pipeline/cache_weather
"""
import argparse, datetime as dt, json, math, os, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "web", "public", "data")
POINTS_PER_REGION = 4
URL = ("https://power.larc.nasa.gov/api/temporal/daily/point?parameters=PRECTOTCORR,WD50M,WS50M"
       "&community=AG&longitude={lon}&latitude={lat}&start=20010101&end={end}&format=JSON")


def fetch_point(cache, lon, lat, end):
    path = os.path.join(cache, f"pt_{lon:.2f}_{lat:.2f}_{end}.json")
    if os.path.exists(path):
        return json.load(open(path))
    for attempt in range(4):
        try:
            req = urllib.request.Request(URL.format(lon=lon, lat=lat, end=end), headers={"User-Agent": "ignis-pipeline"})
            with urllib.request.urlopen(req, timeout=120) as r:
                d = json.load(r)
            p = d["properties"]["parameter"]
            out = {k: p[k] for k in ("PRECTOTCORR", "WD50M", "WS50M")}
            json.dump(out, open(path, "w"))
            time.sleep(0.5)  # be gentle with the service
            return out
        except Exception as e:  # network hiccup: back off and retry
            err = e
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"POWER failed for {lon},{lat}: {err!r}")


def sector_points(path):
    meta = json.load(open(os.path.join(path, "meta.json")))
    grid = json.load(open(os.path.join(path, "grid.json")))
    tot = {}
    for row in grid["data"]:
        for k in range(0, len(row), 2):
            tot[row[k]] = tot.get(row[k], 0) + row[k + 1]
    regions = {}
    ids = [r["id"] for r in meta["regions"]]
    for ci, (cx, cy, ri) in enumerate(grid["cells"]):
        if ri < 0 or ri >= len(ids):
            continue
        lon = meta["box"][0] + (cx + 0.5) * meta["cell"]
        lat = meta["box"][1] + (cy + 0.5) * meta["cell"]
        regions.setdefault(ids[ri], []).append((tot.get(ci, 0), round(lon, 2), round(lat, 2)))
    picked = {rid: sorted(c, reverse=True)[:POINTS_PER_REGION] for rid, c in regions.items()}
    # the whole area: the busiest cells across all regions
    allc = sorted([c for cs in regions.values() for c in cs], reverse=True)[:POINTS_PER_REGION + 2]
    picked["study_area"] = allc
    return meta["start"], picked


def combine(series, weights):
    """Weighted daily mean rainfall and vector-mean wind over the points."""
    days = sorted(series[0]["PRECTOTCORR"])
    rain, wd, ws = [], [], []
    for d in days:
        r = [(s["PRECTOTCORR"][d], w) for s, w in zip(series, weights) if s["PRECTOTCORR"][d] > -900]
        rain.append(round(sum(v * w for v, w in r) / sum(w for _, w in r), 2) if r else None)
        u = v = n = 0.0
        for s, w in zip(series, weights):
            a, sp = s["WD50M"][d], s["WS50M"][d]
            if a > -900 and sp > -900:
                u += w * sp * math.sin(math.radians(a))
                v += w * sp * math.cos(math.radians(a))
                n += w
        if n:
            wd.append(round((math.degrees(math.atan2(u, v)) + 360) % 360))
            ws.append(round(math.hypot(u, v) / n, 1))
        else:
            wd.append(None)
            ws.append(None)
    return days, rain, wd, ws


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True)
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)
    end = (dt.date.today() - dt.timedelta(days=1)).strftime("%Y%m%d")
    paths = [("sea", DATA)] + [(d, os.path.join(DATA, "sectors", d)) for d in sorted(os.listdir(os.path.join(DATA, "sectors")))]
    for sid, path in paths:
        if not os.path.exists(os.path.join(path, "grid.json")):
            continue
        _, picked = sector_points(path)
        out = {"source": "NASA POWER daily (MERRA-2 / GEOS): PRECTOTCORR, WD50M, WS50M", "regions": {}}
        for rid, pts in picked.items():
            series = [fetch_point(args.cache, lon, lat, end) for _, lon, lat in pts]
            weights = [max(w, 1) for w, _, _ in pts]
            days, rain, wd, ws = combine(series, weights)
            out["regions"][rid] = {"points": [[lon, lat] for _, lon, lat in pts], "start": days[0], "rain": rain, "wd": wd, "ws": ws}
            valid = [d for d, r in zip(days, rain) if r is not None]
            print(f"{sid}/{rid}: {len(pts)} points, rain to {valid[-1]}", flush=True)
        json.dump(out, open(os.path.join(args.cache, f"weather_{sid}.json"), "w"), separators=(",", ":"))


if __name__ == "__main__":
    main()
