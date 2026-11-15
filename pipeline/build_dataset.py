"""Harmonize MODIS, Suomi NPP VIIRS and NOAA-20 VIIRS active-fire records.

Reads the per-sensor-year caches written by pull_firms.py and writes the static JSON
files the web app loads (web/public/data/).

Method (see README for the plain-language version)
--------------------------------------------------
* Reference scale: NOAA-20 VIIRS 375 m (the satellite that continues the record).
* Suomi NPP VIIRS is placed on the reference scale with a per-region ratio estimated
  from the days both satellites observed.
* MODIS (1 km) is mapped onto the reference scale with a per-region seasonal regression
  of log(1 + 7-day VIIRS detections) on log(1 + 7-day MODIS detections), fitted over the
  period where both exist. It is used wherever VIIRS did not exist (before 2012).
* Uncertainty bands come from leave-one-year-out cross-validation: each year is predicted
  by a model that never saw it, and the held-out errors set the band.
* Anomaly percentile: each 7-day total is ranked against the same time of year (+/-10 days)
  in every OTHER year, so an extreme year is never part of its own baseline.
* A day on which a sensor reported zero detections over the whole study box is treated as
  missing data, not as "no fire".
"""
import glob, json, os, sys, datetime as dt
import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# the caches can live outside the repo: set IGNIS_CACHE to their folder
CACHE = os.environ.get("IGNIS_CACHE", os.path.join(ROOT, "pipeline", "cache"))
OUT = os.path.join(ROOT, "web", "public", "data")

BOX = (95.0, -6.0, 120.0, 8.0)
CELL = 0.5
NX, NY = 50, 28

# Approximate region outlines (lon, lat). Cells are assigned by centre point.
# These are coarse hand-drawn outlines good enough for a 0.5-degree grid; replace them with
# official boundaries (Natural Earth / GADM) for a production version.
REGIONS = {
    "pen_malaysia": ("Peninsular Malaysia", "#f4a259", [
        (100.1, 6.5), (101.6, 6.5), (102.2, 6.2), (102.9, 5.4), (103.4, 4.0), (103.5, 2.9),
        (104.2, 1.6), (103.9, 1.2), (103.4, 1.25), (102.2, 1.9), (101.3, 2.8), (100.6, 4.2),
        (100.3, 5.3)]),
    "sumatra": ("Sumatra", "#e5484d", [
        (95.0, 5.8), (97.4, 5.5), (98.7, 3.9), (100.0, 2.8), (100.9, 2.1), (102.2, 1.4),
        (103.3, -0.3), (104.3, -1.0), (105.2, -2.8), (106.0, -5.5), (105.9, -6.0),
        (104.0, -5.4), (102.3, -3.9), (100.3, -1.0), (98.8, 1.6), (96.0, 4.1), (95.1, 5.4)]),
    "kalimantan": ("Kalimantan", "#8e4ec6", [
        (109.6, 2.1), (110.9, 1.7), (112.2, 1.2), (113.9, 1.5), (114.8, 2.1), (115.6, 3.1),
        (115.9, 4.1), (117.7, 4.3), (117.6, 3.3), (117.3, 0.9), (117.5, 0.1), (117.0, -0.8),
        (116.7, -1.5), (116.5, -2.3), (116.0, -3.0), (116.2, -4.0), (115.0, -4.0),
        (114.0, -3.6), (112.5, -3.4), (110.8, -3.0), (110.1, -2.0), (109.9, -1.0),
        (109.0, 0.0), (108.9, 1.0)]),
    "east_malaysia": ("Sarawak, Sabah and Brunei", "#30a46c", [
        (109.6, 2.1), (110.9, 1.7), (112.2, 1.2), (113.9, 1.5), (114.8, 2.1), (115.6, 3.1),
        (115.9, 4.1), (117.7, 4.3), (118.2, 5.0), (119.3, 5.3), (118.4, 6.0), (117.0, 7.1),
        (116.2, 6.5), (115.5, 5.5), (114.4, 4.7), (113.0, 3.2), (111.8, 2.4), (110.4, 1.7)]),
}
REGION_IDS = list(REGIONS)
ALL4 = "study_area"
SENSORS = ["modis", "snpp", "noaa20"]


