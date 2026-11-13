import { useMemo, useState } from "react";
import { arc } from "d3-shape";
import { interpolateInferno } from "d3-scale-chromatic";
import { quantile } from "d3-array";
import type { Dataset } from "../types";
import { dateAt, dayOfYear, fmtDate, fmtNum, indexOf, monthName } from "../lib";

interface Props {
  data: Dataset;
  regionId: string;
  t: number;
  onPick: (t: number) => void;
}

const SIZE = 440;
const C = SIZE / 2;
const R_IN = 56;
const R_OUT = 200;
const WEEKS = 53;

export function FireClock({ data, regionId, t, onPick }: Props) {
  const { meta, daily } = data;
  const s = daily.regions[regionId];
  const y0 = Number(meta.start.slice(0, 4));
  const y1 = Number(meta.end.slice(0, 4));
  const years = y1 - y0 + 1;
  const ring = (R_OUT - R_IN) / years;
  const [hover, setHover] = useState<{ year: number; week: number } | null>(null);

  const cells = useMemo(() => {
    const out: { year: number; week: number; v: number; t: number; observed: boolean }[] = [];
    for (let yi = 0; yi < years; yi++) {
      const year = y0 + yi;
      const first = indexOf(meta.start, `${year}-01-01`);
      const len = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / 86_400_000;
      for (let w = 0; w < WEEKS; w++) {
        let sum = 0;
        let n = 0;
        let obs = 0;
        for (let k = w * 7; k < Math.min(len, w * 7 + 7); k++) {
          const i = first + k;
          if (i >= daily.days) break;
          const v = s.harm[i];
          if (!Number.isNaN(v)) {
            sum += v;
            n++;
            if (s.src[i] === 1) obs++;
          }
        }
        out.push({ year, week: w, v: n >= 3 ? sum / n : NaN, t: Math.min(first + w * 7 + 3, daily.days - 1), observed: obs >= n / 2 });
      }
    }
    return out;
  }, [s, years, y0, meta.start, daily.days]);

  const vmax = useMemo(() => {
    const vals = cells.map((c) => c.v).filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
    return quantile(vals, 0.985) ?? 1;
  }, [cells]);

  const gen = arc<{ r0: number; r1: number; a0: number; a1: number }>()
    .innerRadius((d) => d.r0)
    .outerRadius((d) => d.r1)
    .startAngle((d) => d.a0)
    .endAngle((d) => d.a1)
    .padAngle(0.002);

  const color = (v: number) => interpolateInferno(0.08 + 0.9 * Math.sqrt(Math.min(1, v / vmax)));
  const sel = dateAt(meta.start, t);
  const selYear = sel.getUTCFullYear();
  const selAngle = (dayOfYear(sel) / 365.25) * 2 * Math.PI;
  const polar = (a: number, r: number) => [C + r * Math.sin(a), C - r * Math.cos(a)];

  return (
    <div className="clock-wrap">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label="Fire clock: each ring is a year, each slice a week" className="clock">
        {cells.map((c) => {
          const ri = c.year - y0;
          const d = gen({
            r0: R_IN + ri * ring,
            r1: R_IN + (ri + 1) * ring - 0.4,
            a0: (c.week / WEEKS) * 2 * Math.PI,
            a1: ((c.week + 1) / WEEKS) * 2 * Math.PI,
          });
          const isSel = c.year === selYear && Math.floor(dayOfYear(sel) / 7) === c.week;
          return (
            <path
              key={`${c.year}-${c.week}`}
              d={d ?? undefined}
              transform={`translate(${C},${C})`}
              fill={Number.isNaN(c.v) ? "rgba(255,255,255,0.04)" : color(c.v)}
              opacity={c.observed || Number.isNaN(c.v) ? 1 : 0.78}
              stroke={isSel ? "#fff" : "none"}
              strokeWidth={isSel ? 1.4 : 0}
              onMouseEnter={() => setHover({ year: c.year, week: c.week })}
              onMouseLeave={() => setHover(null)}
              onClick={() => onPick(c.t)}
              style={{ cursor: "pointer" }}
            />
          );
        })}
        {Array.from({ length: 12 }, (_, m) => {
          const a = ((Date.UTC(2001, m, 1) - Date.UTC(2001, 0, 1)) / 86_400_000 / 365.25) * 2 * Math.PI;
          const [x1, y1_] = polar(a, R_OUT + 3);
          const [x2, y2] = polar(a, R_OUT + 9);
          const [lx, ly] = polar(a + 0.26, R_OUT + 17);
          return (
            <g key={m} className="clock-month">
              <line x1={x1} y1={y1_} x2={x2} y2={y2} />
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle">
                {monthName(m)}
              </text>
            </g>
          );
        })}
        <line
          x1={polar(selAngle, R_IN - 6)[0]}
          y1={polar(selAngle, R_IN - 6)[1]}
          x2={polar(selAngle, R_OUT + 6)[0]}
          y2={polar(selAngle, R_OUT + 6)[1]}
          className="clock-hand"
        />
        {Array.from({ length: years }, (_, yi) => ({ yi, year: y0 + yi }))
          .filter((d) => d.year % 5 === 0 || d.year === y0 || d.year === y1)
          .map((d) => (
            <text key={d.year} x={C - 3} y={C - (R_IN + (d.yi + 0.5) * ring) + 3} textAnchor="end" className="clock-year">
              {d.year}
            </text>
          ))}
        <text x={C} y={C - 4} textAnchor="middle" className="clock-center-year">
          {selYear}
        </text>
        <text x={C} y={C + 14} textAnchor="middle" className="clock-center-sub">
          inner ring = {y0}
        </text>
      </svg>
      <div className="clock-caption">
        {hover ? (
          (() => {
            const c = cells.find((x) => x.year === hover.year && x.week === hover.week);
            return c ? (
              <>
                <strong>{fmtDate(dateAt(meta.start, c.t))}</strong>
                {Number.isNaN(c.v) ? " · no data" : ` · about ${fmtNum(c.v)} detections/day${c.observed ? "" : " (estimated from MODIS)"}`}
              </>
            ) : null;
          })()
        ) : (
          <>Each ring is one year; click a slice to jump to that week. Faded slices are estimated from MODIS.</>
        )}
      </div>
    </div>
  );
}
