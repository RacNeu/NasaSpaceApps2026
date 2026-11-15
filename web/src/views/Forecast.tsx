import { useEffect, useMemo, useState } from "react";
import { scaleLinear, scaleSqrt } from "d3-scale";
import { area as d3area, line as d3line } from "d3-shape";
import type { Mission, ViewId } from "../mission";
import { Scramble, Ticker } from "../fx";
import { fmtNum } from "../lib";
import { MapView, type MapFocus } from "../components/MapView";
import { loadCountryGrid, type CountryGrid } from "../world";
import { DroughtCard, HazeCard, SeasonTiming, SectionNav, SectionTag, type DroughtInfo, type HazeInfo, type SeasonInfo } from "../components/ForecastExtras";
import "../forecast.css";

/* ------------------------------------------------------------------ data */

export interface Week {
  end: string;
  p10: number;
  p50: number;
  p90: number;
  normal: number;
  critical: number;
  p_above: number;
  p_critical: number;
}
interface Skill {
  h: number;
  mae_model: number;
  mae_clim: number;
  improvement: number | null;
  improvement_without_enso?: number | null;
  improvement_without_drought?: number | null;
  critical_weeks: number;
  warned: number;
  false_alarms: number;
}
export interface RegionForecast {
  issued: string;
  weeks: Week[];
  recent: { end: string; obs: number | null; normal: number; critical: number }[];
  skill: Skill[];
  hindcast: { lead_weeks: number; start: string; obs: (number | null)[]; pred: ([number, number, number] | null)[]; normal: (number | null)[] };
  month_to_date: { month: string; days: number; total: number; median: number; rank: number; years: number } | null;
  oni_now: number | null;
  drought?: DroughtInfo | null;
  season?: SeasonInfo;
}
export interface RiskPeriod {
  label: string;
  from: string;
  to: string;
  /** [cell index in grid.json, expected per week, normal per week] */
  cells: [number, number, number][];
}
export interface ForecastFile {
  generated: string;
  horizon_weeks: number;
  regions: Record<string, RegionForecast>;
  map?: { note: string; periods: RiskPeriod[] };
  haze?: HazeInfo;
  weather_source?: string;
  oni: { source: string; latest: { season: string; year: number; anom: number }; series: [string, number][] };
}

const cache = new Map<string, Promise<ForecastFile>>();
export const loadForecast = (path: string) => {
  if (!cache.has(path))
    cache.set(
      path,
      fetch(`${import.meta.env.BASE_URL}${path}forecast.json`).then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      }),
    );
  return cache.get(path)!;
};

/* ------------------------------------------------------------------ helpers */

const D = (s: string) => new Date(`${s}T00:00:00Z`);
const fmtDay = (s: string) => D(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const fmtMonth = (s: string) => D(s).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
const weekStart = (end: string) => new Date(D(end).getTime() - 6 * 86_400_000).toISOString().slice(0, 10);

export function ensoLabel(v: number | null | undefined) {
  if (v == null) return { label: "Unknown", tone: "" };
  if (v >= 1.5) return { label: "Strong El Niño", tone: "fire" };
  if (v >= 1.0) return { label: "Moderate El Niño", tone: "fire" };
  if (v >= 0.5) return { label: "Weak El Niño", tone: "amber" };
  if (v <= -1.0) return { label: "La Niña", tone: "cyan" };
  if (v <= -0.5) return { label: "Weak La Niña", tone: "cyan" };
  return { label: "Neutral", tone: "" };
}

/** Accessible diverging colour for the chance of an above-normal week (blue below, orange above). */
const chanceColour = (p: number) => {
  const stops: [number, [number, number, number]][] = [
    [0, [43, 124, 170]],
    [0.35, [92, 160, 190]],
    [0.5, [70, 82, 96]],
    [0.65, [232, 140, 70]],
    [1, [240, 90, 66]],
  ];
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i];
    const [p0, c0] = stops[i - 1];
    if (p <= p1) {
      const f = (p - p0) / (p1 - p0);
      return `rgb(${c0.map((c, k) => Math.round(c + (c1[k] - c) * f)).join(",")})`;
    }
  }
  return "rgb(240,90,66)";
};

const usefulWeeks = (s: Skill[]) => {
  let n = 0;
  for (const x of s) {
    if ((x.improvement ?? 0) >= 0.05) n = x.h;
    else break;
  }
  return n;
};

/* ------------------------------------------------------------------ charts */