def points_in_polygon(px, py, poly):
    inside = np.zeros(px.shape, bool)
    n = len(poly)
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        cond = ((yi > py) != (yj > py)) & (px < (xj - xi) * (py - yi) / (yj - yi + 1e-12) + xi)
        inside ^= cond
        j = i
    return inside


def load_caches():
    frames = []
    for path in sorted(glob.glob(os.path.join(CACHE, "*_*.csv"))):
        sensor = os.path.basename(path).split("_")[0]
        if sensor not in SENSORS:
            continue
        df = pd.read_csv(path)
        df["sensor"] = sensor
        frames.append(df)
    if not frames:
        sys.exit("No cache files found. Run pipeline/pull_firms.py first.")
    return pd.concat(frames, ignore_index=True)


def roll7(x):
    """Centred 7-day sum, scaled up when 5-6 days are valid, NaN when fewer."""
    valid = ~np.isnan(x)
    k = np.ones(7)
    s = np.convolve(np.where(valid, x, 0.0), k, "same")
    c = np.convolve(valid.astype(float), k, "same")
    return np.where(c >= 5, s * 7.0 / np.maximum(c, 1), np.nan)


def seasonal(doy):
    t = 2 * np.pi * doy / 365.25
    return np.column_stack([np.sin(t), np.cos(t), np.sin(2 * t), np.cos(2 * t)])


def design(m7, doy):
    return np.column_stack([np.ones(len(m7)), np.log1p(m7), seasonal(doy)])


def fit(X, y):
    beta, *_ = np.linalg.lstsq(X, y, rcond=None)
    return beta


SEA_CONFIG = {
    "box": BOX, "cell": CELL, "nx": NX, "ny": NY,
    "regions": REGIONS, "all_name": "Study area (all four regions)", "out": OUT,
}


def main():
    build(load_caches(), SEA_CONFIG)


