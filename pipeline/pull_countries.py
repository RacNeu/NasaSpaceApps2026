"""Download FIRMS yearly country files for the extra sectors and aggregate them to a daily grid.

No MAP_KEY is needed: these are public bulk files. Each file is streamed and aggregated line by
line, so even the largest (over 100 MB) never sits on disk. Output per sector, sensor and year:
<cache>/<sector>/<sensor>_<year>.csv with columns date,cx,cy,region,n_quality,n_low,frp_quality,
where region is the country's index in the sector definition.

Usage:
    python pipeline/pull_countries.py --cache <folder> [--sectors australia,brazil] [--workers 4]

Resumable: a sector-sensor-year already in the cache is skipped.
"""
import argparse
import csv
import io
import os
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from sectors import SECTORS, SENSOR_FOLDERS  # noqa: E402

BASE = "https://firms.modaps.eosdis.nasa.gov/data/country"


def quality(sensor, conf):
    if sensor == "modis":
        try:
            return float(conf) >= 30
        except ValueError:
            return False
    return conf in ("n", "h", "nominal", "high")


def stream_rows(url):
    """Yields CSV rows from a remote file, or nothing if the file does not exist."""
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=180) as r:
                text = io.TextIOWrapper(r, encoding="utf-8", newline="")
                yield from csv.DictReader(text)
            return
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return  # that country has no file for that year
            err = e
        except Exception as e:  # network hiccup: back off and retry
            err = e
        time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"giving up on {url}: {err!r}")


def process(cache, sector_id, sensor, year):
    sec = SECTORS[sector_id]
    out_dir = os.path.join(cache, sector_id)
    out_path = os.path.join(out_dir, f"{sensor}_{year}.csv")
    if os.path.exists(out_path):
        return sector_id, sensor, year, "cached", 0
    folder = SENSOR_FOLDERS[sensor][0]
    w, s, e, n = sec["box"]
    cell = sec["cell"]
    agg = defaultdict(lambda: [0, 0, 0.0])
    total = 0
    for ri, (fname, _, _) in enumerate(sec["countries"]):
        url = f"{BASE}/{folder}/{year}/{folder}_{year}_{fname}.csv"
        for row in stream_rows(url):
            if row.get("type", "0") not in ("0", ""):
                continue  # volcanoes, static industrial sources, offshore
            try:
                lat, lon = float(row["latitude"]), float(row["longitude"])
                frp = float(row["frp"])
            except (KeyError, ValueError):
                continue
            if not (w <= lon < e and s <= lat < n):
                continue
            cx = int((lon - w) // cell)
            cy = int((lat - s) // cell)
            a = agg[(row["acq_date"], cx, cy, ri)]
            if quality(sensor, row["confidence"]):
                a[0] += 1
                a[2] += frp
            else:
                a[1] += 1
            total += 1
    os.makedirs(out_dir, exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w", newline="") as f:
        wr = csv.writer(f)
        wr.writerow(["date", "cx", "cy", "region", "n_quality", "n_low", "frp_quality"])
        for (d, cx, cy, ri), (nq, nl, fr) in sorted(agg.items()):
            wr.writerow([d, cx, cy, ri, nq, nl, round(fr, 2)])
    os.replace(tmp, out_path)
    return sector_id, sensor, year, "done", total


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--cache", required=True, help="folder for the aggregated cache (kept out of git)")
    ap.add_argument("--sectors", default=",".join(SECTORS))
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()
    # reference scale first, then the long MODIS record, then Suomi NPP (largest, least essential)
    order = {"noaa20": 0, "modis": 1, "snpp": 2}
    tasks = sorted(
        [(sid, sensor, y) for sid in args.sectors.split(",") for sensor, (_, years) in SENSOR_FOLDERS.items() for y in years],
        key=lambda t: (order[t[1]], -t[2]),
    )
    print(f"{len(tasks)} sector-sensor-years to process", flush=True)
    t0 = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(process, args.cache, *t): t for t in tasks}
        for fut in as_completed(futs):
            try:
                sid, sensor, y, status, n = fut.result()
                print(f"[{time.time() - t0:6.0f}s] {sid} {sensor} {y}: {status} ({n} detections)", flush=True)
            except Exception as e:
                print(f"FAILED {futs[fut]}: {e}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
