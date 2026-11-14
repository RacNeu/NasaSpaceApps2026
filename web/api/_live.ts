/**
 * Near-real-time fire detections for the study area, from NASA FIRMS.
 *
 * Runs on the server only (a Vercel function, or the Vite dev server locally), so the FIRMS
 * MAP_KEY never reaches the browser. Fetches the last seven complete UTC days plus today for
 * NOAA-20 and NOAA-21 VIIRS, keeps nominal and high confidence detections (the same rule as the
 * archive), and aggregates them to a 0.1 degree grid per day so the response stays small even in
 * a bad fire week.
 *
 * Files in api/ that start with an underscore are not exposed as routes by Vercel.
 */

/** Sector boxes the feed may be asked for (west, south, east, north). Mirrors pipeline/sectors.py. */
export const SECTOR_BOXES: Record<string, readonly [number, number, number, number]> = {
  sea: [95, -6, 120, 8],
  mainland_sea: [92, 5, 110, 29],
  australia: [112, -44, 154, -10],
  brazil: [-74, -34, -34, 6],
  united_states: [-170, 18, -65, 72],
  canada: [-141, 41, -52, 84],
};
const CELL = 0.1;
const SOURCES = [
  ["noaa20", "VIIRS_NOAA20_NRT"],
  ["noaa21", "VIIRS_NOAA21_NRT"],
] as const;
const CACHE_MS = 15 * 60 * 1000;

export interface LivePayload {
  fetchedAt: string;
  /** Eight UTC days: seven complete days, then today (partial). */
  days: string[];
  cell: number;
  /** [lon, lat, dayIndex, sensor (0 = NOAA-20, 1 = NOAA-21), detections, total FRP in MW] */
  cells: [number, number, number, number, number, number][];
  perDay: { noaa20: number[]; noaa21: number[] };
  latest: { noaa20: string | null; noaa21: string | null };
  errors: string[];
  cached?: boolean;
}

const cache = new Map<string, { at: number; data: LivePayload }>();

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);

async function fetchCsv(key: string, source: string, BOX: readonly number[], start: string, range: number) {
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${source}/${BOX.join(",")}/${range}/${start}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(25_000) });
  const text = await r.text();
  if (!r.ok || !text.startsWith("latitude")) {
    // never echo the key back to the caller
    throw new Error(`${source} ${start}: ${text.slice(0, 120).split(key).join("[key]").trim() || `HTTP ${r.status}`}`);
  }
  return text;
}

export async function getLive(key: string, sector = "sea", now = new Date()): Promise<LivePayload> {
  const BOX = SECTOR_BOXES[sector];
  if (!BOX) throw new Error(`unknown sector: ${sector}`);
  const hit = cache.get(sector);
  if (hit && Date.now() - hit.at < CACHE_MS) return { ...hit.data, cached: true };

  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const start = addDays(today, -7);
  const days = Array.from({ length: 8 }, (_, i) => iso(addDays(start, i)));
  // FIRMS returns at most five days per request, so two non-overlapping windows cover the eight days
  const windows: [string, number][] = [
    [iso(start), 5],
    [iso(addDays(today, -2)), 3],
  ];

  const agg = new Map<string, [number, number, number, number, number, number]>();
  const perDay = { noaa20: new Array(8).fill(0), noaa21: new Array(8).fill(0) };
  const latest: LivePayload["latest"] = { noaa20: null, noaa21: null };
  const errors: string[] = [];
  let okCalls = 0;

  await Promise.all(
    SOURCES.flatMap(([sk, src], si) =>
      windows.map(async ([d, n]) => {
        let text: string;
        try {
          text = await fetchCsv(key, src, BOX, d, n);
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
          return;
        }
        okCalls++;
        const lines = text.trim().split(/\r?\n/);
        const h = lines[0].split(",");
        const col = (c: string) => h.indexOf(c);
        const iLat = col("latitude"), iLon = col("longitude"), iDate = col("acq_date"), iTime = col("acq_time"), iConf = col("confidence"), iFrp = col("frp");
        for (let k = 1; k < lines.length; k++) {
          const f = lines[k].split(",");
          const conf = f[iConf];
          if (conf !== "n" && conf !== "h" && conf !== "nominal" && conf !== "high") continue;
          const di = days.indexOf(f[iDate]);
          if (di < 0) continue;
          const lat = Number(f[iLat]);
          const lon = Number(f[iLon]);
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
          const frp = Number(f[iFrp]) || 0;
          const cx = Math.floor((lon - BOX[0]) / CELL);
          const cy = Math.floor((lat - BOX[1]) / CELL);
          const key2 = `${cx},${cy},${di},${si}`;
          const a = agg.get(key2);
          if (a) {
            a[4] += 1;
            a[5] += frp;
          } else {
            agg.set(key2, [+(BOX[0] + (cx + 0.5) * CELL).toFixed(2), +(BOX[1] + (cy + 0.5) * CELL).toFixed(2), di, si, 1, frp]);
          }
          perDay[sk][di] += 1;
          const hhmm = f[iTime].padStart(4, "0");
          const t = `${f[iDate]}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`;
          if (!latest[sk] || t > latest[sk]!) latest[sk] = t;
        }
      }),
    ),
  );

  if (okCalls === 0) throw new Error(errors[0] ?? "FIRMS returned no data");

  const data: LivePayload = {
    fetchedAt: new Date().toISOString(),
    days,
    cell: CELL,
    cells: [...agg.values()].map((c) => [c[0], c[1], c[2], c[3], c[4], Math.round(c[5] * 10) / 10]),
    perDay,
    latest,
    errors,
  };
  cache.set(sector, { at: Date.now(), data });
  return data;
}

