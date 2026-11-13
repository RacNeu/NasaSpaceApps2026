import { scaleLinear } from "d3-scale";
import { interpolateRgb } from "d3-interpolate";
import type { Matching } from "../types";

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Match rate for every radius and time tolerance. Click a cell to apply it. */
export function SweepGrid({
  matching, period, satellite, radius, dt, onPick,
}: {
  matching: Matching;
  period: string;
  satellite: "Aqua" | "Terra" | "VIIRS-by-Aqua";
  radius: number;
  dt: number;
  onPick: (r: number, t: number) => void;
}) {
  const rate = (r: number, t: number) =>
    matching.sweep.find((x) => x.period === period && x.satellite === satellite && x.radius_km === r && x.dt_min === t)?.rate ?? 0;
  const color = (v: number) => interpolateRgb("#14202f", "#45B8D1")(Math.min(1, v / 0.8));
  const radii = matching.radii_km;
  const times = matching.times_min;
  const cw = 54;
  const ch = 32;
  const left = 62;
  const top = 34;
  return (
    <svg viewBox={`0 0 ${left + times.length * cw + 6} ${top + radii.length * ch + 30}`} className="mchart" role="img" aria-label="Match rate by radius and time tolerance">
      <text x={left} y="12" className="axis-title">
        time tolerance (minutes)
      </text>
      {times.map((t, i) => (
        <text key={t} x={left + i * cw + cw / 2} y={top - 8} textAnchor="middle" className="axis mono">
          {t}
        </text>
      ))}
      {radii.map((r, j) => (
        <g key={r}>
          <text x={left - 8} y={top + j * ch + ch / 2} dy="0.32em" textAnchor="end" className="axis mono">
            {r} km
          </text>
          {times.map((t, i) => {
            const v = rate(r, t);
            const sel = r === radius && t === dt;
            return (
              <g key={t} onClick={() => onPick(r, t)} style={{ cursor: "pointer" }}>
                <rect x={left + i * cw + 1} y={top + j * ch + 1} width={cw - 2} height={ch - 2} rx="4" fill={color(v)} stroke={sel ? "#fff" : "none"} strokeWidth="1.6" />
                <text x={left + i * cw + cw / 2} y={top + j * ch + ch / 2} dy="0.32em" textAnchor="middle" className="cell-text mono" fill={v > 0.4 ? "#06121c" : "#cfe6ee"}>
                  {pct(v)}
                </text>
              </g>
            );
          })}
        </g>
      ))}
      <text x={left} y={top + radii.length * ch + 22} className="axis-title">
        search radius on the left
      </text>
    </svg>
  );
}

/** How far apart in time the nearest VIIRS partner is, for Aqua and for Terra. */
export function OffsetHistogram({ matching }: { matching: Matching }) {
  const a = matching.offsets.Aqua;
  const t = matching.offsets.Terra;
  const W = 520;
  const H = 210;
  const m = { l: 40, r: 10, t: 12, b: 34 };
  const n = a.counts.length;
  const total = (c: number[]) => c.reduce((x, y) => x + y, 0) || 1;
  const ta = total(a.counts);
  const tt = total(t.counts);
  const max = Math.max(...a.counts.map((c) => c / ta), ...t.counts.map((c) => c / tt));
  const x = scaleLinear().domain([0, n]).range([m.l, W - m.r]);
  const y = scaleLinear().domain([0, max * 1.08]).range([H - m.b, m.t]);
  const bw = (W - m.l - m.r) / n;
  const ticks = [-180, -120, -60, 0, 60, 120, 180];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mchart" role="img" aria-label="Time difference to the nearest VIIRS detection, Aqua versus Terra">
      {y.ticks(3).map((v) => (
        <g key={v}>
          <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={m.l - 6} y={y(v)} dy="0.32em" textAnchor="end" className="axis mono">
            {Math.round(v * 100)}%
          </text>
        </g>
      ))}
      {a.counts.map((c, i) => (
        <g key={i}>
          <rect x={x(i) + 0.5} y={y(t.counts[i] / tt)} width={Math.max(bw - 1, 1)} height={y(0) - y(t.counts[i] / tt)} fill="#6fd3e6" opacity="0.35" />
          <rect x={x(i) + 0.5} y={y(c / ta)} width={Math.max(bw - 1, 1)} height={y(0) - y(c / ta)} fill="#FF9D43" opacity="0.9" />
        </g>
      ))}
      {ticks.map((tk) => {
        const i = (tk - a.bins[0]) / 10;
        return (
          <text key={tk} x={x(i)} y={H - m.b + 16} textAnchor="middle" className="axis mono">
            {tk > 0 ? `+${tk}` : tk}
          </text>
        );
      })}
      <text x={(W + m.l) / 2} y={H - 4} textAnchor="middle" className="axis-title">
        minutes between a MODIS detection and its nearest VIIRS neighbour
      </text>
      <g transform={`translate(${m.l + 8},${m.t + 4})`} className="axis">
        <rect width="10" height="10" fill="#FF9D43" />
        <text x="16" y="9">Aqua</text>
        <rect x="62" width="10" height="10" fill="#6fd3e6" opacity="0.5" />
        <text x="78" y="9">Terra</text>
      </g>
    </svg>
  );
}

/** Share of detections the other sensor also reports, by fire power. */
export function FrpBars({ matching }: { matching: Matching }) {
  const f = matching.frp;
  const W = 520;
  const H = 230;
  const m = { l: 40, r: 10, t: 14, b: 44 };
  const n = f.bins_mw.length;
  const cov = f.viirs_seen_by_modis_covered;
  const bars = f.bins_mw.map((label, i) => ({
    label,
    v: cov ? cov[i] : f.viirs_seen_by_modis[i],
    raw: f.viirs_seen_by_modis[i],
    n: f.viirs_total[i],
  }));
  const y = scaleLinear().domain([0, 1]).range([H - m.b, m.t]);
  const bw = (W - m.l - m.r) / n;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mchart" role="img" aria-label="Share of VIIRS detections also seen by Aqua, by fire power">
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line x1={m.l} x2={W - m.r} y1={y(v)} y2={y(v)} className="grid" />
          <text x={m.l - 6} y={y(v)} dy="0.32em" textAnchor="end" className="axis mono">
            {Math.round(v * 100)}%
          </text>
        </g>
      ))}
      {bars.map((b, i) => (
        <g key={b.label}>
          <rect x={m.l + i * bw + 8} y={y(b.raw)} width={bw - 16} height={y(0) - y(b.raw)} fill="#FF9D43" opacity="0.28" />
          <rect x={m.l + i * bw + 8} y={y(b.v)} width={bw - 16} height={y(0) - y(b.v)} fill="#FF9D43" />
          <text x={m.l + i * bw + bw / 2} y={y(b.v) - 5} textAnchor="middle" className="cell-text mono" fill="#ffd9ae">
            {Math.round(b.v * 100)}%
          </text>
          <text x={m.l + i * bw + bw / 2} y={H - m.b + 15} textAnchor="middle" className="axis mono">
            {b.label}
          </text>
        </g>
      ))}
      <text x={(W + m.l) / 2} y={H - 6} textAnchor="middle" className="axis-title">
        fire radiative power of the VIIRS detection (MW)
      </text>
    </svg>
  );
}
