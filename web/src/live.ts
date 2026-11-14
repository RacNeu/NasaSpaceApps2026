import { useCallback, useEffect, useState } from "react";
import type { Dataset, Series } from "./types";
import { dayOfYear, indexOf, levelFor, type Level } from "./lib";

/** What /api/firms returns. Mirrors api/_live.ts. */
export interface LivePayload {
  fetchedAt: string;
  days: string[];
  cell: number;
  cells: [number, number, number, number, number, number][];
  perDay: { noaa20: number[]; noaa21: number[] };
  latest: { noaa20: string | null; noaa21: string | null };
  errors: string[];
  cached?: boolean;
}

export type LiveState =
  | { status: "loading" }
  | { status: "ready"; payload: LivePayload }
  | { status: "unconfigured" }
  | { status: "error"; message: string };

/** Fetches the live feed once, with a manual refresh. */
export function useLiveFeed() {
  const [state, setState] = useState<LiveState>({ status: "loading" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}api/firms`);
      // a deployment without the function serves the app's HTML here instead of JSON
      const type = r.headers.get("content-type") ?? "";
      if (r.status === 404 || !type.includes("json")) return setState({ status: "unconfigured" });
      const body = await r.json();
      if (r.status === 503 && body.error === "not_configured") return setState({ status: "unconfigured" });
      if (!r.ok) return setState({ status: "error", message: body.message ?? `HTTP ${r.status}` });
      setState({ status: "ready", payload: body as LivePayload });
    } catch (e) {
      setState({ status: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  return { state, reload: load };
}

/* ---------------------------------------------------------------- comparing this week with the record */

const inPolygon = (x: number, y: number, poly: [number, number][]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
};

export interface RegionLive {
  id: string;
  name: string;
  color: string;
  /** NOAA-20 detections per day for the eight days (the last one is today, partial). */
  daily: number[];
  /** Total over the seven complete days. */
  week: number;
  /** Typical 7-day total for this time of year across the record (median). */
  normalWeek: number;
  /** 90th percentile of the same distribution. */
  highWeek: number;
  ratio: number;
  pct: number;
  level: Level;
  /** How many weekly totals from the record this week was ranked against. */
  sample: number;
}

/**
 * The 7-day totals the record holds for the same time of year: every year, every window ending
 * within ten days of the same date. The archive is on the NOAA-20 scale, like the live feed.
 */
function weeklyBaseline(s: Series, start: string, days: number, endDoy: number) {
  const vals: number[] = [];
  const y0 = Number(start.slice(0, 4));
  const y1 = y0 + Math.ceil(days / 365) + 1;
  for (let y = y0; y <= y1; y++) {
    const jan1 = indexOf(start, `${y}-01-01`);
    for (let off = -10; off <= 10; off++) {
      const end = jan1 + endDoy + off;
      if (end - 6 < 0 || end >= days) continue;
      let sum = 0;
      let ok = true;
      for (let i = end - 6; i <= end; i++) {
        const v = s.harm[i];
        if (Number.isNaN(v)) {
          ok = false;
          break;
        }
        sum += v;
      }
      if (ok) vals.push(sum);
    }
  }
  return vals.sort((a, b) => a - b);
}

export function summarizeLive(data: Dataset, p: LivePayload): { regions: RegionLive[]; study: RegionLive; gaps: number[] } {
  const named = data.meta.regions.filter((r) => r.polygon);
  const daily: Record<string, number[]> = {};
  for (const r of named) daily[r.id] = new Array(p.days.length).fill(0);

  // assign each 0.1 degree cell to a region by its centre, NOAA-20 only (the record's scale)
  const memo = new Map<string, string | null>();
  for (const [lon, lat, di, sensor, n] of p.cells) {
    if (sensor !== 0) continue;
    const k = `${lon},${lat}`;
    let rid = memo.get(k);
    if (rid === undefined) {
      rid = named.find((r) => inPolygon(lon, lat, r.polygon!))?.id ?? null;
      memo.set(k, rid);
    }
    if (rid) daily[rid][di] += n;
  }

  const endDate = new Date(`${p.days[p.days.length - 2]}T00:00:00Z`);
  const endDoy = dayOfYear(endDate);
  const make = (id: string, name: string, color: string, d: number[]): RegionLive => {
    const s = data.daily.regions[id];
    const base = weeklyBaseline(s, data.meta.start, data.daily.days, endDoy);
    const week = d.slice(0, 7).reduce((a, b) => a + b, 0);
    const normalWeek = base.length ? base[Math.floor(base.length / 2)] : NaN;
    const highWeek = base.length ? base[Math.min(base.length - 1, Math.floor(base.length * 0.9))] : NaN;
    let le = 0;
    for (const v of base) if (v <= week) le++;
    const pct = base.length ? (100 * le) / base.length : NaN;
    return { id, name, color, daily: d, week, normalWeek, highWeek, ratio: normalWeek > 0 ? week / normalWeek : NaN, pct, level: levelFor(pct), sample: base.length };
  };

  const regions = named.map((r) => make(r.id, r.name, r.color, daily[r.id]));
  const sum = p.days.map((_, i) => regions.reduce((a, r) => a + r.daily[i], 0));
  const study = make("study_area", "All four regions", "#ffffff", sum);
  // complete days on which NOAA-20 reported nothing at all over the whole box: probably an outage
  const gaps = p.perDay.noaa20.slice(0, 7).map((v, i) => (v === 0 ? i : -1)).filter((i) => i >= 0);
  return { regions, study, gaps };
}

export const TONE_COLOR: Record<Level["tone"], string> = {
  quiet: "#3b82c4",
  typical: "#8396ab",
  elevated: "#FF9D43",
  high: "#F0782F",
  extreme: "#F05A42",
};

export const ago = (iso: string | null, now = Date.now()) => {
  if (!iso) return "n/a";
  const mins = Math.round((now - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 48 ? `${h} h ago` : `${Math.round(h / 24)} days ago`;
};
