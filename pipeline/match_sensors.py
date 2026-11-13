"""Detection-level matching between MODIS and NOAA-20 VIIRS.

For each detection of one sensor we look for a detection of the other sensor within a
spatial radius and a time tolerance, and report match rates for a grid of tolerances.
It also writes small demo-day hotspot extracts used by the web app's detection and
harmonization scenes.

Inputs: data/{modis,noaa20}_{year}.csv  (raw detections written by the first FIRMS pull;
        August to October of 2019 and 2023, study box 95-120E, 6S-8N).
Outputs: web/public/data/matching.json, web/public/data/demo_hotspots.json

A hotspot is a satellite-detected thermal anomaly, not a confirmed fire. A match means
"both sensors flagged a thermal anomaly at about the same place and time", nothing more.
"""
import csv, json, os, sys
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "data")
OUT = os.path.join(ROOT, "web", "public", "data")
YEARS = [2019, 2023]
RADII = [0.5, 0.75, 1.0, 1.5, 2.0, 3.0]  # km
TIMES = [15, 30, 60, 90, 120, 180]  # minutes
KM = 111.195
CELL = 0.03  # degrees, about 3.3 km
TBUCKET = 180  # minutes


def load(path, sensor):
    rows = []
    with open(path) as f:
        for r in csv.DictReader(f):
            if r.get("type", "0") not in ("0", ""):
                continue
            hhmm = r["acq_time"].zfill(4)
            day = np.datetime64(r["acq_date"], "D").astype("int64")
            minute = day * 1440 + int(hhmm[:2]) * 60 + int(hhmm[2:])
            conf = r["confidence"]
            if sensor == "modis":
                ok = float(conf) >= 30
                sat = r["satellite"]
            else:
                ok = conf in ("n", "h")
                sat = "N20"
            if not ok:
                continue
            rows.append((float(r["latitude"]), float(r["longitude"]), minute, float(r["frp"]),
                         sat, float(r.get("scan", 1) or 1), float(r.get("track", 1) or 1)))
    a = np.array([(x[0], x[1], x[2], x[3], x[5], x[6]) for x in rows], dtype=float)
    sats = np.array([x[4] for x in rows])
    return a, sats  # columns: lat, lon, minute, frp, scan, track


def build_index(b):
    ix = np.floor(b[:, 1] / CELL).astype(np.int64)
    iy = np.floor(b[:, 0] / CELL).astype(np.int64)
    tb = np.floor(b[:, 2] / TBUCKET).astype(np.int64)
    key = (ix + 20000) * 10_000_000_000 + (iy + 20000) * 100_000 + (tb % 100_000)
    order = np.argsort(key, kind="stable")
    key_s = key[order]
    uniq, start = np.unique(key_s, return_index=True)
    ends = np.append(start[1:], len(key_s))
    groups = {}
    for k, s, e in zip(uniq.tolist(), start.tolist(), ends.tolist()):
        idx = order[s:e]
        groups[k] = (b[idx, 0], b[idx, 1], b[idx, 2])
    return groups


def min_dist_table(a, groups):
    """For each row of a: smallest distance (km) to any b within |dt| <= T, for every T."""
    n = len(a)
    out = np.full((n, len(TIMES)), np.inf)
    ix = np.floor(a[:, 1] / CELL).astype(np.int64)
    iy = np.floor(a[:, 0] / CELL).astype(np.int64)
    tb = np.floor(a[:, 2] / TBUCKET).astype(np.int64)
    best_dt = np.full(n, np.nan)  # signed dt (b minus a) of the nearest partner within 3 km
    for i in range(n):
        lats, lons, ts = [], [], []
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for dt_ in (-1, 0, 1):
                    k = (ix[i] + dx + 20000) * 10_000_000_000 + (iy[i] + dy + 20000) * 100_000 + ((tb[i] + dt_) % 100_000)
                    g = groups.get(k)
                    if g is not None:
                        lats.append(g[0]); lons.append(g[1]); ts.append(g[2])
        if not lats:
            continue
        la = np.concatenate(lats); lo = np.concatenate(lons); tt = np.concatenate(ts)
        d = np.hypot((la - a[i, 0]) * KM, (lo - a[i, 1]) * KM * np.cos(np.radians(a[i, 0])))
        dtm = tt - a[i, 2]
        near = d <= RADII[-1]
        if not near.any():
            continue
        d, dtm = d[near], dtm[near]
        adt = np.abs(dtm)
        for j, T in enumerate(TIMES):
            m = adt <= T
            if m.any():
                out[i, j] = d[m].min()
        best_dt[i] = dtm[np.argmin(d)]
    return out, best_dt


