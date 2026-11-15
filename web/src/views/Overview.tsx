import { useEffect, useMemo, useState } from "react";
import { arc, area as d3area, line as d3line, pie } from "d3-shape";
import { scaleLinear } from "d3-scale";
import type { Mission, ViewId } from "../mission";
import { MapLegend, MapView, type MapFocus } from "../components/MapView";
import { FireWire } from "../components/FireWire";
import { summarizeWorld, useWorldFeed, type Headline } from "../world";
import type { SectorEntry } from "../data";

interface BoundaryFile {
  levels: { country: GeoJSON.FeatureCollection; province: GeoJSON.FeatureCollection };
  cells: Record<string, number[]>;
}
const boundaryCache = new Map<string, Promise<BoundaryFile>>();
const loadBoundaries = (path: string) => {
  if (!boundaryCache.has(path))
    boundaryCache.set(
      path,
      fetch(`${import.meta.env.BASE_URL}${path}boundaries.json`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    );
  return boundaryCache.get(path)!;
};
import { dateAt, fmtDate, fmtNum, indexOf, levelFor, monthName, rollingMean } from "../lib";
import { Ticker } from "../fx";

const avg = (a: Float32Array, t: number, h = 3) => {
  let s = 0;
  let c = 0;
  for (let i = Math.max(0, t - h); i <= Math.min(a.length - 1, t + h); i++) {
    if (!Number.isNaN(a[i])) {
      s += a[i];
      c++;
    }
  }
  return c >= 4 ? s / c : NaN;
};

/* ---------------------------------------------------------------- small charts */

function Donut({ m, compact = false }: { m: Mission; compact?: boolean }) {
  const { view, t } = m;
  const parts = useMemo(
    () =>
      view.meta.regions
        .filter((r) => r.id !== "study_area" && r.id !== "custom")
        .map((r) => {
          const s = view.daily.regions[r.id];
          const v = avg(s.harm, t);
          const norm = s.norm[t];
          return { id: r.id, name: r.name, color: r.color, v: Number.isNaN(v) ? 0 : v, ratio: norm > 0 ? v / norm : NaN };
        }),
    [view, t],
  );
  const total = parts.reduce((a, p) => a + p.v, 0);
  const arcs = pie<(typeof parts)[number]>().value((d) => d.v).sort(null).padAngle(0.03)(parts);
  const gen = arc<(typeof arcs)[number]>().innerRadius(34).outerRadius(52).cornerRadius(3);
  return (
    <div className="donut-row">
      <svg viewBox="-60 -60 120 120" className="donut" role="img" aria-label="Share of detections by region this week">
        <circle r="43" fill="none" stroke="rgba(69,184,209,0.12)" strokeWidth="18" />
        <g className="donut-arcs">
        {total > 0 &&
          arcs.map((a) => (
            <path key={a.data.id} d={gen(a) ?? undefined} fill={a.data.color} onClick={() => m.setRegionId(a.data.id)} style={{ cursor: "pointer" }}>
              <title>{a.data.name}</title>
            </path>
          ))}
        </g>
        <text y="-2" textAnchor="middle" className="donut-n">
          <Ticker text={String(fmtNum(total))} />
        </text>
        <text y="12" textAnchor="middle" className="donut-l">
          PER DAY
        </text>
      </svg>
      {compact ? (
        // the region boxes above already name each region, so here only each share is shown
        <div className={`donut-shares ${parts.length > 4 ? "two" : ""}`}>
          {parts.map((p) => (
            <button key={p.id} className={m.regionId === p.id ? "on" : ""} onClick={() => m.setRegionId(p.id)} title={p.name}>
              <i style={{ background: p.color }} />
              <b>{total > 0 ? `${Math.round((100 * p.v) / total)}%` : "0%"}</b>
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      ) : (
      <ul className="donut-legend">
        {parts.map((p) => (
          <li key={p.id}>
            <button className={m.regionId === p.id ? "on" : ""} onClick={() => m.setRegionId(p.id)}>
              <i style={{ background: p.color }} />
              <span>{p.name}</span>
              <b><Ticker text={String(total > 0 ? `${Math.round((100 * p.v) / total)}%` : "0%")} /></b>
            </button>
          </li>
        ))}
      </ul>
      )}
    </div>
  );
}

function YearSpark({ m }: { m: Mission }) {
  const { view, regionId, t } = m;
  const s = view.daily.regions[regionId];
  const smooth = useMemo(() => rollingMean(s.harm, 7), [s]);
  const year = dateAt(view.meta.start, t).getUTCFullYear();
  const first = indexOf(view.meta.start, `${year}-01-01`);
  const len = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
  const W = 320;
  const H = 96;
  const idx = useMemo(() => Array.from({ length: len }, (_, k) => first + k).filter((i) => i < view.daily.days), [first, len, view.daily.days]);
  const max = useMemo(() => {
    let mx = 1;
    for (const i of idx) {
      if (smooth[i] > mx) mx = smooth[i];
      if (s.norm90[i] > mx) mx = s.norm90[i];
    }
    return mx * 1.08;
  }, [idx, smooth, s]);
  const x = scaleLinear().domain([0, len - 1]).range([0, W]);
  const y = scaleLinear().domain([0, max]).range([H - 14, 4]);
  const areaPath = d3area<number>().defined((i) => !Number.isNaN(smooth[i])).x((i) => x(i - first)).y0(y(0)).y1((i) => y(smooth[i]))(idx) ?? "";
  const linePath = d3line<number>().defined((i) => !Number.isNaN(smooth[i])).x((i) => x(i - first)).y((i) => y(smooth[i]))(idx) ?? "";
  const normPath = d3line<number>().defined((i) => !Number.isNaN(s.norm[i])).x((i) => x(i - first)).y((i) => y(s.norm[i]))(idx) ?? "";
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="spark"
      role="img"
      aria-label={`Detections per day in ${year}`}
      onClick={(e) => {
        const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        m.pick(first + Math.round(((e.clientX - r.left) / r.width) * (len - 1)));
      }}
    >
      <defs>
        <linearGradient id="sparkfill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#FF9D43" stopOpacity="0.55" />
          <stop offset="1" stopColor="#FF9D43" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path key={`a-${year}-${regionId}`} className="fade-in" d={areaPath} fill="url(#sparkfill)" />
      <path d={normPath} fill="none" stroke="#8396ab" strokeWidth="1" strokeDasharray="3 3" />
      <path key={`l-${year}-${regionId}`} className="draw-line" pathLength={1} d={linePath} fill="none" stroke="#FF9D43" strokeWidth="1.6" />
      <line x1={x(t - first)} x2={x(t - first)} y1="0" y2={H - 14} stroke="#fff" strokeWidth="1" />
      {[0, 3, 6, 9].map((mo) => (
        <text key={mo} x={x((Date.UTC(year, mo, 1) - Date.UTC(year, 0, 1)) / 86_400_000) + 2} y={H - 3} className="spark-tick">
          {monthName(mo).toUpperCase()}
        </text>
      ))}
    </svg>
  );
}

/** The whole record as a strip of monthly bars, used as the backdrop of the time slider. */
function RecordStrip({ m }: { m: Mission }) {
  const { view, regionId, t } = m;
  const s = view.daily.regions[regionId];
  const { bars, years } = useMemo(() => {
    const map = new Map<number, number>();
    for (let i = 0; i < view.daily.days; i++) {
      const v = s.harm[i];
      if (Number.isNaN(v)) continue;
      const d = dateAt(view.meta.start, i);
      const k = d.getUTCFullYear() * 12 + d.getUTCMonth();
      map.set(k, (map.get(k) ?? 0) + v);
    }
    const y0 = Number(view.meta.start.slice(0, 4));
    const y1 = Number(view.meta.end.slice(0, 4));
    const out: number[] = [];
    for (let k = y0 * 12; k < (y1 + 1) * 12; k++) out.push(map.get(k) ?? 0);
    const yrs: number[] = [];
    for (let y = y0; y <= y1; y++) if (y % 5 === 0) yrs.push(y);
    return { bars: out, years: yrs.map((y) => ({ y, pos: indexOf(view.meta.start, `${y}-01-01`) / (view.daily.days - 1) })) };
  }, [s, view]);
  const max = Math.max(1, ...bars);
  const n = bars.length;
  return (
    <div className="strip">
      <svg viewBox={`0 0 ${n} 30`} preserveAspectRatio="none" className="strip-svg" aria-hidden>
        {bars.map((v, i) => {
          const h = Math.sqrt(v / max) * 28;
          return <rect key={i} className="grow" style={{ animationDelay: `${i * 2}ms` }} x={i + 0.1} y={30 - h} width={0.8} height={h} fill={v / max > 0.35 ? "#F05A42" : v / max > 0.1 ? "#FF9D43" : "#3d6f86"} />;
        })}
      </svg>
      <div className="strip-cursor" style={{ left: `${(100 * t) / m.maxT}%` }} />
      {years.map((y) => (
        <span key={y.y} className="strip-year mono" style={{ left: `${100 * y.pos}%` }}>
          {y.y}
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- the view */

interface SectorNav {
  sectors: SectorEntry[];
  current: string;
  path: string;
  onOpen: (id: string) => void;
}

export function Overview({ m, go, nav }: { m: Mission; go: (v: ViewId) => void; nav?: SectorNav }) {
  const { data, view, regionId, t } = m;
  const meta = view.meta;
  const s = view.daily.regions[regionId];
  const date = dateAt(meta.start, t);
  const week = Math.min(Math.floor(t / 7), data.grid.weeks - 1);
  const regionName =
    regionId === "study_area"
      ? meta.sector
        ? (meta.regions.find((r) => r.id === "study_area")?.name ?? "the whole sector")
        : "the whole study area"
      : regionId === "custom"
        ? (m.area?.name ?? "your selected area")
        : (meta.regions.find((r) => r.id === regionId)?.name ?? regionId);
  const named = meta.regions.filter((r) => r.id !== "study_area" && r.id !== "custom");

  const info = useMemo(() => {
    const v = avg(s.harm, t);
    const norm = s.norm[t];
    return { v, norm, p: s.pct[t], ratio: norm > 0 ? v / norm : NaN, est: s.src[t] === 2, none: s.src[t] === 0, lo: avg(s.lo, t), hi: avg(s.hi, t) };
  }, [s, t]);
  const level = levelFor(info.p);
  const events = useMemo(() => [...meta.events].sort((a, b) => b.total - a.total).slice(0, 6), [meta.events]);
  const wide = typeof window !== "undefined" && window.innerWidth > 1100;

  // ---- Fire Wire: live planet-wide headlines that fly the globe
  const feed = useWorldFeed();
  const world = useMemo(
    () => (feed.world && feed.grid ? summarizeWorld(feed.world, feed.grid, nav?.sectors ?? [], nav?.current) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [feed.world, feed.grid],
  );
  const [worldOn, setWorldOn] = useState(false);
  const [regionsOpen, setRegionsOpen] = useState(() => localStorage.getItem("ignis.regions") !== "closed");
  const toggleRegions = (open: boolean) => {
    setRegionsOpen(open);
    localStorage.setItem("ignis.regions", open ? "open" : "closed");
  };
  // ---- country and province outlines: hover names them, a click selects one
  type BorderLevel = "off" | "country" | "province";
  const entry = nav?.sectors.find((x) => x.id === nav.current);
  // Southeast Asia has no country list but spans several countries
  const multiCountry = !entry?.countries || entry.countries.length > 1;
  const [borders, setBorders] = useState<BorderLevel>(multiCountry ? "country" : "province");
  const [bnd, setBnd] = useState<BoundaryFile | null>(null);
  useEffect(() => {
    if (!nav || borders === "off" || bnd) return;
    let alive = true;
    loadBoundaries(nav.path).then((b) => alive && setBnd(b)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [nav, borders, bnd]);
  const outlines = borders === "off" || !bnd ? null : bnd.levels[borders];
  const pickBoundary = (id: string) => {
    if (!bnd) return;
    if (m.aoi?.id === id) {
      m.clearArea();
      return;
    }
    const f = [...bnd.levels.country.features, ...bnd.levels.province.features].find((x) => x.properties?.id === id);
    const cells = bnd.cells[id];
    if (!f || !cells?.length) return;
    const p = f.properties as { name: string; country: string; bbox: [number, number, number, number] };
    m.pickArea({
      west: p.bbox[0],
      south: p.bbox[1],
      east: p.bbox[2],
      north: p.bbox[3],
      cells,
      id,
      name: p.country !== p.name ? `${p.name}, ${p.country}` : p.name,
      outline: f.geometry,
    });
  };
  const [idx, setIdx] = useState(0);
  const [tour, setTour] = useState(false);
  const [wireOpen, setWireOpen] = useState(() => localStorage.getItem("ignis.wire") !== "closed");
  const toggleWire = (open: boolean) => {
    setWireOpen(open);
    if (!open) setTour(false);
    localStorage.setItem("ignis.wire", open ? "open" : "closed");
  };
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const dwell = tour ? 11 : 8;
  const heads = world?.headlines ?? [];
  const flyTo = (h: { id: string; lon: number; lat: number; zoom: number }, label?: string) => {
    setWorldOn(true);
    setFocus({ key: `${h.id}-${Date.now()}`, lon: h.lon, lat: h.lat, zoom: h.zoom, label });
  };
  const labelOf = (h: Headline) => (h.id === "planet" ? undefined : h.id === "fierce" ? "Most intense" : h.title.split(":")[0]);
  const pickHead = (i: number) => {
    const h = heads[i];
    if (!h) return;
    setIdx(i);
    flyTo(h, labelOf(h));
  };
  const backToArchive = () => {
    setWorldOn(false);
    setTour(false);
  };
  // the reel advances on its own; on tour every headline also moves the camera
  useEffect(() => {
    if (!heads.length) return;
    const id = setTimeout(() => {
      const next = (idx + 1) % heads.length;
      if (tour) pickHead(next);
      else setIdx(next);
    }, dwell * 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, tour, heads.length]);
  // Esc stops the tour
  useEffect(() => {
    if (!tour) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setTour(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tour]);
  const updated = feed.world?.latest ? `${feed.world.latest.slice(11, 16)} UTC` : null;

  const story = info.none
    ? `No sensor reported data for ${regionName} around this date.`
    : Number.isNaN(info.ratio)
      ? `${regionName[0].toUpperCase()}${regionName.slice(1)} recorded about ${fmtNum(info.v)} detections a day.`
      : info.ratio >= 1.15
        ? `${regionName[0].toUpperCase()}${regionName.slice(1)} is burning at ${info.ratio.toFixed(1)}× its normal level for this time of year${info.p >= 99.5 ? ", higher than any other year." : "."}`
        : info.ratio <= 0.85
          ? `${regionName[0].toUpperCase()}${regionName.slice(1)} is quieter than normal for this time of year.`
          : `${regionName[0].toUpperCase()}${regionName.slice(1)} is close to its normal level for this time of year.`;

  return (
    <div className="ov">
      <div className={`ov-map ${m.drawing ? "drawing" : ""}`}>
        <MapView
          data={data}
          week={week}
          regionId={regionId}
          mode={m.mapMode}
          aoi={m.area?.snapped ?? null}
          boundaries={outlines}
          selectedBoundary={m.aoi?.id ?? null}
          onPickBoundary={pickBoundary}
          drawing={m.drawing}
          onDraw={m.onDraw}
          nav={false}
          globe
          highlights={3}
          worldCols={world?.columns ?? null}
          worldOn={worldOn}
          focus={focus}
          padding={wide ? { left: 380, right: 380, top: 70, bottom: 150 } : 16}
        />
      </div>

      <div className="ov-tools glass">
        <div className="seg" role="group" aria-label="What the globe shows">
          <button className={!worldOn ? "on" : ""} onClick={backToArchive}>
            Archive
          </button>
          <button
            className={worldOn ? "on live" : ""}
            disabled={!world}
            onClick={() => (worldOn ? undefined : pickHead(0))}
            title={world ? "Every fire detected on Earth in the last 48 hours" : "Live feed not available"}
          >
            ● Live Earth
          </button>
        </div>
        {!worldOn && (
          <div className="seg" role="group" aria-label="Map style">
            <button className={m.mapMode === "columns" ? "on" : ""} onClick={() => m.setMapMode("columns")}>
              3D
            </button>
            <button className={m.mapMode === "heat" ? "on" : ""} onClick={() => m.setMapMode("heat")}>
              Heat
            </button>
            <button className={m.mapMode === "cells" ? "on" : ""} onClick={() => m.setMapMode("cells")}>
              Grid
            </button>
          </div>
        )}
        {!worldOn && (
          <button
            className={`tool ${m.drawing ? "on" : ""}`}
            onClick={() => {
              m.setDrawing(!m.drawing);
              m.setDrawMsg(null);
            }}
            aria-pressed={m.drawing}
          >
            ⛶ {m.drawing ? "Cancel" : m.aoi ? "Redraw area" : "Select area"}
          </button>
        )}
        {m.aoi && !worldOn && (
          <button className="tool" onClick={m.clearArea}>
            ✕ Clear
          </button>
        )}
      </div>
      {(m.drawMsg || m.isCustom) && !m.drawing && (
        <div className="ov-note mono">{m.drawMsg ?? `${(m.area!.name ?? "YOUR AREA").toUpperCase()} · ${m.area!.totalCells} GRID CELL${m.area!.totalCells === 1 ? "" : "S"} · WEEKLY VALUES · NO UNCERTAINTY RANGE${m.aoi?.id ? " · CLICK AGAIN OR ✕ TO CLEAR" : ""}`}</div>
      )}

      <FireWire
        headlines={heads}
        index={Math.min(idx, Math.max(0, heads.length - 1))}
        dwell={dwell}
        tour={tour}
        worldOn={worldOn}
        status={world ? "ready" : feed.error ? "error" : "loading"}
        updated={updated}
        onPick={pickHead}
        onTour={(on) => {
          setTour(on);
          if (on) pickHead(idx);
        }}
        open={wireOpen}
        onOpen={toggleWire}
        onOpenSector={nav ? (id) => (id === nav.current ? backToArchive() : nav.onOpen(id)) : undefined}
      />

      {worldOn && world && (
        <aside className="ov-col ov-right">
          <div className="hud-panel glass world-panel">
            <div className="panel-head">
              <span className="mono">LIVE EARTH · LAST {world.hours} H</span>
              <span className="mono dim">VIIRS NRT</span>
            </div>
            <div className="wl-total">
              <Ticker text={String(fmtNum(world.total))} />
            </div>
            <p className="wl-note">
              fire detections by NOAA-20 and NOAA-21 across the whole planet, one column per 0.5° cell. A detection is a thermal anomaly seen from orbit, not a
              confirmed fire.
            </p>
          </div>
          <div className="hud-panel glass">
            <div className="panel-head">
              <span className="mono">MOST ACTIVE COUNTRIES</span>
              <span className="mono dim">CLICK TO FLY</span>
            </div>
            <ul className="wl-list">
              {world.countries.slice(0, 12).map((c, i) => (
                <li key={c.name}>
                  <button
                    className={focus?.label === c.name ? "on" : ""}
                    onClick={() => {
                      setTour(false);
                      flyTo({ id: c.name, lon: c.top.lon, lat: c.top.lat, zoom: 4.2 }, c.name);
                    }}
                  >
                    <span className="rk mono">{String(i + 1).padStart(2, "0")}</span>
                    <span>{c.name}</span>
                    <b>{fmtNum(c.n)}</b>
                    <i className="bar" style={{ transform: `scaleX(${c.n / world.countries[0].n})` }} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="hud-panel glass link-panel">
            <button onClick={backToArchive}>
              <span className="mono">BACK</span> To the {meta.sector?.name ?? "Southeast Asia"} archive <i>→</i>
            </button>
          </div>
        </aside>
      )}

      {!worldOn && (
      <>
      <aside className="ov-col ov-left">
        {named.length > 1 && (
          <div className={`hud-panel glass region-boxes ${regionsOpen ? "" : "closed"}`}>
            <button className="panel-head rb-toggle" onClick={() => toggleRegions(!regionsOpen)} aria-expanded={regionsOpen}>
              <span className="mono">REGIONS</span>
              <span className="mono dim">
                {regionsOpen ? "7-DAY MEAN · VS NORMAL" : ""} <i className="rb-chev">{regionsOpen ? "▾" : "▸"}</i>
              </span>
            </button>
            {!regionsOpen && (
              <button className="rb-expand" onClick={() => toggleRegions(true)}>
                Expand to view regions
                <span className="mono dim">
                  {named.length} REGIONS · SHOWING {(regionId === "study_area" ? "ALL" : (meta.regions.find((r) => r.id === regionId)?.name ?? "ALL")).toUpperCase()}
                </span>
              </button>
            )}
            {regionsOpen && (
            <div className={`rb-grid ${named.length > 4 ? "three" : ""}`}>
              {named.map((r) => {
                const sr = view.daily.regions[r.id];
                const v = sr ? avg(sr.harm, t) : NaN;
                const n = sr ? sr.norm[t] : NaN;
                const ratio = n > 0 ? v / n : NaN;
                return (
                  <button
                    key={r.id}
                    className={`rb ${regionId === r.id ? "on" : ""}`}
                    style={{ ["--rc" as string]: r.color }}
                    onClick={() => m.setRegionId(regionId === r.id ? "study_area" : r.id)}
                    title={regionId === r.id ? "Click again for all regions" : `Show ${r.name}`}
                  >
                    <span className="rb-name">
                      <i style={{ background: r.color }} />
                      {r.name}
                    </span>
                    <span className="rb-v">
                      <b>{Number.isNaN(v) ? "n/a" : fmtNum(v)}</b>
                      <em className={ratio >= 1.5 ? "hot" : ratio <= 0.75 ? "cool" : ""}>{Number.isNaN(ratio) ? "" : `${ratio.toFixed(1)}×`}</em>
                    </span>
                  </button>
                );
              })}
            </div>
            )}
          </div>
        )}
        <div className="hud-panel glass kpis">
          <div className="kpi">
            <div className="mono k">DETECTIONS / DAY</div>
            <div className="kpi-n amber"><Ticker text={String(info.none ? "n/a" : fmtNum(info.v))} /></div>
          </div>
          <div className="kpi">
            <div className="mono k">VS NORMAL</div>
            <div className={`kpi-n ${info.ratio >= 1.5 ? "fire" : ""}`}><Ticker text={String(Number.isNaN(info.ratio) ? "n/a" : `${info.ratio.toFixed(1)}×`)} /></div>
          </div>
          <div className="kpi">
            <div className="mono k">PERCENTILE</div>
            <div className="kpi-n"><Ticker text={String(Number.isNaN(info.p) ? "n/a" : Math.round(info.p))} /></div>
          </div>
          <div className="kpi">
            <div className="mono k">TYPICAL / DAY</div>
            <div className="kpi-n cyan"><Ticker text={String(Number.isNaN(info.norm) ? "n/a" : fmtNum(info.norm))} /></div>
          </div>
        </div>

        {named.length > 1 ? (
          <div className="hud-panel glass">
            <div className="panel-head">
              <span className="mono">WHERE IT IS BURNING</span>
              <span className="mono dim">7-DAY MEAN</span>
            </div>
            <Donut m={m} compact />
          </div>
        ) : (
          <div className="hud-panel glass">
            <div className="panel-head">
              <span className="mono">SECTOR</span>
              <span className="mono dim">{meta.cell}° GRID</span>
            </div>
            <h3 className="sector-title">{meta.sector?.name ?? named[0]?.name}</h3>
            <p className="ov-prov">{meta.sector?.story}</p>
          </div>
        )}

        <div className="hud-panel glass">
          <div className="panel-head">
            <span className="mono">{date.getUTCFullYear()} · DETECTIONS PER DAY</span>
            <span className="mono dim">— — NORMAL</span>
          </div>
          <YearSpark m={m} />
        </div>

        <div className="hud-panel glass legend-panel">
          <MapLegend cell={meta.cell} />
          {nav && (
            <div className="borders-row">
              <span className="mono">BORDERS</span>
              <div className="seg" role="group" aria-label="Borders">
                {(multiCountry ? (["off", "country", "province"] as BorderLevel[]) : (["off", "province"] as BorderLevel[])).map((l) => (
                  <button key={l} className={borders === l ? "on" : ""} onClick={() => setBorders(l)} title={l === "off" ? "Hide borders" : `Hover to name, click to select a ${l}`}>
                    {l === "off" ? "Off" : l === "country" ? "Countries" : multiCountry ? "Provinces" : "States"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      <aside className="ov-col ov-right">
        <div className="hud-panel glass">
          <div className="panel-head">
            <span className="mono">SELECTED WEEK</span>
            <span className={`badge ${level.tone}`}>{level.label}</span>
          </div>
          <h3 className="ov-date">{fmtDate(date)}</h3>
          <p className="ov-story">{story}</p>
          {!info.none && (
            <p className="ov-prov">
              <b>{info.est ? "Estimated from MODIS." : "Observed by VIIRS."}</b>{" "}
              {info.est && !Number.isNaN(info.lo) ? `80% range ${fmtNum(info.lo)} to ${fmtNum(info.hi)} per day.` : info.est ? "VIIRS was not flying yet." : "Measured directly at 375 m."}
            </p>
          )}
        </div>

        <div className="hud-panel glass">
          <div className="panel-head">
            <span className="mono">BIGGEST EPISODES</span>
            <span className="mono dim">CLICK TO JUMP</span>
          </div>
          <ul className="ep-list">
            {events.map((ev) => {
              const on = t >= indexOf(meta.start, ev.start) && t <= indexOf(meta.start, ev.end);
              return (
                <li key={ev.peak}>
                  <button
                    className={on ? "on" : ""}
                    onClick={() => {
                      m.setRegionId("study_area");
                      m.pick(indexOf(meta.start, ev.peak));
                    }}
                  >
                    <span>{fmtDate(dateAt(meta.start, indexOf(meta.start, ev.peak))).replace(/^\d+ /, "")}</span>
                    <b>{ev.times_normal ? `${ev.times_normal}×` : ""}</b>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="hud-panel glass link-panel">
          <button onClick={() => go("live")}>
            <span className="mono live-tag">
              <i className="rec" /> LIVE
            </span>{" "}
            This week against 25 years <i>→</i>
          </button>
          <button onClick={() => go("record")}>
            <span className="mono">OPEN</span> The full burning calendar <i>→</i>
          </button>
          <button onClick={() => go("method")}>
            <span className="mono">CHECK</span> How sure are we? <i>→</i>
          </button>
        </div>
      </aside>

      <div className="ov-bottom hud-panel glass">
        <button className="play-btn" onClick={() => m.setPlaying(!m.playing)} aria-label={m.playing ? "Pause" : "Play through time"}>
          {m.playing ? "❚❚" : "▶"}
        </button>
        <div className="timeline">
          <RecordStrip m={m} />
          <input className="slider" type="range" min={0} max={m.maxT} value={t} step={1} onChange={(e) => m.pick(Number(e.target.value))} aria-label="Date" />
        </div>
        <div className="tl-read">
          <div className="mono k">WEEK OF</div>
          <div className="tl-date">{fmtDate(dateAt(meta.start, week * 7))}</div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
