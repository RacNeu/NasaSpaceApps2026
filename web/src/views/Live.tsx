import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Mission, ViewId } from "../mission";
import { ago, summarizeLive, TONE_COLOR, useLiveFeed, type LivePayload, type RegionLive } from "../live";
import { fmtNum, monthName } from "../lib";
import { Scramble, Ticker } from "../fx";

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

/* ---------------------------------------------------------------- globe */

function LiveMap({ m, payload, regions, focus }: { m: Mission; payload: LivePayload | null; regions: RegionLive[]; focus: string }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const [loaded, setLoaded] = useState(false);
  const { meta } = m.data;
  const wide = typeof window !== "undefined" && window.innerWidth > 1100;
  const padding = wide ? { left: 380, right: 380, top: 70, bottom: 40 } : 16;

  useEffect(() => {
    if (!el.current || map.current) return;
    const mp = new maplibregl.Map({
      container: el.current,
      center: [128, 14],
      zoom: 0.6,
      attributionControl: { compact: true },
      style: {
        version: 8,
        projection: { type: "globe" },
        sky: {
          "sky-color": "#04070d",
          "horizon-color": "#2a86b0",
          "fog-color": "#081424",
          "sky-horizon-blend": 0.7,
          "horizon-fog-blend": 0.6,
          "fog-ground-blend": 0.2,
          "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 0.9, 7, 0.4],
        },
        sources: {
          under: {
            type: "image",
            url: `${import.meta.env.BASE_URL}textures/earth_mercator.jpg`,
            coordinates: [[-180, 85.0511], [180, 85.0511], [180, -85.0511], [-180, -85.0511]],
          },
          base: {
            type: "raster",
            tiles: [`${GIBS}/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`],
            tileSize: 256,
            maxzoom: 8,
            attribution: "Imagery: NASA GIBS · Live detections: NASA FIRMS NRT",
          },
          labels: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            maxzoom: 16,
          },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#04070d" } },
          { id: "under", type: "raster", source: "under", paint: { "raster-brightness-max": 0.6, "raster-saturation": -0.3, "raster-contrast": 0.2 } },
          { id: "base", type: "raster", source: "base", paint: { "raster-brightness-max": 0.6, "raster-saturation": -0.3, "raster-contrast": 0.2 } },
        ],
      } as any,
    });
    mp.on("load", () => {
      mp.addSource("regions", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      mp.addLayer({ id: "regions-fill", type: "fill", source: "regions", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.13 } });
      mp.addLayer({ id: "regions-glow", type: "line", source: "regions", paint: { "line-color": ["get", "color"], "line-width": 8, "line-blur": 7, "line-opacity": ["case", ["get", "focus"], 0.9, 0.35] } });
      mp.addLayer({ id: "regions-line", type: "line", source: "regions", paint: { "line-color": ["get", "color"], "line-width": ["case", ["get", "focus"], 2.2, 1], "line-opacity": 0.9 } });
      mp.addSource("live", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      // older detections are dimmer and redder, the last day white-hot
      const ageColour: any = ["interpolate", ["linear"], ["get", "age"], 0, "#FFF3DC", 1, "#FFC27A", 3, "#FF9D43", 7, "#B8402C"];
      mp.addLayer({
        id: "live-glow",
        type: "circle",
        source: "live",
        paint: {
          "circle-color": ageColour,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, ["interpolate", ["linear"], ["get", "n"], 1, 2, 40, 6], 6, ["interpolate", ["linear"], ["get", "n"], 1, 7, 40, 22]],
          "circle-blur": 1,
          "circle-opacity": ["interpolate", ["linear"], ["get", "age"], 0, 0.75, 7, 0.22],
          "circle-pitch-alignment": "map",
        },
      });
      mp.addLayer({
        id: "live-core",
        type: "circle",
        source: "live",
        filter: ["<=", ["get", "age"], 1],
        paint: {
          "circle-color": "#ffffff",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 2, 0.8, 6, 2.2],
          "circle-opacity": 0.85,
          "circle-pitch-alignment": "map",
        },
      });
      mp.addLayer({ id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.75 } });
      setLoaded(true);
      const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const [w, s, e, n] = meta.box;
      mp.fitBounds([[w, s], [e, n]], { padding, duration: still ? 0 : 3000, essential: true });
    });
    map.current = mp;
    return () => {
      markers.current.forEach((k) => k.remove());
      mp.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // regions tinted by this week's warning level
  useEffect(() => {
    const mp = map.current;
    if (!mp || !loaded) return;
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: meta.regions
        .filter((r) => r.polygon)
        .map((r) => {
          const lv = regions.find((x) => x.id === r.id);
          return {
            type: "Feature",
            properties: { color: lv ? TONE_COLOR[lv.level.tone] : "#45B8D1", focus: focus === r.id || focus === "study_area" },
            geometry: { type: "Polygon", coordinates: [[...r.polygon!, r.polygon![0]]] },
          };
        }),
    };
    (mp.getSource("regions") as maplibregl.GeoJSONSource | undefined)?.setData(fc);
  }, [regions, focus, loaded, meta.regions]);

  // detections and markers on the newest hot spots
  useEffect(() => {
    const mp = map.current;
    if (!mp || !loaded || !payload) return;
    const last = payload.days.length - 1;
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: payload.cells
        .filter((c) => c[3] === 0)
        .map((c) => ({ type: "Feature", properties: { n: c[4], age: last - c[2] }, geometry: { type: "Point", coordinates: [c[0], c[1]] } })),
    };
    (mp.getSource("live") as maplibregl.GeoJSONSource | undefined)?.setData(fc);

    markers.current.forEach((k) => k.remove());
    markers.current = [];
    // merge the last 48 hours into 0.5 degree blocks and mark the three busiest
    const blocks = new Map<string, { lon: number; lat: number; n: number }>();
    for (const c of payload.cells) {
      if (c[3] !== 0 || c[2] < last - 1) continue;
      const k = `${Math.floor(c[0] * 2)},${Math.floor(c[1] * 2)}`;
      const b = blocks.get(k);
      if (b) {
        b.n += c[4];
        if (c[4] > 0) {
          b.lon = (b.lon + c[0]) / 2;
          b.lat = (b.lat + c[1]) / 2;
        }
      } else blocks.set(k, { lon: c[0], lat: c[1], n: c[4] });
    }
    const top = [...blocks.values()].sort((a, b) => b.n - a.n);
    const picked: typeof top = [];
    for (const b of top) {
      if (b.n < 5 || picked.length >= 3) break;
      if (picked.every((p) => Math.hypot(p.lon - b.lon, p.lat - b.lat) > 2)) picked.push(b);
    }
    picked.forEach((b, i) => {
      const elm = document.createElement("div");
      elm.className = "hot-marker live";
      elm.innerHTML = `<i></i><i></i><b></b><span>NEW ${String(i + 1).padStart(2, "0")} · ${b.n} in 48 h</span>`;
      markers.current.push(new maplibregl.Marker({ element: elm }).setLngLat([b.lon, b.lat]).addTo(mp));
    });
  }, [payload, loaded]);

  // fly to a region when one is chosen
  useEffect(() => {
    const mp = map.current;
    if (!mp || !loaded) return;
    const r = meta.regions.find((x) => x.id === focus);
    if (!r?.polygon) {
      const [w, s, e, n] = meta.box;
      mp.fitBounds([[w, s], [e, n]], { padding, duration: 1200 });
      return;
    }
    const xs = r.polygon.map((p) => p[0]);
    const ys = r.polygon.map((p) => p[1]);
    mp.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding, duration: 1200, maxZoom: 6.5 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, loaded]);

  return <div ref={el} className="map" />;
}