/* ------------------------------------------------------------------ whole world */

const WORLD_CELL = 0.5;
const WORLD_CACHE_MS = 30 * 60 * 1000;

export interface WorldPayload {
  fetchedAt: string;
  /** The UTC days covered, oldest first; the last one is usually still filling in. */
  days: string[];
  cell: number;
  /** [lon, lat, detections over all days, detections on the newest day, total FRP in MW] */
  cells: [number, number, number, number, number][];
  perDay: number[];
  latest: string | null;
  errors: string[];
  cached?: boolean;
}

let worldCache: { at: number; data: WorldPayload } | null = null;

/**
 * The last two days of NOAA-20 and NOAA-21 detections for the whole planet, on a 0.5 degree grid.
 * That is about 150,000 detections; aggregated it is a few thousand cells, small enough to draw
 * every one as a column on the globe.
 */
export async function getWorld(key: string): Promise<WorldPayload> {
  if (worldCache && Date.now() - worldCache.at < WORLD_CACHE_MS) return { ...worldCache.data, cached: true };
  const agg = new Map<number, [number, number, number, number, number, string]>();
  const perDayMap = new Map<string, number>();
  let latest: string | null = null;
  const errors: string[] = [];
  let okCalls = 0;

  await Promise.all(
    SOURCES.map(async ([, src]) => {
      let text: string;
      try {
        const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${src}/world/2`;
        const r = await fetch(url, { signal: AbortSignal.timeout(40_000) });
        text = await r.text();
        if (!r.ok || !text.startsWith("latitude")) throw new Error(`${src}: ${text.slice(0, 120).split(key).join("[key]").trim() || `HTTP ${r.status}`}`);
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
        return;
      }
      okCalls++;
      const lines = text.split("\n");
      const h = lines[0].trim().split(",");
      const iLat = h.indexOf("latitude"), iLon = h.indexOf("longitude"), iDate = h.indexOf("acq_date"), iTime = h.indexOf("acq_time"), iConf = h.indexOf("confidence"), iFrp = h.indexOf("frp");
      for (let k = 1; k < lines.length; k++) {
        const line = lines[k];
        if (!line) continue;
        const f = line.split(",");
        const conf = f[iConf];
        if (conf !== "n" && conf !== "h") continue;
        const lat = Number(f[iLat]);
        const lon = Number(f[iLon]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        const date = f[iDate];
        perDayMap.set(date, (perDayMap.get(date) ?? 0) + 1);
        const hhmm = f[iTime].padStart(4, "0");
        const t = `${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2)}:00Z`;
        if (!latest || t > latest) latest = t;
        const cx = Math.min(719, Math.floor((lon + 180) / WORLD_CELL));
        const cy = Math.min(359, Math.floor((lat + 90) / WORLD_CELL));
        const id = cy * 720 + cx;
        const a = agg.get(id);
        const frp = Number(f[iFrp]) || 0;
        if (a) {
          a[2] += 1;
          a[4] += frp;
          if (date > a[5]) {
            a[5] = date;
            a[3] = 1;
          } else if (date === a[5]) a[3] += 1;
        } else agg.set(id, [-180 + (cx + 0.5) * WORLD_CELL, -90 + (cy + 0.5) * WORLD_CELL, 1, 1, frp, date]);
      }
    }),
  );
  if (okCalls === 0) throw new Error(errors[0] ?? "FIRMS returned no data");

  const days = [...perDayMap.keys()].sort();
  const newest = days[days.length - 1];
  const data: WorldPayload = {
    fetchedAt: new Date().toISOString(),
    days,
    cell: WORLD_CELL,
    // a cell's newest-day count only counts if that day is the world's newest day
    cells: [...agg.values()].map((c) => [c[0], c[1], c[2], c[5] === newest ? c[3] : 0, Math.round(c[4])]),
    perDay: days.map((d) => perDayMap.get(d) ?? 0),
    latest,
    errors,
  };
  worldCache = { at: Date.now(), data };
  return data;
}

export const isFeed = (s: string) => s === "world" || s in SECTOR_BOXES;
export const getFeed = (key: string, s: string) => (s === "world" ? getWorld(key) : getLive(key, s));