function OutlookChart({ f, hover, setHover }: { f: RegionForecast; hover: number | null; setHover: (i: number | null) => void }) {
  const W = 980;
  const Hh = 300;
  const pad = { l: 46, r: 14, t: 16, b: 30 };
  const past = f.recent;
  const fut = f.weeks;
  const n = past.length + fut.length;
  const max = Math.max(1, ...past.map((p) => Math.max(p.obs ?? 0, p.critical)), ...fut.map((w) => Math.max(w.p90, w.critical)));
  const x = scaleLinear().domain([-0.5, n - 0.5]).range([pad.l, W - pad.r]);
  const y = scaleSqrt().domain([0, max * 1.05]).range([Hh - pad.b, pad.t]);
  const bw = (x(1) - x(0)) * 0.72;
  const fi = (k: number) => past.length + k;
  const band = d3area<Week>().x((_, k) => x(fi(k))).y0((w) => y(w.p10)).y1((w) => y(w.p90))(fut) ?? "";
  const mid = d3line<Week>().x((_, k) => x(fi(k))).y((w) => y(w.p50))([...fut]) ?? "";
  const all = [...past.map((p) => ({ normal: p.normal, critical: p.critical })), ...fut];
  const normal = d3line<{ normal: number }>().x((_, k) => x(k)).y((p) => y(p.normal))(all) ?? "";
  const crit = d3line<{ critical: number }>().x((_, k) => x(k)).y((p) => y(p.critical))(all) ?? "";
  const ticks = y.ticks(4).filter((v) => v > 0);
  const months: { k: number; label: string }[] = [];
  const ends = [...past.map((p) => p.end), ...fut.map((w) => w.end)];
  ends.forEach((e, k) => {
    if (k === 0 || D(e).getUTCMonth() !== D(ends[k - 1]).getUTCMonth()) months.push({ k, label: fmtMonth(e) });
  });
  const lastObs = past[past.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="fc-chart" role="img" aria-label="Weekly fire detections: the last six months observed, then the forecast for the next 26 weeks with its 80% range">
      <defs>
        <linearGradient id="fcband" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#FF9D43" stopOpacity="0.45" />
          <stop offset="1" stopColor="#FF9D43" stopOpacity="0.12" />
        </linearGradient>
      </defs>
      {/* critical-period shading */}
      {fut.map((w, k) =>
        w.p_critical >= 0.3 ? (
          <rect key={`c${k}`} x={x(fi(k)) - (x(1) - x(0)) / 2} width={x(1) - x(0)} y={pad.t} height={Hh - pad.b - pad.t} fill="#F05A42" opacity={0.08 + 0.25 * w.p_critical} />
        ) : null,
      )}
      {ticks.map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.06)" />
          <text x={pad.l - 6} y={y(v) + 3} textAnchor="end" className="fc-tick">
            {fmtNum(v)}
          </text>
        </g>
      ))}
      {months.map((mo) => (
        <text key={mo.k} x={x(mo.k)} y={Hh - 10} className="fc-tick">
          {mo.label.toUpperCase()}
        </text>
      ))}
      {/* observed weeks */}
      {past.map((p, k) =>
        p.obs == null ? null : (
          <rect
            key={`o${k}`}
            className="fc-bar grow"
            style={{ animationDelay: `${k * 18}ms` }}
            x={x(k) - bw / 2}
            width={bw}
            y={y(p.obs)}
            height={Math.max(0, y(0) - y(p.obs))}
            fill={p.obs > p.critical ? "#F05A42" : p.obs > p.normal ? "#FF9D43" : "#3d7f9a"}
          />
        ),
      )}
      <path d={band} fill="url(#fcband)" className="fade-in" />
      <path d={mid} fill="none" stroke="#FFC27A" strokeWidth="2.2" className="draw-line" pathLength={1} />
      <path d={normal} fill="none" stroke="#9fb2c4" strokeWidth="1.2" strokeDasharray="4 4" />
      <path d={crit} fill="none" stroke="#F05A42" strokeWidth="1.2" strokeDasharray="1 4" strokeLinecap="round" />
      {/* now */}
      <line x1={x(past.length - 0.5)} x2={x(past.length - 0.5)} y1={pad.t - 6} y2={Hh - pad.b} stroke="#45B8D1" strokeWidth="1.4" />
      <text x={x(past.length - 0.5) + 6} y={pad.t + 4} className="fc-now mono">
        NOW · {fmtDay(lastObs.end)}
      </text>
      <text x={x(past.length - 0.5) - 6} y={pad.t + 4} textAnchor="end" className="fc-tick">
        OBSERVED
      </text>
      {/* hover targets */}
      {Array.from({ length: n }, (_, k) => (
        <rect key={`h${k}`} x={x(k) - (x(1) - x(0)) / 2} width={x(1) - x(0)} y={pad.t} height={Hh - pad.b - pad.t} fill="transparent" onMouseEnter={() => setHover(k)} onMouseLeave={() => setHover(null)} />
      ))}
      {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={Hh - pad.b} stroke="rgba(255,255,255,0.4)" pointerEvents="none" />}
    </svg>
  );
}

function WeekStrip({ weeks, onHover, hover, offset }: { weeks: Week[]; onHover: (i: number | null) => void; hover: number | null; offset: number }) {
  return (
    <div className="fc-strip" role="list" aria-label="Chance each coming week is above normal">
      {weeks.map((w, k) => (
        <div
          key={w.end}
          role="listitem"
          className={`fc-cell ${hover === offset + k ? "on" : ""} ${w.p_critical >= 0.3 ? "crit" : ""}`}
          style={{ background: chanceColour(w.p_above), animationDelay: `${k * 25}ms` }}
          onMouseEnter={() => onHover(offset + k)}
          onMouseLeave={() => onHover(null)}
          title={`Week of ${fmtDay(weekStart(w.end))}: ${Math.round(w.p_above * 100)}% chance above normal, ${Math.round(w.p_critical * 100)}% chance critical`}
        >
          <b>{Math.round(w.p_above * 100)}</b>
          {(k === 0 || D(w.end).getUTCMonth() !== D(weeks[k - 1].end).getUTCMonth()) && <span className="mono">{fmtMonth(w.end).toUpperCase()}</span>}
        </div>
      ))}
    </div>
  );
}

