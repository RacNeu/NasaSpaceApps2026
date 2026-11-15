"""Bring every sector's record up to yesterday with NOAA-20 VIIRS, the record's reference sensor.

The yearly country files behind the archive are published only after a year ends, so the current
year comes from the FIRMS area API instead: standard-processing data (VIIRS_NOAA20_SP) where it
exists, near-real-time data (VIIRS_NOAA20_NRT) after that. The output has the same format as the
archive caches, so build_dataset.py and build_sector.py simply see one more year.

Two details keep the new year consistent with the archive:
* Static heat sources. Standard data carries FIRMS's `type` column and only vegetation fires
  (type 0) are kept, as in the archive. Near-real-time data has no `type`, so detections there
  are dropped when they fall in a 0.05 degree cell that standard data flagged as a static source.
* Countries. The archive's country sectors come from per-country files. Here each detection is
  given its country from web/public/data/countrygrid.json (Natural Earth, 0.5 degree), and
  detections outside the sector's countries are dropped.

Usage (the key is read from the environment and never written anywhere):
    FIRMS_MAP_KEY=... python pipeline/pull_recent.py --sea-cache <dir> --sector-cache <dir>
"""
import argparse, csv, datetime as dt, io, json, os, sys, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import pull_firms as pf  # noqa: E402  (shared throttle on the key's transaction counter)
from sectors import SECTORS  # noqa: E402

GRID = os.path.join(os.path.dirname(HERE), "web", "public", "data", "countrygrid.json")
SEA = {"box": list(pf.BBOX), "cell": pf.CELL, "countries": None}


def load_country_grid():
    g = json.load(open(GRID, encoding="utf-8"))
    w, cell = g["width"], g["cell"]
    rows = []
    for r in g["rows"]:
        row = []
        for i in range(0, len(r), 2):
            row.extend([r[i]] * r[i + 1])
        rows.append(row)

    def at(lon, lat):
        x = min(w - 1, max(0, int((lon + 180) // cell)))
        y = min(g["height"] - 1, max(0, int((lat + 90) // cell)))
        v = rows[y][x]
        return g["names"][v] if v >= 0 else None

    return at


def availability(key):
    url = f"https://firms.modaps.eosdis.nasa.gov/api/data_availability/csv/{key}/all"
    with urllib.request.urlopen(url, timeout=60) as r:
        rows = list(csv.DictReader(io.StringIO(r.read().decode())))
    return {row["data_id"]: (dt.date.fromisoformat(row["min_date"]), dt.date.fromisoformat(row["max_date"])) for row in rows}


def fetch(key, source, box, start, days):
    url = f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{','.join(str(v) for v in box)}/{days}/{start}"
    last = None
    for attempt in range(5):
        pf.LIMITER.acquire(days)
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                text = r.read().decode("utf-8", "replace")
            if text.startswith("latitude"):
                return text
            last = text[:100].replace(key, "[key]")
        except Exception as e:
            last = repr(e).replace(key, "[key]")
        import time
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"giving up on {source} {start}: {last}")


def process(key, avail, country_at, sid, sec, cache, year, force):
    out = os.path.join(cache, *([sid] if sid != "sea" else []), f"noaa20_{year}.csv")
    if os.path.exists(out) and not force:
        return sid, "cached", 0
    os.makedirs(os.path.dirname(out), exist_ok=True)
    w, s, e, n = sec["box"]
    cell = sec["cell"]
    names = [c[1] for c in sec["countries"]] if sec["countries"] else None
    sp_end = avail["VIIRS_NOAA20_SP"][1]
    start = dt.date(year, 1, 1)
    end = min(dt.date(year, 12, 31), avail["VIIRS_NOAA20_NRT"][1])
    static = set()
    agg = defaultdict(lambda: [0, 0, 0.0])
    total = 0
    # standard data first, so its static-source flags are known before the near-real-time part
    windows = []
    d = start
    while d <= end:
        src = "VIIRS_NOAA20_SP" if d <= sp_end else "VIIRS_NOAA20_NRT"
        lim = sp_end if src.endswith("SP") else end
        days = min(5, (min(lim, end) - d).days + 1)
        windows.append((src, d, days))
        d += dt.timedelta(days=days)
    for src, d, days in windows:
        text = fetch(key, src, sec["box"], d.isoformat(), days)
        for row in csv.DictReader(io.StringIO(text)):
            try:
                lat, lon, frp = float(row["latitude"]), float(row["longitude"]), float(row["frp"])
            except (ValueError, KeyError):
                continue
            sc = (round(lon / 0.05), round(lat / 0.05))
            t = row.get("type")
            if t not in (None, ""):
                if t != "0":
                    static.add(sc)
                    continue
            elif sc in static:
                continue
            if not (w <= lon <= e and s <= lat <= n):
                continue
            region = 0
            if names:
                c = country_at(lon, lat)
                if c not in names:
                    continue
                region = names.index(c)
            cx, cy = int((lon - w) // cell), int((lat - s) // cell)
            a = agg[(row["acq_date"], cx, cy, region)]
            if pf.quality("noaa20", row["confidence"]):
                a[0] += 1
                a[2] += frp
            else:
                a[1] += 1
            total += 1
    tmp = out + ".tmp"
    with open(tmp, "w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["date", "cx", "cy"] + (["region"] if names else []) + ["n_quality", "n_low", "frp_quality"])
        for (date, cx, cy, ri), (nq, nl, fr) in sorted(agg.items()):
            wr.writerow([date, cx, cy] + ([ri] if names else []) + [nq, nl, round(fr, 2)])
    os.replace(tmp, out)
    return sid, f"done to {end} ({len(static)} static cells)", total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sea-cache", required=True)
    ap.add_argument("--sector-cache", required=True)
    ap.add_argument("--year", type=int, default=dt.date.today().year)
    ap.add_argument("--sectors", default="sea," + ",".join(SECTORS))
    ap.add_argument("--force", action="store_true", help="re-pull even if the year is cached (to refresh it)")
    args = ap.parse_args()
    key = os.environ.get("FIRMS_MAP_KEY")
    if not key:
        sys.exit("Set the FIRMS_MAP_KEY environment variable first.")
    pf.LIMITER.key = key
    avail = availability(key)
    print("NOAA-20 standard data to", avail["VIIRS_NOAA20_SP"][1], "| near-real-time to", avail["VIIRS_NOAA20_NRT"][1], flush=True)
    country_at = load_country_grid()
    jobs = []
    for sid in args.sectors.split(","):
        sec = SEA if sid == "sea" else SECTORS[sid]
        cache = args.sea_cache if sid == "sea" else args.sector_cache
        jobs.append((sid, sec, cache))
    with ThreadPoolExecutor(max_workers=3) as ex:
        futs = {ex.submit(process, key, avail, country_at, sid, sec, cache, args.year, args.force): sid for sid, sec, cache in jobs}
        for fut in as_completed(futs):
            try:
                sid, status, n = fut.result()
                print(f"{sid}: {status}, {n:,} detections", flush=True)
            except Exception as e:
                print(f"FAILED {futs[fut]}: {e}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