def build(df, cfg):
    """Harmonize one sector. cfg: box, cell, nx, ny, regions {id: (name, colour, polygon or None)},
    all_name, out, and optionally sector (extra metadata). If df already has a `region` column
    (index into the regions), it is used as is; otherwise cells are assigned by polygon."""
    BOX, CELL, NX, NY = cfg["box"], cfg["cell"], cfg["nx"], cfg["ny"]
    REGIONS = cfg["regions"]
    REGION_IDS = list(REGIONS)
    OUT = cfg["out"]
    dates_all = pd.to_datetime(df["date"])
    start = pd.Timestamp(dates_all.min().year, 1, 1)
    end = pd.Timestamp(dates_all.max())
    idx = pd.date_range(start, end, freq="D")
    T = len(idx)
    day_of = {d.strftime("%Y-%m-%d"): i for i, d in enumerate(idx)}
    df["t"] = df["date"].map(day_of)
    # detections exactly on the east or north edge of the box fall one cell past the grid
    df["cx"] = df["cx"].clip(0, NX - 1)
    df["cy"] = df["cy"].clip(0, NY - 1)
    doy = np.minimum(idx.dayofyear.values, 365)
    year = idx.year.values

    # Region of each grid cell
    cx_c = BOX[0] + (np.arange(NX) + 0.5) * CELL
    cy_c = BOX[1] + (np.arange(NY) + 0.5) * CELL
    GX, GY = np.meshgrid(cx_c, cy_c)  # shape (NY, NX)
    region_of = np.full((NY, NX), -1, int)
    if "region" in df.columns:
        # each cell takes the region that recorded most of its detections
        tot = df.assign(n=df["n_quality"] + df["n_low"]).groupby(["cy", "cx", "region"])["n"].sum().reset_index()
        tot = tot.sort_values("n").drop_duplicates(["cy", "cx"], keep="last")
        region_of[tot["cy"].values, tot["cx"].values] = tot["region"].values
    else:
        for r, rid in enumerate(REGION_IDS):
            region_of[points_in_polygon(GX, GY, REGIONS[rid][2])] = r
        df["region"] = region_of[df["cy"].clip(0, NY - 1), df["cx"].clip(0, NX - 1)]

    # Daily counts per sensor x region (quality detections) and sensor availability
    counts = {s: np.full((len(REGION_IDS) + 1, T), np.nan) for s in SENSORS}  # last row = study area
    frp_sum = {s: np.zeros((len(REGION_IDS) + 1, T)) for s in SENSORS}
    have = {}
    for s in SENSORS:
        d = df[df.sensor == s]
        total_day = np.zeros(T)
        np.add.at(total_day, d["t"].values, (d["n_quality"] + d["n_low"]).values)
        have_s = total_day > 0
        have[s] = have_s
        for r in range(len(REGION_IDS)):
            dr = d[d.region == r]
            arr = np.zeros(T)
            np.add.at(arr, dr["t"].values, dr["n_quality"].values)
            fr = np.zeros(T)
            np.add.at(fr, dr["t"].values, dr["frp_quality"].values)
            counts[s][r] = np.where(have_s, arr, np.nan)
            frp_sum[s][r] = fr
        counts[s][-1] = np.where(have_s, np.nansum(counts[s][:-1], axis=0), np.nan)
        frp_sum[s][-1] = frp_sum[s][:-1].sum(axis=0)
        print(f"{s}: {int(have_s.sum())} days with data", flush=True)

    names = REGION_IDS + [ALL4]
    out_regions = {}
    calibration, validation = {}, {}

    for r, rid in enumerate(names):
        m, sn, n20 = counts["modis"][r], counts["snpp"][r], counts["noaa20"][r]

        # SNPP -> NOAA-20 scale
        both = ~np.isnan(sn) & ~np.isnan(n20)
        f_snpp = float(np.nansum(n20[both]) / max(np.nansum(sn[both]), 1)) if both.any() else 1.0
        ref = np.where(~np.isnan(n20), n20, sn * f_snpp)

        m7, ref7 = roll7(m), roll7(ref)
        fit_ok = ~np.isnan(m7) & ~np.isnan(ref7)
        fit_idx = np.where(fit_ok)[0][::7]  # non-overlapping windows
        y_all = np.log1p(ref7)
        X_all = design(np.nan_to_num(m7, nan=0.0), doy)
        beta = fit(X_all[fit_idx], y_all[fit_idx])

        # Leave-one-year-out cross validation on every valid window
        cv_pred = np.full(T, np.nan)
        for yv in np.unique(year[fit_idx]):
            tr = fit_idx[year[fit_idx] != yv]
            if len(tr) < 30:
                continue
            b = fit(X_all[tr], y_all[tr])
            te = np.where(fit_ok & (year == yv))[0]
            cv_pred[te] = X_all[te] @ b
        cvm = fit_ok & ~np.isnan(cv_pred)
        resid = y_all - cv_pred
        pred_level = cv_pred.copy()
        edges = np.quantile(pred_level[cvm], [1 / 3, 2 / 3])

        def bin_of(v):
            return np.digitize(v, edges)

        def band(rs, lv):
            q = {}
            for bi in range(3):
                sel = bin_of(lv) == bi
                q[bi] = (np.quantile(rs[sel], 0.1), np.quantile(rs[sel], 0.9)) if sel.sum() > 20 else (-0.5, 0.5)
            return q

        full_band = band(resid[cvm], pred_level[cvm])
        # honest coverage: bands for each held-out year from the OTHER years' residuals
        cov_hits, cov_n = 0, 0
        for yv in np.unique(year[cvm]):
            te = cvm & (year == yv)
            oth = cvm & (year != yv)
            qb = band(resid[oth], pred_level[oth])
            bi = bin_of(pred_level[te])
            lo = np.array([qb[b][0] for b in bi])
            hi = np.array([qb[b][1] for b in bi])
            cov_hits += int(((resid[te] >= lo) & (resid[te] <= hi)).sum())
            cov_n += int(te.sum())
        mae_log = float(np.nanmedian(np.abs(resid[cvm])))
        ss_res = float(np.nansum(resid[cvm] ** 2))
        ss_tot = float(np.nansum((y_all[cvm] - np.nanmean(y_all[cvm])) ** 2))

        # Full-model predictions for every day with MODIS data
        pred7 = X_all @ beta
        lo_q = np.array([full_band[b][0] for b in bin_of(pred7)])
        hi_q = np.array([full_band[b][1] for b in bin_of(pred7)])
        P7, P7lo, P7hi = np.expm1(pred7), np.expm1(pred7 + lo_q), np.expm1(pred7 + hi_q)

        def to_daily(P, M7, mday):
            return np.where(M7 > 0, P * np.nan_to_num(mday) / np.where(M7 > 0, M7, 1), P / 7.0)

        mod_d = to_daily(P7, np.nan_to_num(m7, nan=0), m)
        mod_lo = to_daily(P7lo, np.nan_to_num(m7, nan=0), m)
        mod_hi = to_daily(P7hi, np.nan_to_num(m7, nan=0), m)
        valid_mod = ~np.isnan(m7)
        use_ref = ~np.isnan(ref)
        harm = np.where(use_ref, ref, np.where(valid_mod, mod_d, np.nan))
        lo = np.where(use_ref, ref, np.where(valid_mod, mod_lo, np.nan))
        hi = np.where(use_ref, ref, np.where(valid_mod, mod_hi, np.nan))
        src = np.where(use_ref, 1, np.where(valid_mod, 2, 0))

        # CV daily predictions to validate annual totals
        cv_P7 = np.expm1(cv_pred)
        cv_daily = np.where(cvm, to_daily(cv_P7, np.nan_to_num(m7, nan=0), m), np.nan)
        ann = []
        for yv in sorted(set(year[cvm])):
            sel = (year == yv) & use_ref & ~np.isnan(cv_daily)
            if sel.sum() < 200:
                continue
            ann.append({"year": int(yv), "observed": round(float(ref[sel].sum())),
                        "predicted": round(float(cv_daily[sel].sum()))})
        pts = np.where(cvm)[0][::7]
        scatter = [[int(year[i]), round(float(np.expm1(y_all[i])), 1), round(float(np.expm1(cv_pred[i])), 1)] for i in pts]

        # Overall raw sensor ratio, mean FRP per detection
        ov = ~np.isnan(m) & ~np.isnan(ref)
        raw_ratio = float(np.sum(ref[ov]) / max(np.sum(m[ov]), 1)) if ov.any() else None
        fr = lambda s: float(frp_sum[s][r].sum() / max(np.nansum(counts[s][r]), 1))
        calibration[rid] = {
            "snpp_to_noaa20": round(f_snpp, 3),
            "raw_viirs_to_modis_ratio": round(raw_ratio, 2) if raw_ratio else None,
            "beta": [round(float(v), 4) for v in beta],
            "median_abs_log_error": round(mae_log, 3),
            "cv_r2_log": round(1 - ss_res / ss_tot, 3) if ss_tot > 0 else None,
            "cv_coverage_80": round(cov_hits / max(cov_n, 1), 3),
            "n_windows": int(len(fit_idx)),
            "mean_frp_mw": {s: round(fr(s), 1) for s in SENSORS},
        }
        validation[rid] = {"annual": ann, "scatter": scatter}

        # Anomaly percentile and normal band (leave the year itself out of its baseline)
        S7 = roll7(harm)
        years_u = sorted(set(year))
        mat = np.full((len(years_u), 366), np.nan)
        yi = {y: i for i, y in enumerate(years_u)}
        for t in range(T):
            mat[yi[year[t]], doy[t] - 1] = S7[t]
        pct = np.full(T, np.nan)
        nmed = np.full(T, np.nan)
        np90 = np.full(T, np.nan)
        for t in range(T):
            if np.isnan(S7[t]):
                continue
            cols = [(doy[t] - 1 + k) % 365 for k in range(-10, 11)]
            others = np.delete(mat[:, cols], yi[year[t]], axis=0).ravel()
            others = others[~np.isnan(others)]
            if len(others) < 40:
                continue
            pct[t] = 100.0 * np.mean(others <= S7[t])
            nmed[t] = np.median(others)
            np90[t] = np.quantile(others, 0.9)

        def pack(a, nd=1):
            return [None if np.isnan(v) else (int(v) if nd == 0 else round(float(v), nd)) for v in a]

        out_regions[rid] = {
            "name": REGIONS[rid][0] if rid in REGIONS else cfg["all_name"],
            "color": REGIONS[rid][1] if rid in REGIONS else "#ffffff",
            "series": {
                "modis": pack(m, 0), "snpp": pack(sn, 0), "noaa20": pack(n20, 0),
                "harm": pack(harm), "lo": pack(lo), "hi": pack(hi), "src": [int(v) for v in src],
                "pct": pack(pct, 0), "norm": pack(nmed / 7.0), "norm90": pack(np90 / 7.0),
            },
        }
        print(f"{rid}: snpp->n20 x{f_snpp:.2f}, cv R2(log) "
              f"{calibration[rid]['cv_r2_log']}, 80% coverage {calibration[rid]['cv_coverage_80']}", flush=True)

    # Events: runs of very high percentile in the study area
    sa = out_regions[ALL4]["series"]
    pct = np.array([np.nan if v is None else v for v in sa["pct"]])
    harm = np.array([np.nan if v is None else v for v in sa["harm"]])
    norm = np.array([np.nan if v is None else v for v in sa["norm"]])
    events, t = [], 0
    while t < T:
        if pct[t] >= 97:
            e = t
            while e + 1 < T and (pct[e + 1] >= 90):
                e += 1
            seg = slice(t, e + 1)
            if e - t >= 6:
                pk = t + int(np.nanargmax(harm[seg]))
                tot = float(np.nansum(harm[seg]))
                base = float(np.nansum(norm[seg]))
                events.append({"start": idx[t].strftime("%Y-%m-%d"), "end": idx[e].strftime("%Y-%m-%d"),
                               "peak": idx[pk].strftime("%Y-%m-%d"), "total": round(tot),
                               "times_normal": round(tot / base, 1) if base > 0 else None})
            t = e + 1
        else:
            t += 1
    events = sorted(events, key=lambda x: -x["total"])[:14]
    events.sort(key=lambda x: x["start"])

    # Weekly grid, rescaled so each region's cells add up to its harmonized weekly total
    W = T // 7 + 1
    reg_week_harm, reg_week_src = {}, {}
    for r, rid in enumerate(REGION_IDS):
        h = np.array([np.nan if v is None else v for v in out_regions[rid]["series"]["harm"]])
        reg_week_harm[rid] = np.bincount(np.arange(T) // 7, weights=np.nan_to_num(h), minlength=W)
    # primary sensor per cell-day: NOAA-20, else SNPP, else MODIS
    prim = df.copy()
    prim["w"] = prim["t"] // 7
    rank = {"noaa20": 0, "snpp": 1, "modis": 2}
    prim["rk"] = prim["sensor"].map(rank)
    # a day uses its best sensor; keep rows from the best-ranked sensor available on that day
    best = prim.groupby("t")["rk"].transform("min")
    prim = prim[prim["rk"] == best]
    scale_f = {r: calibration[rid]["snpp_to_noaa20"] for r, rid in enumerate(REGION_IDS)}
    prim["val"] = prim["n_quality"].astype(float)
    snpp_mask = prim["sensor"] == "snpp"
    prim.loc[snpp_mask, "val"] *= prim.loc[snpp_mask, "region"].map(lambda r: scale_f.get(r, 1.0))
    cellweek = prim.groupby(["w", "cx", "cy", "region"], as_index=False)["val"].sum()
    # weekly scale from MODIS-only weeks to harmonized region totals
    reg_week_raw = cellweek[cellweek.region >= 0].groupby(["region", "w"])["val"].sum()
    mod_only_ratio = {}
    for r, rid in enumerate(REGION_IDS):
        raw = np.zeros(W)
        if r in reg_week_raw.index.get_level_values(0):
            s_ = reg_week_raw.loc[r]
            raw[s_.index.values] = s_.values
        ratio = np.where(raw > 0, reg_week_harm[rid] / np.maximum(raw, 1e-9), 1.0)
        mod_only_ratio[r] = ratio
    global_ratio = float(np.nanmedian([calibration[r]["raw_viirs_to_modis_ratio"] or 4.4 for r in REGION_IDS]))
    cells_index, week_rows = {}, [[] for _ in range(W)]
    modis_week = (prim.groupby("w")["rk"].max() == 2).reindex(range(W), fill_value=False).values
    for w_, cx_, cy_, rg_, v_ in cellweek.itertuples(index=False):
        scale = mod_only_ratio[rg_][w_] if rg_ >= 0 else (global_ratio if modis_week[w_] else 1.0)
        val = int(round(v_ * scale))
        if val < 1:
            continue
        key = (int(cx_), int(cy_))
        ci = cells_index.setdefault(key, len(cells_index))
        week_rows[int(w_)].extend([ci, val])
    cells = [[cx_, cy_, int(region_of[cy_, cx_])] for (cx_, cy_), _ in sorted(cells_index.items(), key=lambda kv: kv[1])]

    os.makedirs(OUT, exist_ok=True)
    meta = {
        "generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
        "box": BOX, "cell": CELL, "nx": NX, "ny": NY,
        "start": idx[0].strftime("%Y-%m-%d"), "end": idx[-1].strftime("%Y-%m-%d"), "days": T,
        "regions": [{"id": rid, "name": out_regions[rid]["name"], "color": out_regions[rid]["color"],
                     "polygon": REGIONS[rid][2] if rid in REGIONS else None} for rid in names],
        "sensors": {
            "modis": {"label": "MODIS (Terra + Aqua), 1 km", "first": (idx[np.argmax(have["modis"])].strftime("%Y-%m-%d") if have["modis"].any() else None)},
            "snpp": {"label": "Suomi NPP VIIRS, 375 m", "first": (idx[np.argmax(have["snpp"])].strftime("%Y-%m-%d") if have["snpp"].any() else None)},
            "noaa20": {"label": "NOAA-20 VIIRS, 375 m", "first": (idx[np.argmax(have["noaa20"])].strftime("%Y-%m-%d") if have["noaa20"].any() else None)},
        },
        "calibration": calibration, "validation": validation, "events": events,
    }
    if cfg.get("sector"):
        meta["sector"] = cfg["sector"]
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, "meta.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    with open(os.path.join(OUT, "daily.json"), "w") as f:
        json.dump({"start": meta["start"], "days": T, "regions": out_regions}, f, separators=(",", ":"))
    with open(os.path.join(OUT, "grid.json"), "w") as f:
        json.dump({"start": meta["start"], "weeks": W, "cells": cells, "data": week_rows}, f, separators=(",", ":"))
    for name in ("meta", "daily", "grid"):
        print(name, round(os.path.getsize(os.path.join(OUT, name + ".json")) / 1e6, 2), "MB")
    print(f"{len(events)} events flagged")


if __name__ == "__main__":
    main()
