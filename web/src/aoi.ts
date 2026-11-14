import type { Dataset, Series } from "./types";
import { dateAt, dayOfYear } from "./lib";

/** A user-selected area of interest, in degrees. */
export interface Aoi {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface AreaResult {
  series: Series;
  /** The selection snapped outward to whole 0.5 degree grid cells. */
  snapped: Aoi;
  /** Grid cells in the selection that recorded at least one detection in the record. */
  activeCells: number;
  totalCells: number;
}

/**
 * Build a harmonized series for any rectangle from the weekly 0.5 degree grid.
 *
 * The grid is already on the harmonized (VIIRS-equivalent) scale, so a custom area is the sum of
 * its cells. Values are weekly, spread evenly over the seven days. The anomaly percentile uses
 * the same rule as the fixed regions: each week is ranked against the same time of year
 * (+/-10 days) in every other year, never its own. No uncertainty band is computed for custom
 * areas, because the cross-validation was run per region, not per cell.
 */
export function buildAreaSeries(data: Dataset, box: Aoi): AreaResult | null {
  const { meta, grid, daily } = data;
  const [bw, bs] = meta.box;
  const c = meta.cell;
  const x0 = Math.max(0, Math.floor((Math.min(box.west, box.east) - bw) / c));
  const x1 = Math.min(meta.nx - 1, Math.floor((Math.max(box.west, box.east) - bw) / c));
  const y0 = Math.max(0, Math.floor((Math.min(box.south, box.north) - bs) / c));
  const y1 = Math.min(meta.ny - 1, Math.floor((Math.max(box.south, box.north) - bs) / c));
  if (x1 < x0 || y1 < y0) return null;

  const inside = new Uint8Array(grid.cells.length);
  let activeCells = 0;
  grid.cells.forEach(([cx, cy], i) => {
    if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) {
      inside[i] = 1;
      activeCells++;
    }
  });

  const T = daily.days;
  const W = grid.weeks;
  const study = daily.regions.study_area;
  const weekly = new Float32Array(W);
  const valid = new Uint8Array(W);
  const wYear = new Int16Array(W);
  const wDoy = new Int16Array(W);
  for (let w = 0; w < W; w++) {
    const row = grid.data[w] ?? [];
    let s = 0;
    for (let i = 0; i < row.length; i += 2) if (inside[row[i]]) s += row[i + 1];
    weekly[w] = s;
    for (let t = w * 7; t < Math.min(T, w * 7 + 7); t++) if (study.src[t] > 0) valid[w] = 1;
    const mid = dateAt(meta.start, Math.min(T - 1, w * 7 + 3));
    wYear[w] = mid.getUTCFullYear();
    wDoy[w] = dayOfYear(mid);
  }

  const pctW = new Float32Array(W).fill(NaN);
  const normW = new Float32Array(W).fill(NaN);
  const norm90W = new Float32Array(W).fill(NaN);
  const others: number[] = [];
  for (let w = 0; w < W; w++) {
    if (!valid[w]) continue;
    others.length = 0;
    for (let u = 0; u < W; u++) {
      if (!valid[u] || wYear[u] === wYear[w]) continue;
      const d = Math.abs(wDoy[u] - wDoy[w]);
      if (Math.min(d, 365 - d) <= 10) others.push(weekly[u]);
    }
    if (others.length < 20) continue;
    others.sort((a, b) => a - b);
    let le = 0;
    for (const v of others) if (v <= weekly[w]) le++;
    pctW[w] = (100 * le) / others.length;
    normW[w] = others[Math.floor(others.length / 2)] / 7;
    norm90W[w] = others[Math.min(others.length - 1, Math.floor(others.length * 0.9))] / 7;
  }

  const nan = () => new Float32Array(T).fill(NaN);
  const series: Series = {
    modis: nan(), snpp: nan(), noaa20: nan(), harm: nan(), lo: nan(), hi: nan(),
    src: new Uint8Array(T), pct: nan(), norm: nan(), norm90: nan(),
  };
  for (let t = 0; t < T; t++) {
    const w = Math.min(W - 1, Math.floor(t / 7));
    series.src[t] = study.src[t];
    if (study.src[t] === 0) continue;
    series.harm[t] = weekly[w] / 7;
    series.pct[t] = pctW[w];
    series.norm[t] = normW[w];
    series.norm90[t] = norm90W[w];
  }

  return {
    series,
    snapped: { west: bw + x0 * c, south: bs + y0 * c, east: bw + (x1 + 1) * c, north: bs + (y1 + 1) * c },
    activeCells,
    totalCells: (x1 - x0 + 1) * (y1 - y0 + 1),
  };
}

export const CUSTOM_ID = "custom";

/** Returns a copy of the dataset with the custom area added as one more region. */
export function withArea(data: Dataset, area: AreaResult | null): Dataset {
  if (!area) return data;
  return {
    ...data,
    meta: { ...data.meta, regions: [...data.meta.regions, { id: CUSTOM_ID, name: "Your area", color: "#ffffff", polygon: null }] },
    daily: { ...data.daily, regions: { ...data.daily.regions, [CUSTOM_ID]: area.series } },
  };
}
