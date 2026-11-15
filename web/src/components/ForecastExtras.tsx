import { useEffect, useRef, useState } from "react";
import { scaleLinear } from "d3-scale";
import { area as d3area, line as d3line } from "d3-shape";

/* ------------------------------------------------------------------ data shapes */

export interface SeasonInfo {
  threshold: number;
  typical: { start_woy: number | null; end_woy: number | null; start_spread_weeks: number | null; end_spread_weeks: number | null; peak_woy: number };
  current: { status: "in_season" | "off_season"; event: "start" | "end"; expected: string | null; earliest: string | null; latest: string | null; then_ends?: string | null };
  history: { season: number; start: string; end: string; peak: string; weeks: number }[];
}
export interface DroughtInfo {
  rain_30d_pct: number;
  rain_90d_pct: number;
  index_90d: number;
  as_of: string;
  series: [string, number | null][];
}
export interface HazeInfo {
  receptor: string;
  sources: string[];
  weeks: { end: string; index: number; low: number; high: number; pct: number; level: HazeLevel; level_if_high: HazeLevel; wind_share: Record<string, number> }[];
  recent: { end: string; index: number; level: HazeLevel }[];
  worst_years: { year: number; week: string; index: number }[];
}
type HazeLevel = "low" | "moderate" | "high" | "very_high";

