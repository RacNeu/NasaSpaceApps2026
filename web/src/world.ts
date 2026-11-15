import { useEffect, useState } from "react";
import type { SectorEntry } from "./data";
import { VIEW_BOX } from "./sectorViews";

/** The whole-world near-real-time feed served by /api/firms?sector=world. */
export interface WorldPayload {
  fetchedAt: string;
  days: string[];
  cell: number;
  /** [lon, lat, detections over all days, detections on the newest day, total FRP in MW] */
  cells: [number, number, number, number, number][];
  perDay: number[];
  latest: string | null;
  errors: string[];
}

interface CountryGridFile {
  cell: number;
  width: number;
  height: number;
  names: string[];
  rows: number[][];
}

export interface CountryGrid {
  names: string[];
  at: (lon: number, lat: number) => string | null;
}

/* ------------------------------------------------------------------ loading */

const REFRESH_MS = 30 * 60 * 1000;
let worldCache: { at: number; p: Promise<WorldPayload> } | null = null;
let gridCache: Promise<CountryGrid> | null = null;

function fetchWorld(): Promise<WorldPayload> {
  if (worldCache && Date.now() - worldCache.at < REFRESH_MS) return worldCache.p;
  const p = fetch("/api/firms?sector=world").then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !Array.isArray(j.cells)) throw new Error(j.error ?? `HTTP ${r.status}`);
    return j as WorldPayload;
  });
  worldCache = { at: Date.now(), p };
  p.catch(() => (worldCache = null));
  return p;
}

export function loadCountryGrid(): Promise<CountryGrid> {
  gridCache ??= fetch(`${import.meta.env.BASE_URL}data/countrygrid.json`)
    .then((r) => r.json() as Promise<CountryGridFile>)
    .then((g) => {
      const cells = new Int16Array(g.width * g.height);
      g.rows.forEach((row, y) => {
        let x = 0;
        for (let i = 0; i < row.length; i += 2) {
          cells.fill(row[i], y * g.width + x, y * g.width + x + row[i + 1]);
          x += row[i + 1];
        }
      });
      return {
        names: g.names,
        at: (lon: number, lat: number) => {
          const x = Math.min(g.width - 1, Math.max(0, Math.floor((lon + 180) / g.cell)));
          const y = Math.min(g.height - 1, Math.max(0, Math.floor((lat + 90) / g.cell)));
          const v = cells[y * g.width + x];
          return v >= 0 ? g.names[v] : null;
        },
      };
    });
  return gridCache;
}

export function useWorldFeed() {
  const [state, setState] = useState<{ world: WorldPayload | null; grid: CountryGrid | null; error: string | null }>({ world: null, grid: null, error: null });
  useEffect(() => {
    let alive = true;
    const load = () =>
      Promise.all([fetchWorld(), loadCountryGrid()])
        .then(([world, grid]) => alive && setState({ world, grid, error: null }))
        .catch((e) => alive && setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) })));
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);
  return state;
}

/* ------------------------------------------------------------------ the news */

export interface Headline {
  id: string;
  kicker: string;
  title: string;
  sub: string;
  lon: number;
  lat: number;
  zoom: number;
  /** Set when the place is inside one of the archive sectors, so it can be opened. */
  sectorId?: string;
  tone: "fire" | "amber" | "cyan";
}

export interface CountryStat {
  name: string;
  n: number;
  newest: number;
  frp: number;
  top: { lon: number; lat: number; v: number };
}

export interface WorldSummary {
  total: number;
  countries: CountryStat[];
  headlines: Headline[];
  /** Map features: one column per cell. */
  columns: GeoJSON.FeatureCollection;
  hours: number;
}

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const ll = (lon: number, lat: number) => `${Math.abs(lat).toFixed(1)}°${lat >= 0 ? "N" : "S"} ${Math.abs(lon).toFixed(1)}°${lon >= 0 ? "E" : "W"}`;
const RANK = ["", "MOST ACTIVE COUNTRY ON EARTH", "SECOND MOST ACTIVE", "THIRD MOST ACTIVE", "FOURTH MOST ACTIVE", "FIFTH MOST ACTIVE"];

const inBox = (lon: number, lat: number, b: readonly number[]) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];