def coverage(a, b, deg=0.25, minutes=60):
    """True where sensor b has any detection within about 28 km and one hour of a detection of a.

    This is a proxy for "b actually observed this area at about this time", so that a missing
    match caused by a different overpass or swath is not counted as disagreement.
    """
    def enc(x, y, t):
        return (np.floor(x / deg).astype(np.int64) + 5000) * 1_000_000_000 + (np.floor(y / deg).astype(np.int64) + 5000) * 1_000_000 + (np.floor(t / minutes).astype(np.int64) % 1_000_000)

    kb = np.unique(enc(b[:, 1], b[:, 0], b[:, 2]))
    ok = np.zeros(len(a), bool)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dt in (-1, 0, 1):
                k = enc(a[:, 1] + dx * deg, a[:, 0] + dy * deg, a[:, 2] + dt * minutes)
                ok |= np.isin(k, kb)
    return ok


def rate(tbl, j, r):
    return float(np.mean(tbl[:, j] <= r)) if len(tbl) else float("nan")


def main():
    result = {"radii_km": RADII, "times_min": TIMES, "periods": [], "sweep": [], "offsets": {}, "frp": {},
              "area_ratio": round((1.0 / 0.375) ** 2, 2)}
    off_bins = list(range(-180, 181, 10))
    all_off = {"Aqua": [], "Terra": []}
    frp_edges = [0, 1, 2, 5, 10, 20, 50, 1e9]
    z = lambda: np.zeros(len(frp_edges) - 1)
    frp_tbl = {k: z() for k in ("viirs_total", "viirs_matched", "viirs_cov", "viirs_matched_cov",
                                "modis_total", "modis_matched", "modis_cov", "modis_matched_cov")}
    head = {y: {} for y in YEARS}
    hj, ji, jt = TIMES.index(60), RADII.index(1.0), None  # headline: 1 km, 60 min
    demo = []

    for year in YEARS:
        mp, vp = os.path.join(RAW, f"modis_{year}.csv"), os.path.join(RAW, f"noaa20_{year}.csv")
        if not (os.path.exists(mp) and os.path.exists(vp)):
            print("missing raw files for", year, file=sys.stderr)
            continue
        m, msat = load(mp, "modis")
        v, _ = load(vp, "viirs")
        label = f"Aug to Oct {year}"
        result["periods"].append({"label": label, "year": year, "modis_aqua": int((msat == "Aqua").sum()),
                                  "modis_terra": int((msat == "Terra").sum()), "viirs_noaa20": int(len(v))})
        print(label, "MODIS", len(m), "VIIRS", len(v), flush=True)
        vgroups = build_index(v)
        for sat in ("Aqua", "Terra"):
            ma = m[msat == sat]
            tbl, dts = min_dist_table(ma, vgroups)
            for j, T in enumerate(TIMES):
                for r in RADII:
                    result["sweep"].append({"period": label, "satellite": sat, "radius_km": r, "dt_min": T,
                                            "rate": round(rate(tbl, j, r), 4), "n": int(len(ma))})
            all_off[sat].append(dts[~np.isnan(dts)])
            if sat == "Aqua":
                hit = tbl[:, hj] <= RADII[ji]
                cov = coverage(ma, v)
                head[year]["aqua_in_viirs"] = {"n": int(len(ma)), "rate": round(float(hit.mean()), 4),
                                               "n_covered": int(cov.sum()),
                                               "rate_covered": round(float((hit & cov).sum() / max(cov.sum(), 1)), 4)}
                for k in range(len(frp_edges) - 1):
                    sel = (ma[:, 3] >= frp_edges[k]) & (ma[:, 3] < frp_edges[k + 1])
                    frp_tbl["modis_total"][k] += sel.sum()
                    frp_tbl["modis_matched"][k] += (sel & hit).sum()
                    frp_tbl["modis_cov"][k] += (sel & cov).sum()
                    frp_tbl["modis_matched_cov"][k] += (sel & hit & cov).sum()
        # reverse direction: how many VIIRS detections does Aqua also see?
        aqua = m[msat == "Aqua"]
        agroups = build_index(aqua)
        vt, _ = min_dist_table(v, agroups)
        hit = vt[:, hj] <= RADII[ji]
        cov = coverage(v, aqua)
        head[year]["viirs_in_aqua"] = {"n": int(len(v)), "rate": round(float(hit.mean()), 4),
                                       "n_covered": int(cov.sum()),
                                       "rate_covered": round(float((hit & cov).sum() / max(cov.sum(), 1)), 4)}
        for k in range(len(frp_edges) - 1):
            sel = (v[:, 3] >= frp_edges[k]) & (v[:, 3] < frp_edges[k + 1])
            frp_tbl["viirs_total"][k] += sel.sum()
            frp_tbl["viirs_matched"][k] += (sel & hit).sum()
            frp_tbl["viirs_cov"][k] += (sel & cov).sum()
            frp_tbl["viirs_matched_cov"][k] += (sel & hit & cov).sum()
        for j, T in enumerate(TIMES):
            for r in RADII:
                result["sweep"].append({"period": label, "satellite": "VIIRS-by-Aqua", "radius_km": r, "dt_min": T,
                                        "rate": round(rate(vt, j, r), 4), "n": int(len(v))})
        demo.append((year, m, msat, v))
        print("  done", flush=True)

    for sat in ("Aqua", "Terra"):
        arr = np.concatenate(all_off[sat]) if all_off[sat] else np.array([])
        h, _ = np.histogram(arr, bins=off_bins)
        result["offsets"][sat] = {"bins": off_bins, "counts": h.tolist()}
    labels = ["<1", "1-2", "2-5", "5-10", "10-20", "20-50", "50+"]
    result["frp"] = {
        "bins_mw": labels,
        "viirs_total": frp_tbl["viirs_total"].astype(int).tolist(),
        "viirs_seen_by_modis": (frp_tbl["viirs_matched"] / np.maximum(frp_tbl["viirs_total"], 1)).round(4).tolist(),
        "modis_total": frp_tbl["modis_total"].astype(int).tolist(),
        "modis_seen_by_viirs": (frp_tbl["modis_matched"] / np.maximum(frp_tbl["modis_total"], 1)).round(4).tolist(),
        "viirs_seen_by_modis_covered": (frp_tbl["viirs_matched_cov"] / np.maximum(frp_tbl["viirs_cov"], 1)).round(4).tolist(),
        "modis_seen_by_viirs_covered": (frp_tbl["modis_matched_cov"] / np.maximum(frp_tbl["modis_cov"], 1)).round(4).tolist(),
    }
    result["headline"] = {"radius_km": 1.0, "dt_min": 60, "by_year": {str(y): head[y] for y in YEARS}}

    # demo days: densest window on the peak VIIRS day of each period
    demos = []
    for year, m, msat, v in demo:
        days = np.floor(v[:, 2] / 1440).astype(int)
        peak = np.bincount(days - days.min()).argmax() + days.min()
        sel = days == peak
        vv = v[sel]
        best, bw = -1, None
        for lat0 in np.arange(-6, 7.5, 0.25):
            for lon0 in np.arange(95, 119, 0.25):
                c = int(((vv[:, 0] >= lat0) & (vv[:, 0] < lat0 + 1.0) & (vv[:, 1] >= lon0) & (vv[:, 1] < lon0 + 1.4)).sum())
                if c > best:
                    best, bw = c, (lat0, lon0)
        lat0, lon0 = bw
        box = (lon0, lat0, lon0 + 1.4, lat0 + 1.0)
        date = str(np.datetime64(int(peak), "D"))

        def pick(a, sats=None):
            d = np.floor(a[:, 2] / 1440).astype(int)
            ok = (d == peak) & (a[:, 0] >= box[1]) & (a[:, 0] < box[3]) & (a[:, 1] >= box[0]) & (a[:, 1] < box[2])
            return ok

        okm, okv = pick(m), pick(v)
        demos.append({
            "id": f"d{year}", "date": date, "box": [round(x, 3) for x in box],
            "modis": [[round(float(r[1]), 4), round(float(r[0]), 4), int(r[2] % 1440), round(float(r[3]), 1),
                       round(float(r[4]), 2), 1 if s == "Aqua" else 0] for r, s in zip(m[okm], msat[okm])],
            "viirs": [[round(float(r[1]), 4), round(float(r[0]), 4), int(r[2] % 1440), round(float(r[3]), 1)] for r in v[okv]],
        })
        print("demo", date, box, "MODIS", int(okm.sum()), "VIIRS", int(okv.sum()), flush=True)

    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "matching.json"), "w") as f:
        json.dump(result, f, separators=(",", ":"))
    with open(os.path.join(OUT, "demo_hotspots.json"), "w") as f:
        json.dump({"demos": demos}, f, separators=(",", ":"))
    for name in ("matching", "demo_hotspots"):
        print(name, round(os.path.getsize(os.path.join(OUT, name + ".json")) / 1e6, 2), "MB")


if __name__ == "__main__":
    main()