function SkillChart({ skill }: { skill: Skill[] }) {
  const W = 420;
  const Hh = 170;
  const pad = { l: 34, r: 10, t: 12, b: 26 };
  const x = scaleLinear().domain([1, skill.length]).range([pad.l, W - pad.r]);
  const vals = skill.flatMap((s) => [s.improvement ?? 0, s.improvement_without_enso ?? 0]);
  const y = scaleLinear().domain([Math.min(-0.05, ...vals), Math.max(0.3, ...vals)]).range([Hh - pad.b, pad.t]);
  const ln = (k: "improvement" | "improvement_without_enso") => d3line<Skill>().x((s) => x(s.h)).y((s) => y(s[k] ?? 0))(skill) ?? "";
  return (
    <svg viewBox={`0 0 ${W} ${Hh}`} className="fc-skill" role="img" aria-label="How much better than a normal-year forecast, by weeks ahead">
      {[0, 0.1, 0.2, 0.3].map((v) => (
        <g key={v}>
          <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? "rgba(255,255,255,0.3)" : "rgba(255,255,255,0.06)"} />
          <text x={pad.l - 5} y={y(v) + 3} textAnchor="end" className="fc-tick">
            {Math.round(v * 100)}%
          </text>
        </g>
      ))}
      {[1, 4, 8, 13, 20, 26].map((h) => (
        <text key={h} x={x(h)} y={Hh - 8} textAnchor="middle" className="fc-tick">
          {h}w
        </text>
      ))}
      <path d={ln("improvement_without_enso")} fill="none" stroke="#9fb2c4" strokeWidth="1.4" strokeDasharray="4 3" />
      <path d={ln("improvement")} fill="none" stroke="#FF9D43" strokeWidth="2.2" className="draw-line" pathLength={1} />
    </svg>
  );
}

function Hindcast({ f, years, year, setYear }: { f: RegionForecast; years: number[]; year: number; setYear: (y: number) => void }) {
  const hc = f.hindcast;
  const start = D(hc.start).getTime();
  const pts = hc.obs
    .map((obs, k) => ({ k, end: new Date(start + k * 7 * 86_400_000), obs, pred: hc.pred[k], normal: hc.normal[k] }))
    .filter((p) => p.end.getUTCFullYear() === year);
  const W = 560;
  const Hh = 200;
  const pad = { l: 40, r: 10, t: 12, b: 24 };
  const max = Math.max(1, ...pts.map((p) => Math.max(p.obs ?? 0, p.pred?.[2] ?? 0)));
  const x = scaleLinear().domain([0, Math.max(1, pts.length - 1)]).range([pad.l, W - pad.r]);
  const y = scaleSqrt().domain([0, max * 1.05]).range([Hh - pad.b, pad.t]);
  const withPred = pts.map((p, i) => ({ ...p, i })).filter((p) => p.pred);
  const band = d3area<(typeof withPred)[number]>().x((p) => x(p.i)).y0((p) => y(p.pred![0])).y1((p) => y(p.pred![2]))(withPred) ?? "";
  const mid = d3line<(typeof withPred)[number]>().x((p) => x(p.i)).y((p) => y(p.pred![1]))(withPred) ?? "";
  const obs = d3line<(typeof pts)[number]>().defined((p) => p.obs != null).x((_, i) => x(i)).y((p) => y(p.obs!))(pts) ?? "";
  const norm = d3line<(typeof pts)[number]>().defined((p) => p.normal != null).x((_, i) => x(i)).y((p) => y(p.normal!))(pts) ?? "";
  const inBand = withPred.filter((p) => p.obs != null && p.obs >= p.pred![0] && p.obs <= p.pred![2]).length;
  const scored = withPred.filter((p) => p.obs != null).length;
  return (
    <>
      <div className="fc-years" role="group" aria-label="Year to replay">
        {years.map((yv) => (
          <button key={yv} className={`seg-btn ${yv === year ? "on" : ""}`} onClick={() => setYear(yv)}>
            {yv}
          </button>
        ))}
      </div>
      <svg viewBox={`0 0 ${W} ${Hh}`} className="fc-hind" role="img" aria-label={`Forecasts made four weeks ahead during ${year}, against what happened`}>
        {y.ticks(3).filter((v) => v > 0).map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.06)" />
            <text x={pad.l - 5} y={y(v) + 3} textAnchor="end" className="fc-tick">
              {fmtNum(v)}
            </text>
          </g>
        ))}
        {pts.map((p, i) =>
          i === 0 || p.end.getUTCMonth() !== pts[i - 1].end.getUTCMonth() ? (
            <text key={i} x={x(i)} y={Hh - 7} className="fc-tick">
              {p.end.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }).toUpperCase()}
            </text>
          ) : null,
        )}
        <path d={band} fill="rgba(255,157,67,0.22)" key={`b${year}`} className="fade-in" />
        <path d={norm} fill="none" stroke="#9fb2c4" strokeWidth="1.1" strokeDasharray="4 4" />
        <path d={mid} fill="none" stroke="#FFC27A" strokeWidth="1.6" />
        <path d={obs} fill="none" stroke="#fff" strokeWidth="2" key={`o${year}`} className="draw-line" pathLength={1} />
      </svg>
      <p className="fineprint">
        White: what happened. Orange: what the model said four weeks earlier, fitted without {year}, with its 80% range. Dashed: the normal.{" "}
        {scored > 0 && `${inBand} of ${scored} weeks landed inside the range.`}
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ burn-window planner */

type Rating = "good" | "caution" | "avoid";
const rate = (w: Week): Rating => (w.p_critical >= 0.25 || w.p_above >= 0.7 ? "avoid" : w.p_critical < 0.1 && w.p_above < 0.5 ? "good" : "caution");
const RATING_TEXT: Record<Rating, string> = { good: "Lower risk", caution: "Caution", avoid: "Avoid" };

