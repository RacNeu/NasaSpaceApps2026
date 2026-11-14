import { useEffect, useMemo, useRef, useState } from "react";
import { area, line } from "d3-shape";
import { scaleLinear, scalePow } from "d3-scale";
import type { Dataset } from "../types";
import { dateAt, fmtDate, fmtNum, fmtShort, indexOf, monthName, rollingMean } from "../lib";

interface Props {
  data: Dataset;
  regionId: string;
  t: number;
  onPick: (t: number) => void;
}

const M = { top: 12, right: 14, bottom: 24, left: 46 };
const H = 300;

const SENSOR_COLORS = { modis: "#45B8D1", snpp: "#FFC27A", noaa20: "#FF9D43" };

export function YearChart({ data, regionId, t, onPick }: Props) {
  const { meta, daily } = data;
  const s = daily.regions[regionId];
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [show, setShow] = useState({ modis: true, snpp: false, noaa20: false, normal: true });
  const [smooth, setSmooth] = useState(true);
  const [sqrt, setSqrt] = useState(false);
  const [hoverI, setHoverI] = useState<number | null>(null);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const sm = useMemo(() => {
    const f = (a: Float32Array) => (smooth ? rollingMean(a, 7) : a);
    return {
      modis: f(s.modis),
      snpp: f(s.snpp),
      noaa20: f(s.noaa20),
      harm: f(s.harm),
      lo: f(s.lo),
      hi: f(s.hi),
      norm: s.norm,
      norm90: s.norm90,
    };
  }, [s, smooth]);

  const year = dateAt(meta.start, t).getUTCFullYear();
  const first = indexOf(meta.start, `${year}-01-01`);
  const len = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
  const last = Math.min(first + len - 1, daily.days - 1);
  const n = last - first + 1;
  const iw = width - M.left - M.right;
  const ih = H - M.top - M.bottom;

  const idxs = useMemo(() => Array.from({ length: n }, (_, k) => first + k), [first, n]);
  const x = useMemo(() => scaleLinear().domain([0, len - 1]).range([0, iw]), [len, iw]);

  const ymax = useMemo(() => {
    let m = 1;
    for (const i of idxs) {
      const cands = [sm.harm[i], sm.hi[i], show.normal ? sm.norm90[i] : NaN];
      if (show.modis) cands.push(sm.modis[i]);
      if (show.snpp) cands.push(sm.snpp[i]);
      if (show.noaa20) cands.push(sm.noaa20[i]);
      for (const v of cands) if (!Number.isNaN(v) && v > m) m = v;
    }
    return m * 1.06;
  }, [idxs, sm, show]);

  const y = useMemo(
    () => (sqrt ? scalePow().exponent(0.5).domain([0, ymax]).range([ih, 0]) : scaleLinear().domain([0, ymax]).range([ih, 0])),
    [sqrt, ymax, ih],
  );

  const mk = (a: Float32Array) =>
    line<number>()
      .defined((i) => !Number.isNaN(a[i]))
      .x((i) => x(i - first))
      .y((i) => y(a[i]))(idxs) ?? "";

  const harmObs = (i: number) => (s.src[i] === 1 ? sm.harm[i] : NaN);
  const harmEst = (i: number) => (s.src[i] === 2 ? sm.harm[i] : NaN);
  const pathObs = line<number>().defined((i) => !Number.isNaN(harmObs(i))).x((i) => x(i - first)).y((i) => y(harmObs(i)))(idxs) ?? "";
  const pathEst = line<number>().defined((i) => !Number.isNaN(harmEst(i))).x((i) => x(i - first)).y((i) => y(harmEst(i)))(idxs) ?? "";
  const bandPath =
    area<number>()
      .defined((i) => s.src[i] === 2 && !Number.isNaN(sm.lo[i]) && !Number.isNaN(sm.hi[i]))
      .x((i) => x(i - first))
      .y0((i) => y(sm.lo[i]))
      .y1((i) => y(sm.hi[i]))(idxs) ?? "";
  const normBand =
    area<number>()
      .defined((i) => !Number.isNaN(sm.norm90[i]) && !Number.isNaN(sm.norm[i]))
      .x((i) => x(i - first))
      .y0((i) => y(sm.norm[i]))
      .y1((i) => y(sm.norm90[i]))(idxs) ?? "";

  const ticks = y.ticks(4);
  const hasEst = idxs.some((i) => s.src[i] === 2);
  const hasObs = idxs.some((i) => s.src[i] === 1);
  const tipI = hoverI ?? null;
  const toggle = (k: keyof typeof show) => setShow((p) => ({ ...p, [k]: !p[k] }));

  return (
    <div ref={wrap} className="year-wrap">
      <div className="chart-controls">
        <div className="chip-row" role="group" aria-label="Layers">
          <button className={`chip ${show.normal ? "on" : ""}`} onClick={() => toggle("normal")}>
            <i style={{ background: "#7c8799" }} />
            Normal range
          </button>
          {(["modis", "snpp", "noaa20"] as const).map((k) => (
            <button key={k} className={`chip ${show[k] ? "on" : ""}`} onClick={() => toggle(k)}>
              <i style={{ background: SENSOR_COLORS[k] }} />
              Raw {k === "modis" ? "MODIS" : k === "snpp" ? "Suomi NPP" : "NOAA-20"}
            </button>
          ))}
        </div>
        <div className="chip-row">
          <button className={`chip ${smooth ? "on" : ""}`} onClick={() => setSmooth(!smooth)}>
            7-day smoothing
          </button>
          <button className={`chip ${sqrt ? "on" : ""}`} onClick={() => setSqrt(!sqrt)}>
            Square-root scale
          </button>
        </div>
      </div>
      <svg
        width={width}
        height={H}
        onMouseMove={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const d = Math.round(x.invert(e.clientX - r.left - M.left));
          setHoverI(d >= 0 && d < n ? first + d : null);
        }}
        onMouseLeave={() => setHoverI(null)}
        onClick={() => hoverI !== null && onPick(hoverI)}
        role="img"
        aria-label={`Daily fire detections for ${year}`}
      >
        <g transform={`translate(${M.left},${M.top})`}>
          {ticks.map((v) => (
            <g key={v} transform={`translate(0,${y(v)})`}>
              <line x1={0} x2={iw} className="grid" />
              <text x={-8} dy="0.32em" textAnchor="end" className="axis">
                {fmtNum(v)}
              </text>
            </g>
          ))}
          {Array.from({ length: 12 }, (_, m) => {
            const d = (Date.UTC(year, m, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
            return (
              <text key={m} x={x(d) + 2} y={ih + 16} className="axis">
                {monthName(m)}
              </text>
            );
          })}
          {show.normal && <path d={normBand} className="norm-band" />}
          {show.normal && <path d={mk(sm.norm)} className="norm-line" />}
          {bandPath && <path d={bandPath} className="est-band" />}
          {show.modis && <path d={mk(sm.modis)} stroke={SENSOR_COLORS.modis} className="raw-line" />}
          {show.snpp && <path d={mk(sm.snpp)} stroke={SENSOR_COLORS.snpp} className="raw-line" />}
          {show.noaa20 && <path d={mk(sm.noaa20)} stroke={SENSOR_COLORS.noaa20} className="raw-line" />}
          <path key={`obs-${year}`} d={pathObs} className="harm-line draw-line" pathLength={1} />
          <path d={pathEst} className="harm-line est" />
          <line x1={x(t - first)} x2={x(t - first)} y1={0} y2={ih} className="sel-line" />
          {tipI !== null && <line x1={x(tipI - first)} x2={x(tipI - first)} y1={0} y2={ih} className="hover-line" />}
        </g>
      </svg>
      <div className="chart-legend">
        <span>
          <i className="swatch harm" />
          Harmonized (VIIRS-equivalent)
        </span>
        {hasEst && (
          <span>
            <i className="swatch est" />
            Estimated from MODIS, shaded 80% band
          </span>
        )}
        {!hasObs && <span className="muted">No VIIRS yet in {year}: the whole year is estimated.</span>}
      </div>
      {tipI !== null && (
        <div className="chart-tip" style={{ left: Math.min(M.left + x(tipI - first) + 12, width - 230), top: 40 }}>
          <strong>{fmtDate(dateAt(meta.start, tipI))}</strong>
          <div>
            Harmonized: <b>{Number.isNaN(sm.harm[tipI]) ? "no data" : fmtNum(sm.harm[tipI])}</b>
            {s.src[tipI] === 2 && !Number.isNaN(sm.lo[tipI]) && (
              <span className="muted">
                {" "}
                ({fmtNum(sm.lo[tipI])} to {fmtNum(sm.hi[tipI])})
              </span>
            )}
          </div>
          {show.normal && !Number.isNaN(sm.norm[tipI]) && <div>Typical: {fmtNum(sm.norm[tipI])}</div>}
          {show.modis && <div style={{ color: SENSOR_COLORS.modis }}>MODIS raw: {fmtNum(sm.modis[tipI])}</div>}
          {show.snpp && <div style={{ color: SENSOR_COLORS.snpp }}>Suomi NPP raw: {fmtNum(sm.snpp[tipI])}</div>}
          {show.noaa20 && <div style={{ color: SENSOR_COLORS.noaa20 }}>NOAA-20 raw: {fmtNum(sm.noaa20[tipI])}</div>}
        </div>
      )}
      <div className="chart-foot">
        Detections per day in the selected region, {year}. Selected day: {fmtShort(dateAt(meta.start, t))}.
      </div>
    </div>
  );
}