export function summarizeWorld(world: WorldPayload, grid: CountryGrid, sectors: SectorEntry[], current?: string): WorldSummary {
  const byCountry = new Map<string, CountryStat>();
  const features: GeoJSON.Feature[] = [];
  const half = world.cell / 2;
  const inset = world.cell * 0.12;
  let total = 0;
  let fiercest: { lon: number; lat: number; frp: number; v: number; country: string | null } | null = null;

  for (const [lon, lat, v, newest, frp] of world.cells) {
    total += v;
    const country = grid.at(lon, lat);
    if (country) {
      const c = byCountry.get(country) ?? { name: country, n: 0, newest: 0, frp: 0, top: { lon, lat, v: 0 } };
      c.n += v;
      c.newest += newest;
      c.frp += frp;
      if (v > c.top.v) c.top = { lon, lat, v };
      byCountry.set(country, c);
    }
    if (!fiercest || frp > fiercest.frp) fiercest = { lon, lat, frp, v, country };
    const x0 = lon - half + inset;
    const y0 = lat - half + inset;
    const x1 = lon + half - inset;
    const y1 = lat + half - inset;
    features.push({
      type: "Feature",
      properties: { v, h: Math.sqrt(v) * 9000, country: country ?? "" },
      geometry: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
    });
  }

  const countries = [...byCountry.values()].sort((a, b) => b.n - a.n);
  const hours = world.days.length * 24;
  const sectorOf = (lon: number, lat: number) => sectors.find((s) => inBox(lon, lat, s.box))?.id;
  const latest = world.latest ? `${world.latest.slice(11, 16)} UTC ${world.latest.slice(8, 10)}/${world.latest.slice(5, 7)}` : "";

  const top: Headline[] = countries.slice(0, 5).map((c, i) => ({
    id: `c-${c.name}`,
    kicker: RANK[i + 1],
    title: `${c.name}: ${fmt(c.n)} fire detections in ${hours} hours`,
    sub: `Busiest spot: ${fmt(c.top.v)} detections near ${ll(c.top.lon, c.top.lat)}.`,
    lon: c.top.lon,
    lat: c.top.lat,
    zoom: 4.2,
    sectorId: sectorOf(c.top.lon, c.top.lat),
    tone: i === 0 ? "fire" : "amber",
  }));

  const planet: Headline = {
    id: "planet",
    kicker: "PLANET-WIDE",
    title: `${fmt(total)} fire detections on Earth in the last ${hours} hours`,
    sub: `NOAA-20 and NOAA-21 VIIRS, every pass. Newest data ${latest}. ${countries.length} countries reporting.`,
    lon: countries[0]?.top.lon ?? 0,
    lat: 12,
    zoom: 1.15,
    tone: "cyan",
  };

  const fierce: Headline[] = fiercest
    ? [
        {
          id: "fierce",
          kicker: "MOST INTENSE CLUSTER",
          title: `${fmt(fiercest.frp)} MW of radiated fire power${fiercest.country ? ` in ${fiercest.country}` : ""}`,
          sub: `${fmt(fiercest.v)} detections in one 0.5° cell near ${ll(fiercest.lon, fiercest.lat)}: the strongest heat signal on the planet.`,
          lon: fiercest.lon,
          lat: fiercest.lat,
          zoom: 5,
          sectorId: sectorOf(fiercest.lon, fiercest.lat),
          tone: "fire",
        },
      ]
    : [];

  // our archive sectors, current first
  const sectorNews: Headline[] = [...sectors]
    .sort((a, b) => (a.id === current ? -1 : b.id === current ? 1 : 0))
    .map((s) => {
      let n = 0;
      let best = { lon: 0, lat: 0, v: 0 };
      for (const [lon, lat, v] of world.cells)
        if (inBox(lon, lat, s.box)) {
          n += v;
          if (v > best.v) best = { lon, lat, v };
        }
      const [w, so, e, no] = VIEW_BOX[s.id] ?? s.box;
      return {
        id: `s-${s.id}`,
        kicker: s.id === current ? "IN THIS SECTOR" : "ACROSS OUR SECTORS",
        title: n ? `${s.name}: ${fmt(n)} detections in ${hours} hours` : `${s.name}: quiet, no detections in ${hours} hours`,
        sub: n ? `Hottest cell ${fmt(best.v)} detections near ${ll(best.lon, best.lat)}. Open the sector to compare with 25 years.` : "Open the sector to see its 25-year record.",
        lon: n ? best.lon : (w + e) / 2,
        lat: n ? best.lat : (so + no) / 2,
        zoom: 3.6,
        sectorId: s.id,
        tone: "cyan" as const,
        n,
      };
    })
    .filter((h) => h.n > 0 || h.sectorId === current)
    .map(({ n: _n, ...h }) => h);

  // interleave so the reel keeps changing scale: planet, country, sector, cluster, ...
  const headlines: Headline[] = [planet];
  const queues = [top, sectorNews, fierce];
  for (let i = 0; queues.some((q) => q.length); i++) {
    const q = queues[i % queues.length];
    const h = q.shift();
    if (h) headlines.push(h);
  }

  return { total, countries, headlines, columns: { type: "FeatureCollection", features }, hours };
}
