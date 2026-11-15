"""Fire-activity outlook: the next 26 weeks for every region of every sector.

Reads the harmonized daily series the site already serves (daily.json) and NOAA's Oceanic Nino
Index, and writes forecast.json next to it.

The model, in plain words
-------------------------
Work on weekly totals on a log scale, y = log(1 + detections in the week).

1. Normal. For any week of the year, the normal is the median of y in the same week (+/-1 week)
   across the other years of the record. On its own this is the "climatology" forecast: expect
   a typical year.
2. Departure. What the model actually predicts is how far the coming week will sit above or
   below normal (y - normal), h weeks ahead, from what is known at the issue date:
     * how far above or below normal the last 4 weeks and the last 12 weeks were (fire seasons
       that start early or hot tend to stay that way for a while), and
     * the El Nino-Southern Oscillation (ONI), allowed to act differently at different times of
       the year (El Nino dries Indonesia in August-October but matters at other times
       elsewhere). Only ONI values already published at the issue date are used.
   One ridge regression per region and lead time (1 to 26 weeks).
3. Honesty. Every year is forecast by a model fitted without that year (leave-one-year-out).
   Those held-out errors give the 80% range, the chance of an above-normal or critical week,
   and the skill scores shown on the site, compared against the climatology forecast.

A "critical" week is one above the 90th percentile of that week of the year in the record.

Usage:
    python pipeline/build_forecast.py [--oni <oni.ascii.txt path or URL>]
"""
import argparse, datetime as dt, json, os, sys, urllib.request
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(os.path.dirname(HERE), "web", "public", "data")
ONI_URL = "https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt"
H = 26  # lead times in weeks
LAMBDA = 3.0  # ridge penalty on standardized features
SEASONS = ["DJF", "JFM", "FMA", "MAM", "AMJ", "MJJ", "JJA", "JAS", "ASO", "SON", "OND", "NDJ"]


# ------------------------------------------------------------------ ENSO

def load_oni(src):
    text = urllib.request.urlopen(src, timeout=60).read().decode() if src.startswith("http") else open(src).read()
    rows = []
    for line in text.splitlines()[1:]:
        p = line.split()
        if len(p) != 4 or p[0] not in SEASONS:
            continue
        i = SEASONS.index(p[0])
        y = int(p[1])
        # the season is published after its last month: DJF ends in February, ..., OND in
        # December, and NDJ in January of the next year
        end = (y + 1, 1) if i == 11 else (y, i + 2)
        rows.append({"season": p[0], "year": y, "end": end, "anom": float(p[3])})
    return rows


def oni_known_at(oni, d):
    """Latest ONI value that had been published on date d (about ten days after the season ends)."""
    lag = 1 if d.day >= 10 else 2
    m = d.year * 12 + (d.month - 1) - lag
    best = None
    for r in oni:
        e = r["end"][0] * 12 + (r["end"][1] - 1)
        if e <= m:
            best = r
    return best


# ------------------------------------------------------------------ helpers

def weekly(harm, start, last):
    """Weekly sums ending on `last`, oldest first. A week needs 5 valid days (scaled to 7)."""
    T = (last - start).days + 1
    n = T // 7
    off = T - n * 7
    sums, ends = [], []
    for k in range(n):
        seg = harm[off + 7 * k: off + 7 * k + 7]
        v = seg[~np.isnan(seg)]
        sums.append(v.sum() * 7 / len(v) if len(v) >= 5 else np.nan)
        ends.append(start + dt.timedelta(days=off + 7 * k + 6))
    return np.array(sums), ends


