import type { Dataset, Daily, Series } from "./types";

export async function loadExtras(): Promise<import("./types").Extras> {
  const base = import.meta.env.BASE_URL;
  const [matching, demo] = await Promise.all([
    fetch(`${base}data/matching.json`).then((r) => r.json()),
    fetch(`${base}data/demo_hotspots.json`).then((r) => r.json()),
  ]);
  return { matching, demos: demo.demos };
}

const toF32 =(a: (number | null)[]) => Float32Array.from(a, (v) => (v === null ? NaN : v));

export async function loadDataset(): Promise<Dataset> {
  const base = import.meta.env.BASE_URL;
  const [meta, dailyRaw, grid] = await Promise.all([
    fetch(`${base}data/meta.json`).then((r) => r.json()),
    fetch(`${base}data/daily.json`).then((r) => r.json()),
    fetch(`${base}data/grid.json`).then((r) => r.json()),
  ]);
  const regions: Daily["regions"] = {};
  for (const [id, r] of Object.entries<any>(dailyRaw.regions)) {
    const s = r.series;
    const series: Series = {
      modis: toF32(s.modis),
      snpp: toF32(s.snpp),
      noaa20: toF32(s.noaa20),
      harm: toF32(s.harm),
      lo: toF32(s.lo),
      hi: toF32(s.hi),
      src: Uint8Array.from(s.src),
      pct: toF32(s.pct),
      norm: toF32(s.norm),
      norm90: toF32(s.norm90),
    };
    regions[id] = series;
  }
  return { meta, grid, daily: { start: dailyRaw.start, days: dailyRaw.days, regions } };
}
