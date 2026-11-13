"""Download raw (un-aggregated) detections for the two sample periods used by the matching analysis.

Writes data/{modis,noaa20}_{year}.csv for August to October of 2019 and 2023, inside the study box.
Then run:  python pipeline/match_sensors.py

The MAP_KEY is read from the FIRMS_MAP_KEY environment variable and never written to disk.
"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pull_firms as pf  # noqa: E402  (shares the throttled fetch helper)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data")
PERIODS = {2019: ("2019-08-01", "2019-10-31"), 2023: ("2023-08-01", "2023-10-31")}
SOURCES = {"modis": "MODIS_SP", "noaa20": "VIIRS_NOAA20_SP"}


def main():
    key = os.environ.get("FIRMS_MAP_KEY")
    if not key:
        sys.exit("Set the FIRMS_MAP_KEY environment variable first.")
    pf.LIMITER.key = key
    os.makedirs(OUT, exist_ok=True)
    for year, (s, e) in PERIODS.items():
        for tag, source in SOURCES.items():
            path = os.path.join(OUT, f"{tag}_{year}.csv")
            if os.path.exists(path):
                print("exists, skipping", path)
                continue
            d, end = dt.date.fromisoformat(s), dt.date.fromisoformat(e)
            header, rows = None, []
            while d <= end:
                days = min(5, (end - d).days + 1)
                text = pf.fetch(key, source, d.isoformat(), days)
                lines = text.strip().splitlines()
                if lines and lines[0].startswith("latitude"):
                    header = header or lines[0]
                    rows.extend(lines[1:])
                d += dt.timedelta(days=days)
            with open(path, "w", newline="") as f:
                f.write((header or "") + "\n" + "\n".join(rows) + "\n")
            print(f"{tag} {year}: {len(rows)} detections -> {path}")


if __name__ == "__main__":
    main()