def woy_of(d):
    mid = d - dt.timedelta(days=3)
    return min((mid.timetuple().tm_yday - 1) // 7, 51)


def ridge(X, y, lam):
    mu, sd = X.mean(0), X.std(0) + 1e-9
    Z = (X - mu) / sd
    A = Z.T @ Z + lam * np.eye(Z.shape[1])
    b = np.linalg.solve(A, Z.T @ (y - y.mean()))
    return lambda Xn: y.mean() + ((Xn - mu) / sd) @ b


def features(anom, i, oni_v, target_woy, dry=None):
    a4 = np.nanmean(anom[max(0, i - 3): i + 1])
    a12 = np.nanmean(anom[max(0, i - 11): i + 1])
    t = 2 * np.pi * (target_woy + 0.5) / 52
    f = [a4, a12, oni_v, oni_v * np.sin(t), oni_v * np.cos(t), oni_v * np.sin(2 * t), oni_v * np.cos(2 * t)]
    if dry is not None:
        d30, d90 = dry
        # dryness matters more in some seasons than others, so it may act differently through the year
        f += [d30, d90, d90 * np.sin(t), d90 * np.cos(t)]
    return f


# ------------------------------------------------------------------ drought input

def rain_index(weather, start, ends):
    """Dryness at the end of each week: how far the last 30 and 90 days of rain were from normal for
    that time of year, as a standardized anomaly of log rainfall (negative = drier than usual).
    Uses rain up to two days before the week ended, as it would have been available then."""
    w0 = dt.date.fromisoformat(f"{weather['start'][:4]}-{weather['start'][4:6]}-{weather['start'][6:]}")
    rain = np.array([np.nan if v is None else v for v in weather["rain"]], float)
    n = len(rain)
    csum = np.concatenate([[0.0], np.cumsum(np.nan_to_num(rain))])
    valid = np.concatenate([[0], np.cumsum(~np.isnan(rain))])

    def total(k, days):
        a = max(0, k - days + 1)
        nv = valid[k + 1] - valid[a]
        return (csum[k + 1] - csum[a]) * days / nv if nv >= days * 0.8 else np.nan

    last_valid = int(np.where(~np.isnan(rain))[0][-1])
    days_idx = np.arange(n)
    doy = np.array([(w0 + dt.timedelta(days=int(k))).timetuple().tm_yday for k in days_idx])
    out = {}
    for days in (30, 90):
        T = np.array([total(k, days) for k in days_idx])
        L = np.log1p(T)
        # mean and spread of log rainfall for each day of the year (+/-15 days), over all years
        mu = np.full(367, np.nan)
        sd = np.full(367, np.nan)
        for dd in range(1, 367):
            sel = (np.abs(((doy - dd + 183) % 366) - 183) <= 15) & ~np.isnan(L)
            if sel.sum() > 30:
                mu[dd] = L[sel].mean()
                sd[dd] = L[sel].std() + 1e-6
        Z = (L - mu[doy]) / sd[doy]
        pct = 100 * np.expm1(L) / np.expm1(mu[doy])
        out[days] = (Z, pct)
    res = []
    for e in ends:
        k = min((e - w0).days - 2, last_valid)
        res.append((out[30][0][k], out[90][0][k]) if k >= 0 else (np.nan, np.nan))
    summary = {
        "rain_30d_pct": round(float(out[30][1][last_valid])),
        "rain_90d_pct": round(float(out[90][1][last_valid])),
        "index_90d": round(float(out[90][0][last_valid]), 2),
        "as_of": (w0 + dt.timedelta(days=last_valid)).isoformat(),
        # 90-day rain as % of normal at the end of each of the last 52 weeks
        "series": [[(e).isoformat(), None if np.isnan(out[90][1][min((e - w0).days - 2, last_valid)]) else round(float(out[90][1][min((e - w0).days - 2, last_valid)]))]
                   for e in ends[-52:]],
    }
    return np.array(res), summary


# ------------------------------------------------------------------ one region

def forecast_region(series, start, oni, weather=None):
    harm = np.array([np.nan if v is None else v for v in series["harm"]], float)
    valid = np.where(~np.isnan(harm))[0]
    # the newest day can still be filling in, so the outlook is issued from the day before it
    last = start + dt.timedelta(days=int(valid[-1]) - 1)
    w, ends = weekly(harm[: (last - start).days + 1], start, last)
    y = np.log1p(w)
    years = np.array([e.year for e in ends])
    woy = np.array([woy_of(e) for e in ends])
    N = len(y)

    # normal and critical level for each week of the year, leaving one year out
    def clim_table(exclude=None):
        med = np.full(52, np.nan)
        p90 = np.full(52, np.nan)
        for k in range(52):
            sel = (np.abs(((woy - k + 26) % 52) - 26) <= 1) & ~np.isnan(y)
            if exclude is not None:
                sel &= years != exclude
            if sel.sum() >= 8:
                med[k] = np.median(y[sel])
                p90[k] = np.quantile(y[sel], 0.9)
        return med, p90

    yrs = sorted(set(years))
    clim_lo = {yv: clim_table(yv) for yv in yrs}
    clim_all = clim_table()
    normal_cv = np.array([clim_lo[years[i]][0][woy[i]] for i in range(N)])
    anom = y - normal_cv
    oni_at = [oni_known_at(oni, e) for e in ends]
    oni_v = np.array([o["anom"] if o else 0.0 for o in oni_at])
    dry, drought = (None, None)
    if weather is not None:
        dry, drought = rain_index(weather, start, ends)
        # weeks before the rain record or with gaps use "normal" dryness
        dry = np.nan_to_num(dry, nan=0.0)
    dry_at = (lambda i: tuple(dry[i])) if dry is not None else (lambda i: None)

    out_weeks, skill = [], []
    hind = {}  # lead 4 hindcast for the chart
    resid_by_h = {}
    for h in range(1, H + 1):
        rows, target, issue_year, ti_list = [], [], [], []
        for i in range(11, N - h):
            ti = i + h
            if np.isnan(y[ti]) or np.isnan(anom[i]):
                continue
            rows.append(features(anom, i, oni_v[i], woy[ti], dry_at(i)))
            target.append(y[ti] - clim_lo[years[i]][0][woy[ti]])
            issue_year.append(years[i])
            ti_list.append(ti)
        X, Y, IY, TI = np.array(rows), np.array(target), np.array(issue_year), np.array(ti_list)
        ok = ~np.isnan(X).any(1) & ~np.isnan(Y)
        X, Y, IY, TI = X[ok], Y[ok], IY[ok], TI[ok]

        # leave-one-year-out predictions
        cv = np.full(len(Y), np.nan)
        for yv in yrs:
            te = IY == yv
            if te.sum() == 0 or (~te).sum() < 100:
                continue
            cv[te] = ridge(X[~te], Y[~te], LAMBDA)(X[te])
        m = ~np.isnan(cv)
        resid = Y[m] - cv[m]
        resid_by_h[h] = resid
        mae_model = float(np.mean(np.abs(resid)))
        mae_clim = float(np.mean(np.abs(Y[m])))

        # critical-week warnings: chance of exceeding the 90th percentile, judged on held-out years
        q = np.quantile(resid, [0.1, 0.5, 0.9])
        thr = np.array([clim_lo[IY[j]][1][woy[TI[j]]] - clim_lo[IY[j]][0][woy[TI[j]]] for j in np.where(m)[0]])
        p_crit = np.array([np.mean(cv[j] + resid > t_) for j, t_ in zip(np.where(m)[0], thr)])
        was_crit = Y[m] > thr
        warn = p_crit >= 0.3
        hits = int((warn & was_crit).sum())
        skill.append({
            "h": h,
            "mae_model": round(mae_model, 3),
            "mae_clim": round(mae_clim, 3),
            "improvement": round(1 - mae_model / mae_clim, 3) if mae_clim > 0 else None,
            "critical_weeks": int(was_crit.sum()),
            "warned": hits,
            "false_alarms": int((warn & ~was_crit).sum()),
        })

        if h == 4:
            for j in np.where(m)[0]:
                ti = TI[j]
                base = clim_lo[IY[j]][0][woy[ti]]
                hind[int(ti)] = [round(float(np.expm1(base + cv[j] + q[0])), 1), round(float(np.expm1(base + cv[j])), 1),
                                 round(float(np.expm1(base + cv[j] + q[2])), 1)]

        # the real forecast, from the latest week, with every year in the fit
        f = ridge(X, Y, LAMBDA)
        i = N - 1
        target_end = ends[i] + dt.timedelta(days=7 * h)
        twoy = woy_of(target_end)
        p = float(f(np.array([features(anom, i, oni_v[i], twoy, dry_at(i))]))[0])
        base, crit = clim_all[0][twoy], clim_all[1][twoy]
        dist = base + p + resid
        out_weeks.append({
            "end": target_end.isoformat(),
            "p10": round(float(np.expm1(base + p + q[0])), 1),
            "p50": round(float(np.expm1(base + p)), 1),
            "p90": round(float(np.expm1(base + p + q[2])), 1),
            "normal": round(float(np.expm1(base)), 1),
            "critical": round(float(np.expm1(crit)), 1),
            "p_above": round(float(np.mean(dist > base)), 2),
            "p_critical": round(float(np.mean(dist > crit)), 2),
        })

    # recent observed weeks (half a year) and the lead-4 hindcast for every week
    recent = [{"end": ends[k].isoformat(), "obs": None if np.isnan(w[k]) else round(float(w[k]), 1),
               "normal": round(float(np.expm1(clim_all[0][woy[k]])), 1), "critical": round(float(np.expm1(clim_all[1][woy[k]])), 1)}
              for k in range(max(0, N - 26), N)]
    hindcast = {"lead_weeks": 4, "start": ends[0].isoformat(), "obs": [None if np.isnan(v) else round(float(v), 1) for v in w],
                "pred": [hind.get(k) for k in range(N)],
                "normal": [round(float(np.expm1(normal_cv[k])), 1) if not np.isnan(normal_cv[k]) else None for k in range(N)]}

    # this month so far against the same days of the month in every other year
    today = last
    m0 = dt.date(today.year, today.month, 1)
    n_days = (today - m0).days + 1
    totals = {}
    for yv in range(start.year, today.year + 1):
        a = (dt.date(yv, today.month, 1) - start).days
        seg = harm[a: a + n_days] if a >= 0 else np.array([])
        if len(seg) == n_days and (~np.isnan(seg)).sum() >= n_days * 0.8:
            totals[yv] = float(np.nanmean(seg) * n_days)
    others = [v for k, v in totals.items() if k != today.year]
    cur = totals.get(today.year)
    mtd = None
    if cur is not None and others:
        mtd = {"month": today.strftime("%Y-%m"), "days": n_days, "total": round(cur), "median": round(float(np.median(others))),
               "rank": 1 + sum(v > cur for v in others), "years": len(others) + 1}

    return {
        "issued": last.isoformat(),
        "weeks": out_weeks,
        "recent": recent,
        "skill": skill,
        "hindcast": hindcast,
        "month_to_date": mtd,
        "oni_now": oni_at[-1]["anom"] if oni_at[-1] else None,
        "drought": drought,
        "season": season_timing(w, ends, out_weeks, clim_all[0]),
    }


# ------------------------------------------------------------------ season timing

def smooth3(a):
    out = np.full(len(a), np.nan)
    for k in range(len(a)):
        seg = a[max(0, k - 1): k + 2]
        seg = seg[~np.isnan(seg)]
        if len(seg):
            out[k] = seg.mean()
    return out


def season_timing(w, ends, fc_weeks, clim_med):
    """When the fire season starts and ends.

    The season is the stretch of weeks when burning (3-week average) is above the region's average
    week across the whole record. History gives each past season's start and end; the forecast's
    expected, low and high paths give the coming start or end with a range."""
    T = float(np.nanmean(w))
    sm = smooth3(w)
    woy = np.array([woy_of(e) for e in ends])
    peak_woy = int(np.nanargmax(np.expm1(clim_med)))

    # past seasons: in each year-long window centred on the usual peak, the run above T around the max
    hist = []
    k = 0
    N = len(w)
    centres = [i for i in range(N) if woy[i] == peak_woy]
    for c in centres:
        a, b = max(0, c - 26), min(N, c + 26)
        seg = sm[a:b]
        if np.all(np.isnan(seg)) or np.nanmax(seg) < T:
            continue
        m = a + int(np.nanargmax(seg))
        s0 = m
        while s0 - 1 >= a and sm[s0 - 1] >= T:
            s0 -= 1
        e0 = m
        while e0 + 1 < b and sm[e0 + 1] >= T:
            e0 += 1
        if e0 + 1 >= N:  # still running at the end of the record
            continue
        hist.append({"season": ends[m].year, "start": (ends[s0] - dt.timedelta(days=6)).isoformat(), "end": ends[e0].isoformat(),
                     "peak": ends[m].isoformat(), "weeks": int(e0 - s0 + 1)})
    # typical dates as week-of-year offsets from the usual peak
    def offset(d, ref_woy):
        return ((woy_of(dt.date.fromisoformat(d)) - ref_woy + 26) % 52) - 26
    so = [offset(h["start"], peak_woy) for h in hist]
    eo = [offset(h["end"], peak_woy) for h in hist]
    typical = {"start_woy": int((peak_woy + np.median(so)) % 52) if so else None,
               "end_woy": int((peak_woy + np.median(eo)) % 52) if eo else None,
               "start_spread_weeks": round(float(np.subtract(*np.percentile(so, [75, 25]))) / 2, 1) if so else None,
               "end_spread_weeks": round(float(np.subtract(*np.percentile(eo, [75, 25]))) / 2, 1) if eo else None,
               "peak_woy": peak_woy}

    # the coming season from the forecast paths
    recent = sm[-3:]
    in_season = bool(np.nanmean(recent) >= T)
    paths = {}
    for key in ("p50", "p10", "p90"):
        series = np.concatenate([w[-2:], [x[key] for x in fc_weeks]])
        paths[key] = smooth3(series)[2:]

    def first_cross(path, above):
        for j in range(len(path) - 1):
            ok = (path[j] >= T and path[j + 1] >= T) if above else (path[j] < T and path[j + 1] < T)
            if ok:
                return j
        return None

    def wk(j):
        return None if j is None else fc_weeks[j]["end"]

    if in_season:
        # ends sooner if burning is lower (p10), later if higher (p90)
        j50, jlo, jhi = first_cross(paths["p50"], False), first_cross(paths["p10"], False), first_cross(paths["p90"], False)
        current = {"status": "in_season", "event": "end", "expected": wk(j50), "earliest": wk(jlo), "latest": wk(jhi)}
    else:
        # starts sooner if burning is higher (p90), later if lower (p10)
        j50, jlo, jhi = first_cross(paths["p50"], True), first_cross(paths["p90"], True), first_cross(paths["p10"], True)
        current = {"status": "off_season", "event": "start", "expected": wk(j50), "earliest": wk(jlo), "latest": wk(jhi)}
        if j50 is not None:
            je = first_cross(paths["p50"][j50:], False)
            current["then_ends"] = wk(None if je is None else j50 + je)
    return {"threshold": round(T, 1), "typical": typical, "current": current, "history": hist[-26:]}


# ------------------------------------------------------------------ haze outlook (Southeast Asia)

# where the smoke has to travel: the wind direction (blowing FROM, degrees) that carries smoke
# from each source towards Peninsular Malaysia and Singapore, +/-45 degrees
HAZE_SOURCES = {"sumatra": 200, "kalimantan": 120}


def haze_outlook(daily, start, regions_fc, weather):
    """Haze potential for Peninsular Malaysia and Singapore, week by week.

    For each source (Sumatra, Kalimantan), fire detections are weighted by the share of days the wind
    blew towards the Peninsula and Singapore. In the past this uses each week's actual wind; ahead it
    uses the usual wind for that time of year. The index is ranked against every week of the record,
    so 'high' means a top-10% week. It is a potential for smoke to arrive, not an air-quality forecast."""
    def wind_ok(rid):
        wd = np.array([np.nan if v is None else v for v in weather["regions"][rid]["wd"]], float)
        want = HAZE_SOURCES[rid]
        diff = np.abs(((wd - want + 180) % 360) - 180)
        return np.where(np.isnan(wd), np.nan, (diff <= 45).astype(float))

    w0s = weather["regions"]["sumatra"]["start"]
    w0 = dt.date(int(w0s[:4]), int(w0s[4:6]), int(w0s[6:]))
    issued = dt.date.fromisoformat(regions_fc["study_area"]["issued"])
    contrib_hist, ends_hist = None, None
    usual = {}
    for rid in HAZE_SOURCES:
        harm = np.array([np.nan if v is None else v for v in daily["regions"][rid]["series"]["harm"]], float)
        ok = wind_ok(rid)
        # align wind to the fire record's days
        off = (start - w0).days
        n = (issued - start).days + 1
        okd = np.array([ok[off + k] if 0 <= off + k < len(ok) else np.nan for k in range(n)])
        fire = harm[:n]
        Wn = n // 7
        o = n - Wn * 7
        wk_fire = np.array([np.nansum(fire[o + 7 * j: o + 7 * j + 7]) for j in range(Wn)])
        wk_ok = np.array([np.nanmean(okd[o + 7 * j: o + 7 * j + 7]) if np.any(~np.isnan(okd[o + 7 * j: o + 7 * j + 7])) else np.nan for j in range(Wn)])
        ends = [start + dt.timedelta(days=o + 7 * j + 6) for j in range(Wn)]
        woy = np.array([woy_of(e) for e in ends])
        usual[rid] = np.array([np.nanmean(wk_ok[np.abs(((woy - k + 26) % 52) - 26) <= 1]) for k in range(52)])
        c = wk_fire * np.where(np.isnan(wk_ok), usual[rid][woy], wk_ok)
        contrib_hist = c if contrib_hist is None else contrib_hist + c
        ends_hist = ends
    idx_hist = contrib_hist
    ranked = np.sort(idx_hist[~np.isnan(idx_hist)])

    def level(v):
        pct = 100 * np.searchsorted(ranked, v) / len(ranked)
        return pct, ("very_high" if pct >= 97 else "high" if pct >= 90 else "moderate" if pct >= 70 else "low")

    weeks = []
    for k, wkf in enumerate(regions_fc["sumatra"]["weeks"]):
        end = dt.date.fromisoformat(wkf["end"])
        wy = woy_of(end)
        vals = {}
        for key in ("p10", "p50", "p90"):
            vals[key] = sum(regions_fc[rid]["weeks"][k][key] * usual[rid][wy] for rid in HAZE_SOURCES)
        pct, lv = level(vals["p50"])
        _, lv_hi = level(vals["p90"])
        weeks.append({"end": wkf["end"], "index": round(vals["p50"]), "low": round(vals["p10"]), "high": round(vals["p90"]),
                      "pct": round(pct), "level": lv, "level_if_high": lv_hi,
                      "wind_share": {rid: round(float(usual[rid][wy]), 2) for rid in HAZE_SOURCES}})
    # history check: the worst haze-potential weeks in the record, by year
    order = np.argsort(-np.nan_to_num(idx_hist))
    top_years = []
    for j in order:
        y = ends_hist[j].year
        if y not in [t["year"] for t in top_years]:
            top_years.append({"year": y, "week": ends_hist[j].isoformat(), "index": round(float(idx_hist[j]))})
        if len(top_years) >= 6:
            break
    recent = [{"end": ends_hist[j].isoformat(), "index": round(float(idx_hist[j])), "level": level(idx_hist[j])[1]}
              for j in range(max(0, len(idx_hist) - 26), len(idx_hist))]
    return {"receptor": "Peninsular Malaysia and Singapore", "sources": list(HAZE_SOURCES), "weeks": weeks, "recent": recent,
            "worst_years": top_years, "levels": {"moderate": float(np.percentile(ranked, 70)), "high": float(np.percentile(ranked, 90)),
                                                 "very_high": float(np.percentile(ranked, 97))}}


def risk_map(path, regions_fc):
    """Where the forecast fire is likely to be: each region's forecast shared out over its grid cells.

    A cell's share is mostly its usual share of the region's detections at that time of year
    (from the whole record), blended with its share over the last 8 weeks, so a fire season that
    has started somewhere unusual still shows there. The totals come from the validated regional
    forecast; the map adds where, not a separate prediction.
    """
    meta = json.load(open(os.path.join(path, "meta.json")))
    grid = json.load(open(os.path.join(path, "grid.json")))
    start = dt.date.fromisoformat(grid["start"])
    W, C = grid["weeks"], len(grid["cells"])
    V = np.zeros((W, C))
    for w, row in enumerate(grid["data"]):
        for k in range(0, len(row), 2):
            V[w, row[k]] = row[k + 1]
    week_end = [start + dt.timedelta(days=7 * w + 6) for w in range(W)]
    woy = np.array([woy_of(e) for e in week_end])
    region_ids = [r["id"] for r in meta["regions"]]
    cell_region = np.array([c[2] for c in grid["cells"]])
    rid_of = lambda ri: region_ids[ri] if 0 <= ri < len(region_ids) and region_ids[ri] in regions_fc else "outside"
    cell_rid = np.array([rid_of(ri) for ri in cell_region])

    # usual weekly detections per cell for each week of the year (mean, so shares add up)
    clim = np.zeros((52, C))
    complete = np.array([e <= dt.date.fromisoformat(regions_fc["study_area"]["issued"]) for e in week_end])
    for k in range(52):
        sel = (np.abs(((woy - k + 26) % 52) - 26) <= 1) & complete
        clim[k] = V[sel].mean(0)
    last = np.where(complete)[0][-1]
    recent = V[last - 7: last + 1].sum(0)

    periods = [("Next 4 weeks", 0, 4), ("Weeks 5 to 8", 4, 8), ("Weeks 9 to 13", 8, 13)]
    out_periods = []
    for label, a, b in periods:
        exp_c = np.zeros(C)
        norm_c = np.zeros(C)
        for rid in set(cell_rid):
            m = cell_rid == rid
            # cells outside every named region follow the whole area's departure from normal
            weeks = regions_fc["study_area" if rid == "outside" else rid]["weeks"][a:b]
            rec_tot = recent[m].sum()
            for wk in weeks:
                k = woy_of(dt.date.fromisoformat(wk["end"]))
                cn = clim[k, m]
                tot = cn.sum()
                if rid == "outside":
                    exp_c[m] += cn * (wk["p50"] / wk["normal"] if wk["normal"] > 0 else 1.0)
                    norm_c[m] += cn
                    continue
                share = cn / tot if tot > 0 else np.full(m.sum(), 1 / m.sum())
                if rec_tot > 0:
                    share = 0.75 * share + 0.25 * recent[m] / rec_tot
                exp_c[m] += wk["p50"] * share
                norm_c[m] += cn
        n = b - a
        vals = [[int(ci), round(float(exp_c[ci] / n), 1), round(float(norm_c[ci] / n), 1)]
                for ci in range(C) if exp_c[ci] / n >= 0.5 or norm_c[ci] / n >= 0.5]
        out_periods.append({"label": label, "from": regions_fc["study_area"]["weeks"][a]["end"],
                            "to": regions_fc["study_area"]["weeks"][b - 1]["end"], "cells": vals})
    return {"note": "regional forecast shared out by each cell's usual and recent share; weekly averages",
            "periods": out_periods}


def build(path, oni, weather=None, sid="sea"):
    daily = json.load(open(os.path.join(path, "daily.json")))
    start = dt.date.fromisoformat(daily["start"])
    out = {"generated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), "horizon_weeks": H, "regions": {}}
    no_enso = [dict(o, anom=0.0) for o in oni]
    for rid, reg in daily["regions"].items():
        wx = weather["regions"].get(rid) if weather else None
        r = forecast_region(reg["series"], start, oni, wx)
        # the same model without each outside input, to show what it adds
        r0 = forecast_region(reg["series"], start, no_enso, wx)
        for s_, s0 in zip(r["skill"], r0["skill"]):
            s_["improvement_without_enso"] = s0["improvement"]
        if wx is not None:
            r1 = forecast_region(reg["series"], start, oni, None)
            for s_, s1 in zip(r["skill"], r1["skill"]):
                s_["improvement_without_drought"] = s1["improvement"]
        out["regions"][rid] = r
        s4, s8 = r["skill"][3], r["skill"][7]
        cur = r["season"]["current"]
        print(f"  {rid}: lead-4 {s4['improvement']:+.0%} (no drought {s4.get('improvement_without_drought', float('nan')):+.0%}), "
              f"lead-8 {s8['improvement']:+.0%} (no drought {s8.get('improvement_without_drought', float('nan')):+.0%}); "
              f"rain 90d {r['drought']['rain_90d_pct'] if r['drought'] else '-'}%; season {cur['status']} -> {cur['event']} {cur['expected']} "
              f"[{cur['earliest']}..{cur['latest']}]", flush=True)
    out["map"] = risk_map(path, out["regions"])
    if sid == "sea" and weather and all(k in weather["regions"] for k in HAZE_SOURCES):
        out["haze"] = haze_outlook(daily, start, out["regions"], weather)
        print("  haze: worst years", [t["year"] for t in out["haze"]["worst_years"]],
              "| next 4 weeks", [w_["level"] for w_ in out["haze"]["weeks"][:4]], flush=True)
    if weather:
        out["weather_source"] = weather.get("source")
    last = oni[-1]
    out["oni"] = {
        "source": "NOAA CPC Oceanic Nino Index (ERSSTv5)",
        "latest": {"season": last["season"], "year": last["year"], "anom": last["anom"]},
        "series": [[f"{r['season']} {r['year']}", r["anom"]] for r in oni[-36:]],
    }
    with open(os.path.join(path, "forecast.json"), "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("  wrote", round(os.path.getsize(os.path.join(path, "forecast.json")) / 1e3), "KB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--oni", default=ONI_URL)
    ap.add_argument("--weather", help="folder with weather_<sector>.json from pull_weather.py (drought input and haze)")
    ap.add_argument("--sectors", help="comma-separated sector ids (default: all)")
    args = ap.parse_args()
    oni = load_oni(args.oni)
    print(f"ONI: {len(oni)} seasons, latest {oni[-1]['season']} {oni[-1]['year']} = {oni[-1]['anom']:+.2f}")
    paths = [("sea", DATA)] + [(d, os.path.join(DATA, "sectors", d)) for d in sorted(os.listdir(os.path.join(DATA, "sectors")))]
    want = set(args.sectors.split(",")) if args.sectors else None
    for sid, p in paths:
        if want and sid not in want:
            continue
        if not os.path.exists(os.path.join(p, "daily.json")):
            continue
        wf = os.path.join(args.weather, f"weather_{sid}.json") if args.weather else None
        weather = json.load(open(wf)) if wf and os.path.exists(wf) else None
        print(sid, "(with rainfall)" if weather else "(no rainfall data)", flush=True)
        build(p, oni, weather, sid)


if __name__ == "__main__":
    main()