/* ---------------------------------------------------------------- daily bars */

function DayBars({ p, study }: { p: LivePayload; study: RegionLive }) {
  const W = 320;
  const H = 120;
  const n = p.days.length;
  const n21 = p.perDay.noaa21;
  const max = Math.max(1, ...study.daily, ...(Number.isFinite(study.highWeek) ? [study.highWeek / 7] : []));
  const bw = W / n;
  const y = (v: number) => H - 18 - (v / max) * (H - 26);
  const normal = study.normalWeek / 7;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="spark" role="img" aria-label="NOAA-20 detections per day this week, against the normal level">
      <defs>
        <pattern id="partial" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="2.5" height="5" fill="#FF9D43" opacity="0.6" />
        </pattern>
      </defs>
      {study.daily.map((v, i) => {
        const today = i === n - 1;
        const h = H - 18 - y(v);
        return (
          <g key={i}>
            <rect className="grow" style={{ animationDelay: `${i * 60}ms` }} x={i * bw + 4} y={y(v)} width={bw - 8} height={Math.max(h, 0)} rx="2" fill={today ? "url(#partial)" : v / Math.max(normal, 1) >= 2 ? "#F05A42" : "#FF9D43"} />
            <text x={i * bw + bw / 2} y={H - 5} textAnchor="middle" className="spark-tick">
              {today ? "TODAY" : `${Number(p.days[i].slice(8))} ${monthName(Number(p.days[i].slice(5, 7)) - 1).toUpperCase()}`}
            </text>
          </g>
        );
      })}
      {Number.isFinite(normal) && <line x1="0" x2={W} y1={y(normal)} y2={y(normal)} stroke="#8396ab" strokeDasharray="4 3" strokeWidth="1" />}
      <polyline
        fill="none"
        stroke="#45B8D1"
        strokeWidth="1.2"
        strokeOpacity="0.8"
        points={n21.map((v, i) => `${i * bw + bw / 2},${y(Math.min(v, max))}`).join(" ")}
      />
    </svg>
  );
}

