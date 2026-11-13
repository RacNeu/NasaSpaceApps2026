import { useEffect, useMemo, useRef, useState } from "react";
import { scaleLinear } from "d3-scale";
import { interpolateInferno } from "d3-scale-chromatic";
import { quantile } from "d3-array";
import type { Dataset } from "../types";
import { dateAt, dayOfYear, fmtDate, fmtNum, indexOf, levelFor, monthName } from "../lib";

export type HeatMode = "anomaly" | "level";

interface Props {
  data: Dataset;
  regionId: string;
  t: number;
  mode: HeatMode;
  onPick: (t: number) => void;
}

const LEFT = 46;
const TOP = 18;
const ROW = 17;

const anomalyScale = scaleLinear<string>()
  .domain([0, 25, 50, 75, 90, 97, 100])
  .range(["#1d3a56", "#27384a", "#363a40", "#6a4a2c", "#bb5b1f", "#e5484d", "#ffd9d9"])
  .clamp(true);

export function CalendarHeatmap({ data, regionId, t, mode, onPick }: Props) {
  const { meta, daily } = data;
  const s = daily.regions[regionId];
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(900);
  const [tip, setTip] = useState<{ x: number; y: number; i: number } | null>(null);
  const y0 = Number(meta.start.slice(0, 4));
  const y1 = Number(meta.end.slice(0, 4));
  const years = y1 - y0 + 1;
  const height = TOP + years * ROW + 4;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const vmax = useMemo(() => {
    const vals = Array.from(s.harm).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
    return quantile(vals, 0.985) ?? 1;
  }, [s]);

  const cw = (width - LEFT - 4) / 366;
  const yearFirst = useMemo(
    () => Array.from({ length: years }, (_, yi) => indexOf(meta.start, `${y0 + yi}-01-01`)),
    [years, y0, meta.start],
  );

  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr;
    cv.height = height * dpr;
    cv.style.width = `${width}px`;
    cv.style.height = `${height}px`;
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const selDate = dateAt(meta.start, t);
    for (let yi = 0; yi < years; yi++) {
      const first = yearFirst[yi];
      const year = y0 + yi;
      const len = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
      let est = 0;
      let tot = 0;
      for (let d = 0; d < len; d++) {
        const i = first + d;
        if (i >= daily.days) break;
        const x = LEFT + d * cw;
        const y = TOP + yi * ROW;
        let fill = "rgba(255,255,255,0.045)";
        let alpha = 1;
        if (s.src[i] > 0) {
          tot++;
          if (s.src[i] === 2) {
            est++;
            alpha = 0.72;
          }
          if (mode === "anomaly") {
            const p = s.pct[i];
            fill = Number.isNaN(p) ? "rgba(255,255,255,0.045)" : anomalyScale(p);
          } else {
            fill = interpolateInferno(0.06 + 0.92 * Math.sqrt(Math.min(1, Math.max(0, s.harm[i]) / vmax)));
          }
        }
        ctx.globalAlpha = alpha;
        ctx.fillStyle = fill;
        ctx.fillRect(x, y, Math.max(cw - 0.2, 0.8), ROW - 2);
      }
      ctx.globalAlpha = 1;
      const isSelYear = selDate.getUTCFullYear() === year;
      ctx.fillStyle = isSelYear ? "#fff" : "rgba(231,236,243,0.62)";
      ctx.textAlign = "right";
      ctx.fillText(`${year}${est > tot / 2 ? "~" : ""}`, LEFT - 6, TOP + yi * ROW + ROW / 2 - 1);
    }
    ctx.fillStyle = "rgba(231,236,243,0.6)";
    ctx.textAlign = "left";
    for (let m = 0; m < 12; m++) {
      const d = (Date.UTC(2001, m, 1) - Date.UTC(2001, 0, 1)) / 86_400_000;
      ctx.fillText(monthName(m), LEFT + d * cw + 2, 8);
    }
    // selected day marker
    const si = selDate.getUTCFullYear() - y0;
    if (si >= 0 && si < years) {
      const x = LEFT + dayOfYear(selDate) * cw;
      const y = TOP + si * ROW;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x - 2, y - 1, Math.max(cw, 1) + 4, ROW);
    }
  }, [s, width, height, t, mode, vmax, cw, years, y0, yearFirst, meta.start, daily.days]);

  const locate = (e: React.MouseEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const d = Math.floor((x - LEFT) / cw);
    const yi = Math.floor((y - TOP) / ROW);
    if (d < 0 || d > 365 || yi < 0 || yi >= years) return null;
    const i = yearFirst[yi] + d;
    if (i >= daily.days || dateAt(meta.start, i).getUTCFullYear() !== y0 + yi) return null;
    return { i, x, y };
  };

  const tipInfo = tip && {
    date: fmtDate(dateAt(meta.start, tip.i)),
    v: s.harm[tip.i],
    p: s.pct[tip.i],
    est: s.src[tip.i] === 2,
    none: s.src[tip.i] === 0,
  };

  return (
    <div ref={wrap} className="heat-wrap">
      <canvas
        ref={canvas}
        className="heat"
        role="img"
        aria-label="Calendar heatmap of fire activity, one row per year"
        onMouseMove={(e) => {
          const p = locate(e);
          setTip(p ? { x: p.x, y: p.y, i: p.i } : null);
        }}
        onMouseLeave={() => setTip(null)}
        onClick={(e) => {
          const p = locate(e);
          if (p) onPick(p.i);
        }}
      />
      {tip && tipInfo && (
        <div className="heat-tip" style={{ left: Math.min(tip.x + 12, width - 200), top: tip.y + 14 }}>
          <strong>{tipInfo.date}</strong>
          <br />
          {tipInfo.none ? (
            "No data"
          ) : (
            <>
              {fmtNum(tipInfo.v)} detections/day{tipInfo.est ? " (estimated)" : ""}
              <br />
              {levelFor(tipInfo.p).label}
              {Number.isNaN(tipInfo.p) ? "" : ` · ${Math.round(tipInfo.p)}th percentile`}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function HeatLegend({ mode }: { mode: HeatMode }) {
  if (mode === "level")
    return (
      <div className="heat-legend">
        <span>fewer</span>
        <div className="legend-bar slim" style={{ background: "linear-gradient(90deg,#0d0829,#6a176e,#dd513a,#fca50a,#fcffa4)" }} />
        <span>more detections</span>
      </div>
    );
  return (
    <div className="heat-legend">
      <span>quieter than usual</span>
      <div className="legend-bar slim" style={{ background: "linear-gradient(90deg,#1d3a56,#363a40,#6a4a2c,#bb5b1f,#e5484d,#ffd9d9)" }} />
      <span>exceptional for the time of year</span>
    </div>
  );
}