const D = (s: string) => new Date(`${s}T00:00:00Z`);
const day = (s: string) => D(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const dayYear = (s: string) => D(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const wkStart = (end: string) => new Date(D(end).getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
/** "early Aug", "mid Sep", "late Oct" for a week of the year. */
const woyLabel = (w: number) => {
  const d = new Date(Date.UTC(2021, 0, 1 + w * 7 + 3));
  const part = d.getUTCDate() <= 10 ? "early" : d.getUTCDate() <= 20 ? "mid" : "late";
  return `${part} ${d.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" })}`;
};
const woyOf = (s: string) => Math.min(51, Math.floor((D(s).getTime() - Date.UTC(D(s).getUTCFullYear(), 0, 1)) / (7 * 86_400_000)));

/** A section label: a small coloured tag above each feature, so every part of the page is named. */
export function SectionTag({ tone, children }: { tone: "amber" | "teal" | "cyan" | "fire" | "sand"; children: React.ReactNode }) {
  return <div className={`fx-tag mono ${tone}`}>{children}</div>;
}

/* ------------------------------------------------------------------ season timing */

export function SeasonTiming({ s, regionName }: { s: SeasonInfo; regionName: string }) {
  const c = s.current;
  const t = s.typical;
  const peak = t.peak_woy;
  const off = (d: string) => ((woyOf(d) - peak + 26 + 52) % 52) - 26;
  const rows = s.history.slice(-14);
  const W = 900;
  const rowH = 15;
  const pad = { l: 44, r: 12, t: 22, b: 8 };
  const Hh = pad.t + (rows.length + 1) * rowH + pad.b + 6;
  const x = scaleLinear().domain([-26, 26]).range([pad.l, W - pad.r]);
  const ticks = [-24, -16, -8, 0, 8, 16, 24];
  const predStart = c.event === "start" ? c.expected : null;
  const predEnd = c.event === "end" ? c.expected : c.then_ends ?? null;

  const headline =
    c.event === "end"
      ? c.expected
        ? `The season in ${regionName} is under way and expected to end around the week of ${day(wkStart(c.expected))}.`
        : `The season in ${regionName} is under way and is not expected to end within the next 26 weeks.`
      : c.expected
        ? `The next season in ${regionName} is expected to start around the week of ${day(wkStart(c.expected))}${c.then_ends ? ` and end around ${day(c.then_ends)}` : ""}.`
        : `No season start is expected in ${regionName} within the next 26 weeks. It usually starts in ${t.start_woy != null ? woyLabel(t.start_woy) : "its usual month"}.`;
  const range =
    c.expected && (c.earliest || c.latest)
      ? `Range: ${c.earliest ? `week of ${day(wkStart(c.earliest))}` : "now"} to ${c.latest ? `week of ${day(wkStart(c.latest))}` : "beyond the outlook"}.`
      : "";
  let vsUsual = "";
  if (c.expected) {
    const usual = c.event === "end" ? t.end_woy : t.start_woy;
    if (usual != null) {
      const diff = ((woyOf(c.expected) - usual + 26 + 52) % 52) - 26;
      vsUsual = Math.abs(diff) <= 1 ? "About the usual time." : `About ${Math.abs(diff)} weeks ${diff > 0 ? "later" : "earlier"} than usual.`;
    }
  }

  return (
    <>
      <div className="st-top">
        <div className={`st-status ${c.status === "in_season" ? "on" : ""}`}>
          <div className="mono k">{c.status === "in_season" ? "IN SEASON NOW" : "OFF SEASON NOW"}</div>
          <div className="st-big">{c.expected ? `${c.event === "end" ? "Ends" : "Starts"} ~${day(wkStart(c.expected))}` : c.event === "end" ? "Ends: beyond outlook" : "Starts: beyond outlook"}</div>
          <div className="fc-sub">
            {range} {vsUsual}
          </div>
        </div>
        <div className="st-usual">
          <div className="mono k">USUAL SEASON</div>
          <div className="st-mid">
            {t.start_woy != null && t.end_woy != null ? `${woyLabel(t.start_woy)} to ${woyLabel(t.end_woy)}` : "No regular season"}
          </div>
          <div className="fc-sub">
            peak around {woyLabel(peak)}
            {t.start_spread_weeks != null && ` · start varies by about ±${Math.round(t.start_spread_weeks)} weeks`}
          </div>
        </div>
      </div>
      <p className="fc-read">{headline}</p>
      <svg viewBox={`0 0 ${W} ${Hh}`} className="st-chart" role="img" aria-label="Start and end of the fire season in past years, around the usual peak">
        {ticks.map((k) => (
          <g key={k}>
            <line x1={x(k)} x2={x(k)} y1={pad.t - 4} y2={Hh - pad.b} stroke={k === 0 ? "rgba(255,157,67,0.45)" : "rgba(255,255,255,0.06)"} />
            <text x={x(k)} y={12} textAnchor="middle" className="fc-tick">
              {woyLabel((peak + k + 52) % 52).toUpperCase()}
            </text>
          </g>
        ))}
        {rows.map((h, i) => {
          const y = pad.t + i * rowH;
          return (
            <g key={h.season}>
              <text x={pad.l - 6} y={y + 10} textAnchor="end" className="fc-tick">
                {h.season}
              </text>
              <rect x={x(off(h.start))} y={y + 2} width={Math.max(3, x(off(h.end)) - x(off(h.start)))} height={rowH - 5} rx={3} fill="#c97a3a" opacity={0.85} />
            </g>
          );
        })}
        {[
          predStart && c.status === "off_season" ? { d: predStart, label: "FORECAST START" } : null,
          predEnd ? { d: predEnd, label: "FORECAST END" } : null,
        ]
          .filter(Boolean)
          .map((mk) => (
            <g key={mk!.label}>
              <line x1={x(off(mk!.d))} x2={x(off(mk!.d))} y1={pad.t - 4} y2={Hh - pad.b} stroke="#ffd9a0" strokeWidth="1.6" strokeDasharray="5 4" />
              <text x={x(off(mk!.d)) + 5} y={Hh - pad.b - 4} className="fc-tick st-now">
                {mk!.label} · {day(wkStart(mk!.d)).toUpperCase()}
              </text>
            </g>
          ))}
      </svg>
      <p className="fineprint">
        A season is the run of weeks when burning (3-week average) is above {regionName}'s average week across the whole record, about{" "}
        {Math.round(s.threshold).toLocaleString("en-US")} detections. Past seasons are drawn around the usual peak; the dashed bar is the forecast. The
        range comes from the forecast's low and high paths.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ drought input */

const dryLabel = (p: number) => (p < 50 ? { t: "Very dry", c: "fire" } : p < 80 ? { t: "Dry", c: "amber" } : p <= 120 ? { t: "Near normal", c: "" } : { t: "Wet", c: "cyan" });

export function DroughtCard({ d, gain8, gain8Without, regionName }: { d: DroughtInfo; gain8?: number | null; gain8Without?: number | null; regionName: string }) {
  const W = 560;
  const Hh = 150;
  const pad = { l: 36, r: 10, t: 10, b: 22 };
  const pts = d.series.filter((p) => p[1] != null) as [string, number][];
  const max = Math.max(160, ...pts.map((p) => p[1]));
  const x = scaleLinear().domain([0, Math.max(1, pts.length - 1)]).range([pad.l, W - pad.r]);
  const y = scaleLinear().domain([0, max]).range([Hh - pad.b, pad.t]);
  const dryArea = d3area<[string, number]>().x((_, i) => x(i)).y0(y(100)).y1((p) => y(Math.min(100, p[1])))(pts) ?? "";
  const wetArea = d3area<[string, number]>().x((_, i) => x(i)).y0(y(100)).y1((p) => y(Math.max(100, p[1])))(pts) ?? "";
  const ln = d3line<[string, number]>().x((_, i) => x(i)).y((p) => y(p[1]))(pts) ?? "";
  const l30 = dryLabel(d.rain_30d_pct);
  const l90 = dryLabel(d.rain_90d_pct);
  return (
    <>
      <div className="dr-kpis">
        <div className="dr-kpi">
          <div className="mono k">RAIN · LAST 30 DAYS</div>
          <div className={`fc-big ${l30.c}`}>{d.rain_30d_pct}%</div>
          <div className="fc-sub">of normal · {l30.t}</div>
        </div>
        <div className="dr-kpi">
          <div className="mono k">RAIN · LAST 90 DAYS</div>
          <div className={`fc-big ${l90.c}`}>{d.rain_90d_pct}%</div>
          <div className="fc-sub">of normal · {l90.t}</div>
        </div>
        <div className="dr-kpi">
          <div className="mono k">WHAT IT ADDS · 8 WEEKS AHEAD</div>
          <div className="fc-big">{gain8 != null ? (gain8 >= 0.01 ? `${Math.round(gain8 * 100)}%` : "None") : "n/a"}</div>
          <div className="fc-sub">
            {gain8 == null
              ? "no forecast skill data"
              : gain8 >= 0.01
                ? `smaller error than a normal-year forecast, with rainfall${gain8Without != null ? `; ${Math.round(gain8Without * 100)}% without it` : ""}`
                : "here the forecast is no better than a normal year at 8 weeks, with or without rainfall"}
          </div>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${Hh}`} className="dr-chart" role="img" aria-label="Rain over the previous 90 days as a percentage of normal, for the last year">
        {[50, 100, 150].map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={v === 100 ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.06)"} strokeDasharray={v === 100 ? "4 3" : ""} />
            <text x={pad.l - 5} y={y(v) + 3} textAnchor="end" className="fc-tick">
              {v}%
            </text>
          </g>
        ))}
        {pts.map((p, i) =>
          i === 0 || D(p[0]).getUTCMonth() !== D(pts[i - 1][0]).getUTCMonth() ? (
            <text key={p[0]} x={x(i)} y={Hh - 6} className="fc-tick">
              {D(p[0]).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }).toUpperCase()}
            </text>
          ) : null,
        )}
        <path d={dryArea} fill="rgba(201,122,58,0.45)" />
        <path d={wetArea} fill="rgba(69,184,209,0.35)" />
        <path d={ln} fill="none" stroke="#f2f6fa" strokeWidth="1.6" className="draw-line" pathLength={1} />
      </svg>
      <p className="fineprint">
        Rainfall where {regionName} usually burns, from NASA POWER (MERRA-2 and GEOS), to {dayYear(d.as_of)}. Brown is drier than normal for the time of
        year, blue wetter. The forecast uses how unusual the last 30 and 90 days were; dry spells make fires easier to start and harder to stop, but
        rainfall to date cannot foresee the rain still to come, so its gain in accuracy is modest.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ haze outlook */

const HAZE_TEXT: Record<HazeLevel, string> = { low: "Low", moderate: "Moderate", high: "High", very_high: "Very high" };

export function HazeCard({ h }: { h: HazeInfo }) {
  const all = [...h.recent.map((r) => ({ ...r, fc: false })), ...h.weeks.map((w) => ({ end: w.end, index: w.index, level: w.level, fc: true }))];
  const next4 = h.weeks.slice(0, 4);
  const worst = next4.reduce((a, w) => (["low", "moderate", "high", "very_high"].indexOf(w.level) > ["low", "moderate", "high", "very_high"].indexOf(a.level) ? w : a), next4[0]);
  const peak = h.weeks.reduce((a, w) => (w.index > a.index ? w : a), h.weeks[0]);
  const ws = next4[0]?.wind_share ?? {};
  const name = (s: string) => (s === "sumatra" ? "Sumatra" : s === "kalimantan" ? "Kalimantan" : s);
  return (
    <>
      <div className="hz-top">
        <div className={`hz-level ${worst.level}`}>
          <div className="mono k">NEXT 4 WEEKS</div>
          <div className="st-big">{HAZE_TEXT[worst.level]}</div>
          <div className="fc-sub">haze potential for {h.receptor}</div>
        </div>
        <div className="hz-wind">
          <div className="mono k">WIND TOWARDS THE PENINSULA · THIS TIME OF YEAR</div>
          {Object.entries(ws).map(([s, v]) => (
            <div key={s} className="hz-bar">
              <span>from {name(s)}</span>
              <i>
                <b style={{ width: `${Math.round(v * 100)}%` }} />
              </i>
              <em className="mono">{Math.round(v * 100)}% of days</em>
            </div>
          ))}
        </div>
      </div>
      <div className="hz-strip" role="list" aria-label="Haze potential, last 26 weeks then the next 26">
        {all.map((w, k) => (
          <div key={w.end} role="listitem" className={`hz-cell ${w.level} ${w.fc ? "fc" : ""} ${k === h.recent.length ? "now" : ""}`} title={`Week of ${day(wkStart(w.end))}: ${HAZE_TEXT[w.level]}${w.fc ? " (forecast)" : ""}`}>
            {(k === 0 || D(w.end).getUTCMonth() !== D(all[k - 1].end).getUTCMonth()) && <span className="mono">{D(w.end).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" }).toUpperCase()}</span>}
          </div>
        ))}
      </div>
      <div className="bp-legend mono">
        <span><i className="hz-sw low" /> LOW</span>
        <span><i className="hz-sw moderate" /> MODERATE · TOP 30%</span>
        <span><i className="hz-sw high" /> HIGH · TOP 10%</span>
        <span><i className="hz-sw very_high" /> VERY HIGH · TOP 3%</span>
        <span>SOLID: PAST · FADED: FORECAST</span>
      </div>
      <p className="fc-read">
        Highest haze potential in the outlook: the week of {day(wkStart(peak.end))} ({HAZE_TEXT[peak.level].toLowerCase()}). Checked against the record, the
        worst haze-potential weeks fall in <b>{h.worst_years.map((t) => t.year).join(", ")}</b>, the years of the major regional haze crises.
      </p>
      <p className="fineprint">
        Haze potential = expected fire detections in {h.sources.map(name).join(" and ")}, each weighted by the share of days the 50 m wind (NASA POWER) blows
        towards Peninsular Malaysia and Singapore. Past weeks use the wind that blew; coming weeks use the usual wind for the time of year. Levels rank
        each week against every week since 2001. It shows when smoke is likely to be produced and carried towards the Peninsula, not an air-quality
        forecast: it does not model smoke height, rain-out or local pollution.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ in-page navigation */

export function SectionNav({ items }: { items: { id: string; label: string }[] }) {
  const [active, setActive] = useState(items[0]?.id);
  const navRef = useRef<HTMLElement>(null);
  const ids = items.map((i) => i.id).join(",");

  // follow the scroll: the active section is the last one whose top has passed just below the bar
  useEffect(() => {
    const nav = navRef.current;
    const scroller = nav?.closest(".view") as HTMLElement | null;
    if (!nav || !scroller) return;
    const update = () => {
      const line = nav.getBoundingClientRect().bottom + 90;
      let cur = items[0]?.id;
      for (const it of items) {
        const el = document.getElementById(it.id);
        if (el && el.getBoundingClientRect().top <= line) cur = it.id;
      }
      // at the very bottom, the last section is the one being read
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4) cur = items[items.length - 1]?.id;
      setActive(cur);
    };
    // a handful of position reads per scroll event is cheap, and unlike an animation frame it also
    // runs while the tab is in the background
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      scroller.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  return (
    <nav className="fc-nav" aria-label="Forecast sections" ref={navRef}>
      {items.map((it) => (
        <button
          key={it.id}
          className={`mono ${active === it.id ? "on" : ""}`}
          aria-current={active === it.id ? "true" : undefined}
          onClick={() => document.getElementById(it.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
        >
          {it.label}
        </button>
      ))}
    </nav>
  );
}