/* ---------------------------------------------------------------- the view */

export function Live({ m, go }: { m: Mission; go: (v: ViewId) => void }) {
  const { state, reload } = useLiveFeed();
  const [focus, setFocus] = useState("study_area");
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const payload = state.status === "ready" ? state.payload : null;
  const sum = useMemo(() => (payload ? summarizeLive(m.data, payload) : null), [m.data, payload]);
  const sel = sum ? (focus === "study_area" ? sum.study : (sum.regions.find((r) => r.id === focus) ?? sum.study)) : null;
  const winLabel = payload ? `${Number(payload.days[0].slice(8))} ${monthName(Number(payload.days[0].slice(5, 7)) - 1)} to ${Number(payload.days[6].slice(8))} ${monthName(Number(payload.days[6].slice(5, 7)) - 1)}` : "";

  return (
    <div className="ov live">
      <div className="ov-map">
        <LiveMap m={m} payload={payload} regions={sum?.regions ?? []} focus={focus} />
      </div>

      <aside className="ov-col ov-left">
        <div className={`hud-panel glass warn-panel tone-${sel?.level.tone ?? "typical"}`}>
          <div className="panel-head">
            <span className="mono live-tag">
              <i className="rec" /> LIVE · LAST 7 DAYS
            </span>
            <span className="mono dim">{focus === "study_area" ? "ALL FOUR REGIONS" : sel?.name.toUpperCase()}</span>
          </div>
          {state.status === "loading" && <div className="live-wait mono">CONTACTING NASA FIRMS…</div>}
          {state.status === "unconfigured" && (
            <div className="live-msg">
              <b>The live feed isn't switched on for this deployment.</b> It needs a FIRMS MAP_KEY set as the <code>FIRMS_MAP_KEY</code> environment
              variable on the server. The rest of the console works without it.
            </div>
          )}
          {state.status === "error" && (
            <div className="live-msg">
              <b>FIRMS could not be reached.</b> {state.message}
              <button className="btn-ghost small" onClick={reload}>
                Try again
              </button>
            </div>
          )}
          {sel && (
            <>
              <div className="warn-level">
                <Scramble text={sel.level.label.toUpperCase()} />
              </div>
              <p className="ov-story">
                {fmtNum(sel.week)} detections from {winLabel}.{" "}
                {Number.isFinite(sel.ratio)
                  ? `That is ${sel.ratio.toFixed(1)}× the normal week for this time of year, ${sel.pct >= 99.5 ? "above every comparable week in 25 years." : `above ${Math.round(sel.pct)}% of comparable weeks since ${m.data.meta.start.slice(0, 4)}.`}`
                  : "There is no baseline for this area."}
              </p>
            </>
          )}
        </div>

        {sel && (
          <div className="hud-panel glass kpis">
            <div className="kpi">
              <div className="mono k">DETECTIONS / DAY</div>
              <div className="kpi-n amber">
                <Ticker text={fmtNum(sel.week / 7)} />
              </div>
            </div>
            <div className="kpi">
              <div className="mono k">VS NORMAL WEEK</div>
              <div className={`kpi-n ${sel.ratio >= 1.5 ? "fire" : ""}`}>
                <Ticker text={Number.isFinite(sel.ratio) ? `${sel.ratio.toFixed(1)}×` : "n/a"} />
              </div>
            </div>
            <div className="kpi">
              <div className="mono k">PERCENTILE</div>
              <div className="kpi-n">
                <Ticker text={Number.isFinite(sel.pct) ? String(Math.round(sel.pct)) : "n/a"} />
              </div>
            </div>
            <div className="kpi">
              <div className="mono k">NORMAL / DAY</div>
              <div className="kpi-n cyan">
                <Ticker text={Number.isFinite(sel.normalWeek) ? fmtNum(sel.normalWeek / 7) : "n/a"} />
              </div>
            </div>
          </div>
        )}

        {payload && sum && (
          <div className="hud-panel glass">
            <div className="panel-head">
              <span className="mono">NOAA-20 PER DAY · ALL REGIONS</span>
              <span className="mono dim">— — NORMAL · <span className="cyan">—</span> NOAA-21</span>
            </div>
            <DayBars p={payload} study={sum.study} />
            {sum.gaps.length > 0 && <p className="fineprint">NOAA-20 reported nothing on {sum.gaps.length} day(s), which usually means a data gap, so the week may read low.</p>}
          </div>
        )}

        {payload && (
          <div className="hud-panel glass fresh">
            <div className="panel-head">
              <span className="mono">SIGNAL</span>
              <button className="btn-ghost small" onClick={reload}>
                ↻ Refresh
              </button>
            </div>
            <dl>
              <div>
                <dt className="mono">LATEST NOAA-20 PASS</dt>
                <dd>{ago(payload.latest.noaa20)}</dd>
              </div>
              <div>
                <dt className="mono">LATEST NOAA-21 PASS</dt>
                <dd>{ago(payload.latest.noaa21)}</dd>
              </div>
              <div>
                <dt className="mono">FETCHED</dt>
                <dd>
                  {ago(payload.fetchedAt)}
                  {payload.cached ? " (cached)" : ""}
                </dd>
              </div>
            </dl>
            {payload.errors.length > 0 && <p className="fineprint">Some requests failed and are missing: {payload.errors.length}.</p>}
          </div>
        )}
      </aside>

      <aside className="ov-col ov-right">
        <div className="hud-panel glass">
          <div className="panel-head">
            <span className="mono">EARLY WARNING BY REGION</span>
            <span className="mono dim">CLICK TO FOCUS</span>
          </div>
          {!sum && <div className="live-wait mono">{state.status === "loading" ? "WAITING FOR DATA…" : "NO LIVE DATA"}</div>}
          {sum && (
            <ul className="warn-list">
              {[sum.study, ...sum.regions].map((r) => {
                const max = Math.max(1, ...r.daily);
                return (
                  <li key={r.id}>
                    <button className={focus === r.id ? "on" : ""} onClick={() => setFocus(r.id)}>
                      <span className="wl-name">
                        <i style={{ background: r.id === "study_area" ? "#fff" : r.color }} />
                        {r.id === "study_area" ? "All four regions" : r.name}
                      </span>
                      <span className="wl-bars" aria-hidden>
                        {r.daily.map((v, i) => (
                          <i key={i} style={{ height: `${Math.max(6, (100 * v) / max)}%`, opacity: i === r.daily.length - 1 ? 0.4 : 1 }} />
                        ))}
                      </span>
                      <span className="wl-ratio mono">{Number.isFinite(r.ratio) ? `${r.ratio.toFixed(1)}×` : "–"}</span>
                      <span className="wl-chip mono" style={{ color: TONE_COLOR[r.level.tone], borderColor: TONE_COLOR[r.level.tone] }}>
                        {r.level.label}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="hud-panel glass">
          <div className="panel-head">
            <span className="mono">HOW TO READ THIS</span>
          </div>
          <ul className="live-notes">
            <li>The last seven complete UTC days of NOAA-20 detections, ranked against every comparable week in the 2001–2025 record. Today is shown but not counted.</li>
            <li>Live data is FIRMS near-real-time, which is preliminary. Gas flares and other static heat sources are not filtered out yet, so counts can run a little high.</li>
            <li>NOAA-21 is shown for comparison. The record's scale is NOAA-20, so the ranking uses NOAA-20 only.</li>
            <li>Brightest points are the newest; red points are up to a week old.</li>
          </ul>
        </div>

        <div className="hud-panel glass link-panel">
          <button onClick={() => go("record")}>
            <span className="mono">OPEN</span> See this time of year in the record <i>→</i>
          </button>
        </div>
      </aside>
    </div>
  );
}
