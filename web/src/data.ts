import type { Dataset, Daily, Extras, Series } from "./types";

const toF32 = (a: (number | null)[]) => Float32Array.from(a, (v) => (v === null ? NaN : v));

/** The data files the console needs at start-up, with a plain description of each for the loading screen. */
export const DATA_FILES = [
  { key: "meta", file: "meta.json", label: "CALIBRATION AND EPISODES" },
  { key: "daily", file: "daily.json", label: "25-YEAR DAILY RECORD" },
  { key: "grid", file: "grid.json", label: "WEEKLY FIRE GRID · 0.5°" },
  { key: "matching", file: "matching.json", label: "SENSOR MATCHING · MODIS × VIIRS" },
  { key: "demo", file: "demo_hotspots.json", label: "DETECTION SAMPLES" },
] as const;

export type FileKey = (typeof DATA_FILES)[number]["key"];

/** One entry of data/sectors.json. */
export interface SectorEntry {
  id: string;
  name: string;
  short: string;
  group: string;
  /** Folder of the sector's meta, daily and grid files, relative to the site root. */
  path: string;
  /** The detailed sector has sub-regions, detection matching and demo days. */
  detailed: boolean;
  box: [number, number, number, number];
  story: string;
  countries?: string[];
}

const SEA_FALLBACK: SectorEntry = {
  id: "sea",
  name: "Southeast Asia: Malaysia, Sumatra and Borneo",
  short: "Southeast Asia",
  group: "Asia",
  path: "data/",
  detailed: true,
  box: [95, -6, 120, 8],
  story: "Peat and land-clearing fires whose haze reaches Malaysia and Singapore.",
};

function toDataset(meta: any, dailyRaw: any, grid: any): Dataset {
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

async function getJson(url: string) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url.split("/").slice(-2).join("/")}: HTTP ${r.status}`);
  return r.json();
}

/** Loads the default sector and the shared extras, reporting each file as it actually arrives. */
export async function loadAll(onLoaded: (key: FileKey) => void): Promise<{ data: Dataset; extras: Extras; sectors: SectorEntry[] }> {
  const base = import.meta.env.BASE_URL;
  const raw: Record<string, any> = {};
  const [, index] = await Promise.all([
    Promise.all(
      DATA_FILES.map(async (f) => {
        raw[f.key] = await getJson(`${base}data/${f.file}`);
        onLoaded(f.key);
      }),
    ),
    // the sector list is optional: without it the console simply offers Southeast Asia
    fetch(`${base}data/sectors.json`)
      .then((r) => (r.ok && (r.headers.get("content-type") ?? "").includes("json") ? r.json() : null))
      .catch(() => null),
  ]);
  const sectors: SectorEntry[] = index?.sectors?.length ? index.sectors : [SEA_FALLBACK];
  return {
    data: toDataset(raw.meta, raw.daily, raw.grid),
    extras: { matching: raw.matching, demos: raw.demo.demos },
    sectors,
  };
}

/** Loads one sector's record on demand. */
export async function loadSector(s: SectorEntry): Promise<Dataset> {
  const base = `${import.meta.env.BASE_URL}${s.path}`;
  const [meta, daily, grid] = await Promise.all([getJson(`${base}meta.json`), getJson(`${base}daily.json`), getJson(`${base}grid.json`)]);
  return toDataset(meta, daily, grid);
}