/** An all-day calendar event for the chosen window, so a planner can drop it into their own calendar. */
function downloadIcs(title: string, start: string, endInclusive: string, note: string) {
  const d = (s: string) => s.replace(/-/g, "");
  const after = new Date(D(endInclusive).getTime() + 86_400_000).toISOString().slice(0, 10);
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Mission Ignis//Burn window//EN",
    "BEGIN:VEVENT",
    `UID:${d(start)}-${Date.now()}@ignis`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${d(start)}`,
    `DTEND;VALUE=DATE:${d(after)}`,
    `SUMMARY:${title}`,
    `DESCRIPTION:${note.replace(/[,;]/g, (c) => "\\" + c)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  a.download = `ignis_burn_window_${start}.ics`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function BurnPlanner({ f, regionName }: { f: RegionForecast; regionName: string }) {
  const [len, setLen] = useState(2);
  const weeks = f.weeks;
  const ratings = weeks.map(rate);
  const reliable = Math.max(usefulWeeks(f.skill), 4);

  // every possible window of `len` weeks with no "avoid" week, best (lowest risk) first
  const windows = useMemo(() => {
    const out: { i: number; score: number; ratio: number; crit: number }[] = [];
    for (let i = 0; i + len <= weeks.length; i++) {
      const seg = weeks.slice(i, i + len);
      if (seg.some((w) => rate(w) === "avoid")) continue;
      const score = seg.reduce((a, w) => a + w.p_above + 2 * w.p_critical, 0) / len + (i + len > reliable ? 0.05 : 0);
      const norm = seg.reduce((a, w) => a + w.normal, 0);
      out.push({ i, score, ratio: norm > 0 ? seg.reduce((a, w) => a + w.p50, 0) / norm : NaN, crit: Math.max(...seg.map((w) => w.p_critical)) });
    }
    out.sort((a, b) => a.score - b.score);
    const picked: typeof out = [];
    for (const w of out) {
      if (picked.length >= 3) break;
      if (picked.every((p) => w.i + len <= p.i || p.i + len <= w.i)) picked.push(w);
    }
    return picked;
  }, [weeks, len, reliable]);

  // runs of weeks to avoid
  const avoid: { a: number; b: number; crit: number }[] = [];
  ratings.forEach((r, k) => {
    if (r !== "avoid") return;
    const last = avoid[avoid.length - 1];
    if (last && last.b === k - 1) {
      last.b = k;
      last.crit = Math.max(last.crit, weeks[k].p_critical);
    } else avoid.push({ a: k, b: k, crit: weeks[k].p_critical });
  });

  const best = windows[0];
  const range = (a: number, b: number) => `${fmtDay(weekStart(weeks[a].end))} to ${fmtDay(weeks[b].end)}`;

  return (
    <section className="card glass bp" id="fc-burn">
      <SectionTag tone="teal">BURN-WINDOW PLANNER · FOR LAND MANAGERS</SectionTag>
      <div className="card-head">
        <h3>When is it safer to burn?</h3>
        <div className="seg" role="group" aria-label="How long the burning will take">
          {[1, 2, 4].map((n) => (
            <button key={n} className={len === n ? "on" : ""} onClick={() => setLen(n)}>
              {n} week{n > 1 ? "s" : ""}
            </button>
          ))}
        </div>
      </div>
      <p className="bp-lede">
        For land managers and farmers planning to burn in {regionName}: the weeks when regional fire activity is expected to be at or below normal, and a
        critical week is unlikely. Burning then is less likely to add to a regional fire or haze emergency, or to run into emergency burn bans.
      </p>

      <div className="bp-track" role="list" aria-label="Rating of each coming week">
        {weeks.map((w, k) => {
          const inBest = best && k >= best.i && k < best.i + len;
          return (
            <div
              key={w.end}
              role="listitem"
              className={`bp-week ${ratings[k]} ${inBest ? "best" : ""} ${k >= reliable ? "far" : ""}`}
              title={`Week of ${fmtDay(weekStart(w.end))}: ${RATING_TEXT[ratings[k]]} · ${Math.round(w.p_above * 100)}% above normal · ${Math.round(w.p_critical * 100)}% critical`}
            >
              {(k === 0 || D(w.end).getUTCMonth() !== D(weeks[k - 1].end).getUTCMonth()) && <span className="mono">{fmtMonth(w.end).toUpperCase()}</span>}
            </div>
          );
        })}
        {best && (
          <div className="bp-bracket" style={{ left: `${(best.i / weeks.length) * 100}%`, width: `${(len / weeks.length) * 100}%` }}>
            <span className="mono">BEST</span>
          </div>
        )}
      </div>
      <div className="bp-legend mono">
        <span>
          <i className="good" /> LOWER RISK
        </span>
        <span>
          <i className="caution" /> CAUTION
        </span>
        <span>
          <i className="avoid" /> AVOID
        </span>
        {reliable < weeks.length && (
          <span>
            <i className="far" /> BEYOND {reliable} WEEKS: CLOSE TO A TYPICAL YEAR
          </span>
        )}
      </div>

      <div className="bp-grid">
        <div className="bp-best">
          {best ? (
            <>
              <div className="mono k">BEST {len}-WEEK WINDOW</div>
              <div className="bp-when">{range(best.i, best.i + len - 1)}</div>
              <div className="fc-sub">
                expected {best.ratio.toFixed(1)}× normal · chance of a critical week {Math.round(best.crit * 100)}% at most
                {best.i + len > reliable ? " · beyond the most reliable range" : ""}
              </div>
              <button
                className="btn-primary small"
                onClick={() =>
                  downloadIcs(
                    `Burn window: ${regionName}`,
                    weekStart(weeks[best.i].end),
                    weeks[best.i + len - 1].end,
                    `Mission Ignis forecast issued ${f.issued}: expected ${best.ratio.toFixed(1)}x normal fire activity. Check local weather, rules and burn bans before burning.`,
                  )
                }
              >
                + Add to calendar (.ics)
              </button>
            </>
          ) : (
            <div className="fc-sub">No {len}-week stretch in the outlook is free of high-risk weeks. Try a shorter window.</div>
          )}
        </div>
        <div className="bp-list">
          {windows.length > 1 && (
            <>
              <div className="mono k">ALTERNATIVES</div>
              <ul>
                {windows.slice(1).map((w) => (
                  <li key={w.i}>
                    {range(w.i, w.i + len - 1)} <b>{w.ratio.toFixed(1)}× normal</b>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="mono k">AVOID</div>
          {avoid.length ? (
            <ul>
              {avoid.slice(0, 4).map((r) => (
                <li key={r.a} className="bad">
                  {range(r.a, r.b)} <b>up to {Math.round(r.crit * 100)}% critical</b>
                </li>
              ))}
            </ul>
          ) : (
            <p className="fc-sub">No week in the outlook is rated high risk.</p>
          )}
        </div>
      </div>
      <p className="fineprint">
        A planning aid, not a permit. It rates weeks only from the regional fire outlook; it does not know the weather on the day, wind, smoke dispersal or
        local law. Always check the forecast, burn bans and permits before lighting a fire. Lower risk: chance of a critical week under 10% and of an
        above-normal week under 50%. Avoid: a 25% or higher chance of a critical week, or a 70% chance of an above-normal week.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ the map */

function RiskMap({ m, file }: { m: Mission; file: ForecastFile }) {
  const { data } = m;
  const meta = data.meta;
  const [period, setPeriod] = useState(0);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [grid, setGrid] = useState<CountryGrid | null>(null);
  useEffect(() => {
    loadCountryGrid().then(setGrid).catch(() => undefined);
  }, []);

  const fc = useMemo(() => {
    const per = file.map?.periods[period];
    if (!per) return null;
    const inset = meta.cell * 0.14;
    const regionOf = (ri: number) => (ri >= 0 && meta.regions[ri]?.id !== "study_area" ? meta.regions[ri]?.name ?? "" : "");
    const features: GeoJSON.Feature[] = [];
    const spots: { lon: number; lat: number; v: number; r: number; region: string }[] = [];
    let exp = 0;
    let norm = 0;
    for (const [ci, v, n] of per.cells) {
      const cell = data.grid.cells[ci];
      if (!cell) continue;
      const [cx, cy, ri] = cell;
      exp += v;
      norm += n;
      if (v < 0.5) continue;
      const x0 = meta.box[0] + cx * meta.cell + inset;
      const y0 = meta.box[1] + cy * meta.cell + inset;
      const x1 = x0 + meta.cell - 2 * inset;
      const y1 = y0 + meta.cell - 2 * inset;
      const r = n > 0.5 ? v / n : 4;
      features.push({
        type: "Feature",
        properties: { v, n, r, h: Math.sqrt(v) * (meta.cell >= 1 ? 7000 : 5000), region: regionOf(ri) },
        geometry: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
      });
      spots.push({ lon: (x0 + x1) / 2, lat: (y0 + y1) / 2, v, r, region: regionOf(ri) });
    }
    spots.sort((a, b) => b.v - a.v);
    const top: typeof spots = [];
    for (const sp of spots) {
      if (top.length >= 6) break;
      if (top.every((t) => Math.hypot(t.lon - sp.lon, t.lat - sp.lat) > meta.cell * 3)) top.push(sp);
    }
    return { per, cols: { type: "FeatureCollection", features } as GeoJSON.FeatureCollection, exp, norm, top };
  }, [file, period, data, meta]);

  if (!fc) return null;
  const ratio = fc.norm > 0 ? fc.exp / fc.norm : NaN;
  return (
    <section className="card glass fc-mapcard" id="fc-map">
      <SectionTag tone="fire">PREDICTED BURNING · MAP</SectionTag>
      <div className="card-head">
        <h3>Predicted burning</h3>
        <span className="mono dim">
          {fmtDay(weekStart(fc.per.from))} TO {fmtDay(fc.per.to)} · {meta.cell}° CELLS
        </span>
      </div>
      <div className="fc-mapgrid">
        <div className="fc-map">
          <MapView data={data} week={0} regionId={m.regionId} globe nav highlights={0} fcCols={fc.cols} fcOn focus={focus} padding={30} />
        </div>
        <div className="fc-mapside">
          <div className="seg" role="group" aria-label="Forecast period">
            {file.map!.periods.map((p, i) => (
              <button key={p.label} className={period === i ? "on" : ""} onClick={() => setPeriod(i)}>
                {p.label.replace("Weeks ", "Wk ").replace(" to ", "–")}
              </button>
            ))}
          </div>
          <div className={`fc-big ${ratio >= 1.3 ? "fire" : ratio <= 0.75 ? "cyan" : ""}`}>
            <Ticker text={Number.isNaN(ratio) ? "n/a" : `${ratio.toFixed(1)}× normal`} />
          </div>
          <p className="fc-sub">
            about {fmtNum(fc.exp)} detections a week expected across the sector, against a normal of {fmtNum(fc.norm)}. Height is the expected
            activity; colour compares it with normal for that place and time of year.
          </p>
          <div className="fc-ramp-bar" aria-hidden>
            <span>quieter</span>
            <i />
            <span>busier</span>
          </div>
          <div className="mono k fc-watch-head">PLACES TO WATCH · CLICK TO FLY</div>
          <ul className="wl-list">
            {fc.top.map((sp, i) => {
              const name = `${sp.region || grid?.at(sp.lon, sp.lat) || meta.sector?.name || "Cell"} · ${Math.abs(sp.lat).toFixed(1)}°${sp.lat >= 0 ? "N" : "S"} ${Math.abs(sp.lon).toFixed(1)}°${sp.lon >= 0 ? "E" : "W"}`;
              return (
                <li key={i}>
                  <button
                    className={focus?.label === name ? "on" : ""}
                    onClick={() => setFocus({ key: `fc-${i}-${Date.now()}`, lon: sp.lon, lat: sp.lat, zoom: meta.cell >= 1 ? 5 : 6, label: name })}
                  >
                    <span className="rk mono">{String(i + 1).padStart(2, "0")}</span>
                    <span>{name}</span>
                    <b className={sp.r >= 1.3 ? "hot" : sp.r <= 0.75 ? "cool" : ""}>{sp.r >= 4 ? "new" : `${sp.r.toFixed(1)}×`}</b>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="fineprint">
            The map shares out the validated regional forecast by where each region usually burns at this time of year, adjusted towards where it has
            burned in the last 8 weeks. It shows where to look, not a separate prediction for each cell.
          </p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ the view */

export function Forecast({ m, go, path }: { m: Mission; go: (v: ViewId) => void; path: string }) {
  const [file, setFile] = useState<ForecastFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    loadForecast(path)
      .then((f) => alive && setFile(f))
      .catch((e) => alive && setErr(String(e)));
    return () => {
      alive = false;
    };
  }, [path]);

  const meta = m.view.meta;
  // a selected province or drawn area has no forecast of its own: use the region that holds most of it
  const hostRegion = useMemo(() => {
    if (!m.isCustom || !m.aoi) return null;
    const { grid, meta: bm } = m.data;
    const cells = m.aoi.cells ?? grid.cells.flatMap(([cx, cy], i) => {
      const lon = bm.box[0] + (cx + 0.5) * bm.cell;
      const lat = bm.box[1] + (cy + 0.5) * bm.cell;
      return lon >= m.aoi!.west && lon <= m.aoi!.east && lat >= m.aoi!.south && lat <= m.aoi!.north ? [i] : [];
    });
    const count = new Map<number, number>();
    for (const ci of cells) {
      const ri = grid.cells[ci]?.[2];
      if (ri != null && ri >= 0) count.set(ri, (count.get(ri) ?? 0) + 1);
    }
    let best = -1;
    let n = 0;
    for (const [ri, c] of count) if (c > n) [best, n] = [ri, c];
    const id = best >= 0 ? bm.regions[best]?.id : undefined;
    return id && id !== "study_area" ? id : "study_area";
  }, [m.isCustom, m.aoi, m.data]);
  const rid = m.isCustom ? (hostRegion ?? "study_area") : m.regionId;
  const f = file?.regions[rid] ?? file?.regions.study_area;
  const regionName =
    rid === "study_area" ? (meta.sector?.name ?? "Southeast Asia") : (meta.regions.find((r) => r.id === rid)?.name ?? meta.sector?.name ?? "the study area");

  // years worth replaying: the biggest episodes first, then the latest full year
  const years = useMemo(() => {
    const ys = [...meta.events].sort((a, b) => b.total - a.total).map((e) => Number(e.peak.slice(0, 4)));
    const out = [...new Set(ys)].filter((y) => y >= 2003).slice(0, 4);
    const last = f ? D(f.issued).getUTCFullYear() : 2026;
    if (!out.includes(last)) out.push(last);
    return out.sort((a, b) => a - b);
  }, [meta.events, f]);
  const [year, setYear] = useState<number | null>(null);
  const shownYear = year ?? years.filter((y) => y < (f ? D(f.issued).getUTCFullYear() : 9999)).slice(-1)[0] ?? years[0];

  if (err) return <div className="view-pad"><p className="lede">The forecast could not be loaded ({err}).</p></div>;
  if (!file || !f) return <div className="view-pad"><div className="mono dim">LOADING THE FORECAST…</div></div>;

  const next4 = f.weeks.slice(0, 4);
  const exp4 = next4.reduce((a, w) => a + w.p50, 0);
  const lo4 = next4.reduce((a, w) => a + w.p10, 0);
  const hi4 = next4.reduce((a, w) => a + w.p90, 0);
  const norm4 = next4.reduce((a, w) => a + w.normal, 0);
  const ratio4 = norm4 > 0 ? exp4 / norm4 : NaN;
  const riskiest = f.weeks.slice(0, 13).reduce((a, w) => (w.p_critical > a.p_critical ? w : a), f.weeks[0]);
  const peak = f.weeks.reduce((a, w) => (w.p50 > a.p50 ? w : a), f.weeks[0]);
  const useful = usefulWeeks(f.skill);
  const s4 = f.skill[3];
  const s8 = f.skill[7];
  const enso = ensoLabel(file.oni.latest.anom);
  const mtd = f.month_to_date;
  const critical = f.weeks.filter((w) => w.p_critical >= 0.3);
  const hv = hover == null ? null : hover < f.recent.length ? { kind: "obs" as const, w: f.recent[hover] } : { kind: "fc" as const, w: f.weeks[hover - f.recent.length] };

  const verdict =
    ratio4 >= 1.3
      ? `Expect a busier month than normal in ${regionName}: about ${ratio4.toFixed(1)}× the usual number of detections over the next four weeks.`
      : ratio4 <= 0.75
        ? `Expect a quieter month than normal in ${regionName} over the next four weeks.`
        : `The next four weeks in ${regionName} look close to normal for the time of year.`;

  const downloadCsv = () => {
    const rows = ["week_start,week_end,expected,low_80,high_80,normal,critical_level,chance_above_normal,chance_critical"];
    for (const w of f.weeks) rows.push([weekStart(w.end), w.end, w.p50, w.p10, w.p90, w.normal, w.critical, w.p_above, w.p_critical].join(","));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv" }));
    a.download = `ignis_forecast_${meta.sector?.id ?? "sea"}_${rid}_${f.issued}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="view-pad fc">
      <header className="view-head">
        <div className="scene-code mono">
          FORECAST · ISSUED {f.issued} · NEXT {file.horizon_weeks} WEEKS · {regionName.toUpperCase()}
        </div>
        <h2>
          <Scramble text="What the coming months may bring" />
        </h2>
        <p className="lede">
          {verdict} The outlook learns from 25 harmonized years how a season that starts early or hot tends to carry on, and how El Niño shifts burning,
          then states its own margin of error.
        </p>
        {m.isCustom && (
          <p className="aoi-note">
            Forecasts are made for whole regions, not single provinces or drawn areas. {m.area?.name ?? "Your area"} lies in{" "}
            <b>{regionName}</b>, so this is {regionName}'s outlook. Choose a region in the top bar to see another.
          </p>
        )}
      </header>

      <SectionNav
        items={[
          { id: "fc-outlook", label: "OUTLOOK" },
          { id: "fc-map", label: "PREDICTED BURNING" },
          { id: "fc-burn", label: "BURN WINDOWS" },
          { id: "fc-season", label: "SEASON TIMING" },
          ...(f.drought ? [{ id: "fc-drought", label: "DROUGHT" }] : []),
          ...(file.haze ? [{ id: "fc-haze", label: "HAZE" }] : []),
          { id: "fc-accuracy", label: "ACCURACY" },
        ]}
      />

      <div className="fc-kpis">
        <div className="fc-kpi glass">
          <div className="mono k">NEXT 4 WEEKS · EXPECTED</div>
          <div className="fc-big amber">
            <Ticker text={fmtNum(exp4)} />
          </div>
          <div className="fc-sub">
            80% range {fmtNum(lo4)} to {fmtNum(hi4)} · normal {fmtNum(norm4)}
          </div>
        </div>
        <div className={`fc-kpi glass ${riskiest.p_critical >= 0.3 ? "alert" : ""}`}>
          <div className="mono k">HIGHEST CRITICAL-WEEK CHANCE · 3 MONTHS</div>
          <div className={`fc-big ${riskiest.p_critical >= 0.3 ? "fire" : ""}`}>
            <Ticker text={`${Math.round(riskiest.p_critical * 100)}%`} />
          </div>
          <div className="fc-sub">
            week of {fmtDay(weekStart(riskiest.end))} · a week in the top 10% for its time of year
          </div>
        </div>
        <div className="fc-kpi glass">
          <div className="mono k">THIS MONTH SO FAR</div>
          {mtd ? (
            <>
              <div className={`fc-big ${mtd.total > mtd.median ? "amber" : "cyan"}`}>
                <Ticker text={mtd.median > 0 ? `${(mtd.total / mtd.median).toFixed(1)}×` : fmtNum(mtd.total)} />
              </div>
              <div className="fc-sub">
                {fmtNum(mtd.total)} vs median {fmtNum(mtd.median)} over {mtd.days} days · rank {mtd.rank} of {mtd.years} years
              </div>
            </>
          ) : (
            <div className="fc-sub">Not enough data yet this month.</div>
          )}
        </div>
        <div className={`fc-kpi glass ${enso.tone === "fire" ? "alert" : ""}`}>
          <div className="mono k">
            EL NIÑO INDEX · {file.oni.latest.season} {file.oni.latest.year}
          </div>
          <div className={`fc-big ${enso.tone}`}>
            <Ticker text={`${file.oni.latest.anom > 0 ? "+" : ""}${file.oni.latest.anom.toFixed(2)}`} />
          </div>
          <div className="fc-sub">{enso.label} · NOAA Oceanic Niño Index</div>
        </div>
      </div>

      <section className="card glass" id="fc-outlook">
        <SectionTag tone="amber">FIRE OUTLOOK · NEXT 26 WEEKS</SectionTag>
        <div className="card-head">
          <h3>Weekly detections: the last six months, then the next six</h3>
          <div className="fc-legend mono">
            <span>
              <i className="sw obs" /> OBSERVED
            </span>
            <span>
              <i className="sw fc" /> EXPECTED + 80% RANGE
            </span>
            <span>
              <i className="sw norm" /> NORMAL
            </span>
            <span>
              <i className="sw crit" /> CRITICAL LEVEL
            </span>
          </div>
        </div>
        <div className="fc-chart-wrap">
          <OutlookChart f={f} hover={hover} setHover={setHover} />
          {hv && (
            <div className="fc-tip glass mono">
              <b>WEEK OF {fmtDay(weekStart(hv.w.end)).toUpperCase()}</b>
              {hv.kind === "obs" ? (
                <span>
                  observed {hv.w.obs == null ? "n/a" : fmtNum(hv.w.obs)} · normal {fmtNum(hv.w.normal)}
                </span>
              ) : (
                <>
                  <span>
                    expected {fmtNum(hv.w.p50)} ({fmtNum(hv.w.p10)}–{fmtNum(hv.w.p90)}) · normal {fmtNum(hv.w.normal)}
                  </span>
                  <span>
                    {Math.round(hv.w.p_above * 100)}% above normal · {Math.round(hv.w.p_critical * 100)}% critical
                  </span>
                </>
              )}
            </div>
          )}
        </div>
        <div className="fc-strip-head mono">
          <span>CHANCE EACH WEEK IS ABOVE NORMAL (%)</span>
          <span className="fc-ramp">
            <i style={{ background: chanceColour(0.1) }} /> BELOW
            <i style={{ background: chanceColour(0.5) }} /> EVEN
            <i style={{ background: chanceColour(0.9) }} /> ABOVE · <i className="critbox" /> CRITICAL RISK ≥30%
          </span>
        </div>
        <WeekStrip weeks={f.weeks} hover={hover} onHover={setHover} offset={f.recent.length} />
        <p className="fc-read">
          {critical.length
            ? `Critical periods to watch: ${critical
                .slice(0, 4)
                .map((w) => `week of ${fmtDay(weekStart(w.end))} (${Math.round(w.p_critical * 100)}%)`)
                .join(", ")}${critical.length > 4 ? ` and ${critical.length - 4} more` : ""}.`
            : "No week in the outlook has a 30% or higher chance of reaching the critical level."}{" "}
          The busiest week expected is the week of {fmtDay(weekStart(peak.end))}, at about {fmtNum(peak.p50)} detections.{" "}
          {useful >= f.weeks.length
            ? "Its edge over the normal shrinks with time but holds across the whole outlook."
            : useful === 0
              ? "Here the outlook is barely better than the normal at any lead time, so treat it as the normal with a range."
              : `Beyond about ${useful} week${useful === 1 ? "" : "s"} the outlook here is little better than the normal, so it fades back towards it.`}
        </p>
        <div className="fc-actions">
          <button className="btn-ghost small" onClick={downloadCsv}>
            ↓ This forecast (CSV)
          </button>
          <button className="btn-ghost small" onClick={() => go("record")}>
            Compare with the burning calendar →
          </button>
        </div>
      </section>

      <RiskMap m={m} file={file} />

      <BurnPlanner f={f} regionName={regionName} />

      {f.season && (
        <section className="card glass" id="fc-season">
          <SectionTag tone="sand">SEASON TIMING · START AND END</SectionTag>
          <div className="card-head">
            <h3>When does the fire season start and end?</h3>
          </div>
          <SeasonTiming s={f.season} regionName={regionName} />
        </section>
      )}

      {f.drought && (
        <section className="card glass" id="fc-drought">
          <SectionTag tone="sand">DROUGHT INPUT · NASA POWER RAINFALL</SectionTag>
          <div className="card-head">
            <h3>How dry has it been?</h3>
          </div>
          <DroughtCard d={f.drought} gain8={f.skill[7]?.improvement} gain8Without={f.skill[7]?.improvement_without_drought} regionName={regionName} />
        </section>
      )}

      {file.haze && (
        <section className="card glass" id="fc-haze">
          <SectionTag tone="cyan">HAZE OUTLOOK · MALAYSIA AND SINGAPORE</SectionTag>
          <div className="card-head">
            <h3>Will smoke reach the Peninsula?</h3>
          </div>
          <HazeCard h={file.haze} />
        </section>
      )}

      <div className="fc-row" id="fc-accuracy">
        <section className="card glass">
          <SectionTag tone="amber">ACCURACY · REPLAY</SectionTag>
          <div className="card-head">
            <h3>Would it have warned us?</h3>
            <span className="mono dim">REPLAY · 4 WEEKS AHEAD</span>
          </div>
          <Hindcast f={f} years={years} year={shownYear} setYear={setYear} />
        </section>
        <section className="card glass">
          <SectionTag tone="amber">ACCURACY · SKILL</SectionTag>
          <div className="card-head">
            <h3>How far ahead it can see</h3>
            <span className="mono dim">HELD-OUT YEARS</span>
          </div>
          <SkillChart skill={f.skill} />
          <div className="fc-legend mono">
            <span>
              <i className="sw fc" /> WITH EL NIÑO INPUT
            </span>
            <span>
              <i className="sw norm" /> WITHOUT
            </span>
          </div>
          <p className="fc-read">
            Error compared with simply expecting a normal year: <b>{Math.round((s4.improvement ?? 0) * 100)}% smaller</b> four weeks ahead,{" "}
            {Math.round((s8.improvement ?? 0) * 100)}% eight weeks ahead
            {s8.improvement_without_enso != null && ` (${Math.round(s8.improvement_without_enso * 100)}% without the El Niño input)`}. Four weeks ahead it
            flagged {s4.warned} of the {s4.critical_weeks} critical weeks in held-out years, with {s4.false_alarms} false alarms.
          </p>
        </section>
      </div>

      <section className="card glass fc-method">
        <div className="card-head">
          <h3>How the forecast works</h3>
        </div>
        <ol>
          <li>
            <b>Normal.</b> For each week of the year, the median of the harmonized record in that week across 25 years. The harmonization is what makes
            this possible: MODIS years and VIIRS years now sit on one scale.
          </li>
          <li>
            <b>Departure.</b> A regression per region and lead time predicts how far above or below normal each coming week will be, from how unusual the
            last 4 and 12 weeks were and from the El Niño index, whose effect is allowed to change through the year. Only index values already published
            on the issue date are used.
          </li>
          <li>
            <b>Margin of error.</b> Each year is forecast by a model that never saw it. Those held-out errors set the 80% range and the chances shown.
          </li>
        </ol>
        <p className="fineprint">
          Limits: the model knows past fire activity and El Niño, not this season's rainfall, wind or fuel, so it cannot foresee a fire started by a
          single event; detections count heat seen from orbit, not fires or area burned; the latest weeks use near-real-time data, which is
          preliminary. Data to {f.issued}; El Niño index from {file.oni.source}.
        </p>
      </section>
    </div>
  );
}
