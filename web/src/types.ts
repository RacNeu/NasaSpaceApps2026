export interface RegionMeta {
  id: string;
  name: string;
  color: string;
  polygon: [number, number][] | null;
}

export interface Calibration {
  snpp_to_noaa20: number;
  raw_viirs_to_modis_ratio: number | null;
  beta: number[];
  median_abs_log_error: number;
  cv_r2_log: number | null;
  cv_coverage_80: number;
  n_windows: number;
  mean_frp_mw: Record<string, number>;
}

export interface Validation {
  annual: { year: number; observed: number; predicted: number }[];
  scatter: [number, number, number][]; // year, observed 7-day total, cross-validated prediction
}

export interface FireEvent {
  start: string;
  end: string;
  peak: string;
  total: number;
  times_normal: number | null;
}

export interface Meta {
  generated: string;
  box: [number, number, number, number];
  cell: number;
  nx: number;
  ny: number;
  start: string;
  end: string;
  days: number;
  regions: RegionMeta[];
  sensors: Record<string, { label: string; first: string }>;
  calibration: Record<string, Calibration>;
  validation: Record<string, Validation>;
  events: FireEvent[];
  /** Present for the country-level sectors; absent for the detailed Southeast Asia sector. */
  sector?: { id: string; name: string; detailed: boolean; story: string };
}

export interface Series {
  modis: Float32Array;
  snpp: Float32Array;
  noaa20: Float32Array;
  harm: Float32Array;
  lo: Float32Array;
  hi: Float32Array;
  src: Uint8Array; // 0 none, 1 observed by VIIRS, 2 estimated from MODIS
  pct: Float32Array;
  norm: Float32Array; // typical detections per day for this time of year (other years)
  norm90: Float32Array;
}

export interface Daily {
  start: string;
  days: number;
  regions: Record<string, Series>;
}

export interface Grid {
  start: string;
  weeks: number;
  cells: [number, number, number][]; // cx, cy, region index
  data: number[][]; // per week: [cellIndex, count, cellIndex, count, ...]
}

export interface Dataset {
  meta: Meta;
  daily: Daily;
  grid: Grid;
}

/** One day of individual detections inside a small window. */
export interface DemoDay {
  id: string;
  date: string;
  box: [number, number, number, number]; // west, south, east, north
  modis: number[][]; // lon, lat, minute of day (UTC), FRP (MW), scan size (km), 1 = Aqua / 0 = Terra
  viirs: number[][]; // lon, lat, minute of day (UTC), FRP (MW)
}

interface HeadlineRate {
  n: number;
  rate: number;
  n_covered: number;
  rate_covered: number;
}

export interface Matching {
  radii_km: number[];
  times_min: number[];
  periods: { label: string; year: number; modis_aqua: number; modis_terra: number; viirs_noaa20: number }[];
  sweep: { period: string; satellite: string; radius_km: number; dt_min: number; rate: number; n: number }[];
  offsets: Record<string, { bins: number[]; counts: number[] }>;
  frp: {
    bins_mw: string[];
    viirs_total: number[];
    viirs_seen_by_modis: number[];
    modis_total: number[];
    modis_seen_by_viirs: number[];
    viirs_seen_by_modis_covered?: number[];
    modis_seen_by_viirs_covered?: number[];
  };
  area_ratio: number;
  headline: {
    radius_km: number;
    dt_min: number;
    by_year?: Record<string, { aqua_in_viirs?: HeadlineRate; viirs_in_aqua?: HeadlineRate }>;
  };
}

export interface Extras {
  matching: Matching;
  demos: DemoDay[];
}
