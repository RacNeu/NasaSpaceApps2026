import type { Dataset, Daily, Extras, Series } from "./types";

const toF32 = (a: (number | null)[]) => Float32Array.from(a, (v) => (v === null ? NaN : v));

/** The data files the console needs, with a plain description of each for the loading screen. */
export const DATA_FILES = [
  { key: "meta", file: "meta.json", label: "CALIBRATION AND EPISODES" },
  { key: "daily", file: "daily.json", label: "25-YEAR DAILY RECORD" },
  { key: "grid", file: "grid.json", label: "WEEKLY FIRE GRID · 0.5°" },
  { key: "matching", file: "matching.json", label: "SENSOR MATCHING · MODIS × VIIRS" },
  { key: "demo", file: "demo_hotspots.json", label: "DETECTION SAMPLES" },
] as const;

export type FileKey = (typeof DATA_FILES)[number]["key"];

/** Loads every data file, reporting each one as it actually arrives. */
export async function loadAll(onLoaded: (key: FileKey) => void): Promise<{ data: Dataset; extras: Extras }> {
  const base = import.meta.env.BASE_URL;
  const raw: Record<string, any> = {};
  await Promise.all(
    DATA_FILES.map(async (f) => {
      const r = await fetch(`${base}data/${f.file}`);
      if (!r.ok) throw new Error(`${f.file}: HTTP ${r.status}`);
      raw[f.key] = await r.json();
      onLoaded(f.key);
    }),
  );

  const regions: Daily["regions"] = {};
  for (const [id, r] of Object.entries<any>(raw.daily.regions)) {
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
  return {
    data: { meta: raw.meta, grid: raw.grid, daily: { start: raw.daily.start, days: raw.daily.days, regions } },
    extras: { matching: raw.matching, demos: raw.demo.demos },
  };
}
