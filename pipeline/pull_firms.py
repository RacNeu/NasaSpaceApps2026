"""Pull NASA FIRMS archive detections and aggregate them to a 0.5-degree daily grid.

Study box: Sumatra + Kalimantan + Peninsular Malaysia (95E-120E, 6S-8N).
Raw detections are streamed and aggregated immediately, so only small per-sensor-year
cache files are written (pipeline/cache/*.csv). The MAP_KEY is read from the
FIRMS_MAP_KEY environment variable and is never written to disk.

Usage:
    FIRMS_MAP_KEY=... python pipeline/pull_firms.py --years 2018-2025
    FIRMS_MAP_KEY=... python pipeline/pull_firms.py --years 2012-2017 --sensors modis,snpp

Resumable: a sensor-year whose cache file already exists is skipped.
"""
import argparse, csv, datetime as dt, io, os, sys, threading, time, urllib.request
from collections import deque, defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

BBOX = (95.0, -6.0, 120.0, 8.0)  # west, south, east, north
CELL = 0.5
SENSORS = {
    "modis": ("MODIS_SP", "MODIS_NRT"),
    "snpp": ("VIIRS_SNPP_SP", "VIIRS_SNPP_NRT"),
    "noaa20": ("VIIRS_NOAA20_SP", "VIIRS_NOAA20_NRT"),
}
# Earliest archive date per sensor (NOAA-20 data starts in 2018, SNPP in 2012).
FIRST_YEAR = {"modis": 2000, "snpp": 2012, "noaa20": 2018}
CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "cache")
MAX_TRANSACTIONS = 4300  # FIRMS allows 5000 per 10 minutes; keep a margin.
WINDOW_S = 600


class Limiter:
    """Throttle on the server's own transaction counter (the true limit), not a local guess.

    FIRMS counts more transactions than days requested, so a purely local estimate overshoots
    the 5000-per-10-minutes limit. Before each request we read the key status and wait until
    there is headroom.
    """

    def __init__(self):
        self.lock = threading.Lock()
        self.key = None
        self.checked = 0.0
        self.used = 0

    def _status(self):
        url = f"https://firms.modaps.eosdis.nasa.gov/mapserver/mapkey_status/?MAP_KEY={self.key}"
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                txt = r.read().decode()
            self.used = int(txt.split('"current_transactions"')[1].split(":")[1].split(",")[0])
        except Exception:
            self.used = MAX_TRANSACTIONS  # unknown: be cautious and wait
        self.checked = time.time()

    def acquire(self, n):
        while True:
            with self.lock:
                if time.time() - self.checked > 3:
                    self._status()
                if self.used + 12 * n <= MAX_TRANSACTIONS:
                    self.used += 12 * n  # pessimistic local bump until the next status read
                    return
            time.sleep(8)


LIMITER = Limiter()


def fetch(key, source, start, days):
    url = (f"https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/"
           f"{','.join(str(v) for v in BBOX)}/{days}/{start}")
    last = None
    for attempt in range(5):
        LIMITER.acquire(days)
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return r.read().decode("utf-8", "replace")
        except Exception as e:  # network or HTTP hiccup: back off and retry
            last = e
            time.sleep(4 * (attempt + 1))
    raise RuntimeError(f"giving up on {source} {start}: {last!r}")


def keep(row):
    """Vegetation-fire detections only (FIRMS type 0); missing type means keep."""
    t = row.get("type")
    return t in (None, "", "0")


def quality(sensor, conf):
    """True if the detection is not flagged low confidence."""
    if sensor == "modis":
        try:
            return float(conf) >= 30
        except ValueError:
            return False
    return conf in ("n", "h", "nominal", "high")


def process_year(key, sensor, year):
    out_path = os.path.join(CACHE, f"{sensor}_{year}.csv")
    if os.path.exists(out_path):
        return sensor, year, "cached", 0
    sp, nrt = SENSORS[sensor]
    agg = defaultdict(lambda: [0, 0, 0.0])  # (date,cx,cy) -> [n_quality, n_low, frp_quality]
    start = dt.date(year, 1, 1)
    end = min(dt.date(year, 12, 31), dt.date.today() - dt.timedelta(days=1))
    d, total = start, 0
    while d <= end:
        days = min(5, (end - d).days + 1)
        text = fetch(key, sp, d.isoformat(), days)
        if not text.startswith("latitude"):
            # Standard-processing archive may lag; fall back to near-real-time.
            text = fetch(key, nrt, d.isoformat(), days)
        if text.startswith("latitude"):
            for row in csv.DictReader(io.StringIO(text)):
                if not keep(row):
                    continue
                try:
                    lat, lon = float(row["latitude"]), float(row["longitude"])
                    frp = float(row["frp"])
                except (ValueError, KeyError):
                    continue
                cx = int((lon - BBOX[0]) // CELL)
                cy = int((lat - BBOX[1]) // CELL)
                cell = agg[(row["acq_date"], cx, cy)]
                if quality(sensor, row["confidence"]):
                    cell[0] += 1
                    cell[2] += frp
                else:
                    cell[1] += 1
                total += 1
        else:
            print(f"  [{sensor} {d}] unexpected response: {text[:100]!r}", file=sys.stderr)
        d += dt.timedelta(days=days)
    tmp = out_path + ".tmp"
    with open(tmp, "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["date", "cx", "cy", "n_quality", "n_low", "frp_quality"])
        for (date, cx, cy), (nq, nl, fr) in sorted(agg.items()):
            w.writerow([date, cx, cy, nq, nl, round(fr, 2)])
    os.replace(tmp, out_path)
    return sensor, year, "done", total


def parse_years(s):
    a, _, b = s.partition("-")
    return list(range(int(a), int(b or a) + 1))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", default="2018-2025")
    ap.add_argument("--sensors", default="modis,snpp,noaa20")
    ap.add_argument("--workers", type=int, default=3)
    args = ap.parse_args()
    key = os.environ.get("FIRMS_MAP_KEY")
    if not key:
        sys.exit("Set the FIRMS_MAP_KEY environment variable first.")
    os.makedirs(CACHE, exist_ok=True)
    LIMITER.key = key
    tasks = [(s, y) for y in parse_years(args.years) for s in args.sensors.split(",")
             if y >= FIRST_YEAR[s]]
    print(f"{len(tasks)} sensor-years to process", flush=True)
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(process_year, key, s, y): (s, y) for s, y in tasks}
        for fut in as_completed(futs):
            try:
                s, y, status, n = fut.result()
                print(f"{s} {y}: {status} ({n} detections)", flush=True)
            except Exception as e:
                print(f"FAILED {futs[fut]}: {e}", file=sys.stderr, flush=True)


if __name__ == "__main__":
    main()
