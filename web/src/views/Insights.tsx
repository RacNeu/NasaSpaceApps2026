import { useMemo } from "react";
import type { Mission, ViewId } from "../mission";
import { dateAt, fmtDate, indexOf, monthName } from "../lib";
import { Scramble, Ticker } from "../fx";

const pctText = (v: number | undefined) => (v === undefined ? "n/a" : `${Math.round(v * 100)}%`);

/** The headline findings, what the record says about readiness, who could use it and what is next. */
export function Insights({ m, go }: { m: Mission; go: (v: ViewId) => void }) {
  const { data, extras } = m;
  const { meta, daily } = data;
  const cal = meta.calibration.study_area;
  const years = Object.keys(extras.matching.headline.by_year ?? {}).sort();
  const y = years[0];
  const h = y ? extras.matching.headline.by_year?.[y] : undefined;
  const top = [...meta.events].sort((a, b) => b.total - a.total)[0];
  const topLabel = top ? fmtDate(dateAt(meta.start, indexOf(meta.start, top.peak))).replace(/^\d+ /, "") : "n/a";

  const facts = useMemo(() => {
    const s = daily.regions.study_area;
    const byMonth = new Array(12).fill(0);
    const byYear = new Map<number, number>();
    let total = 0;
    for (let i = 0; i < daily.days; i++) {
      const v = s.harm[i];
      if (Number.isNaN(v)) continue;
      const d = dateAt(meta.start, i);
      byMonth[d.getUTCMonth()] += v;
      byYear.set(d.getUTCFullYear(), (byYear.get(d.getUTCFullYear()) ?? 0) + v);
      total += v;
    }
    let best = 0;
    let bestStart = 0;
    for (let mo = 0; mo < 12; mo++) {
      const sum = byMonth[mo] + byMonth[(mo + 1) % 12] + byMonth[(mo + 2) % 12];
      if (sum > best) {
        best = sum;
        bestStart = mo;
      }
    }
    const ys = [...byYear.entries()].sort((a, b) => b[1] - a[1]);
    let acc = 0;
    let n = 0;
    for (const [, v] of ys) {
      acc += v;
      n++;
      if (acc >= total / 2) break;
    }
    return {
      season: `${monthName(bestStart)} to ${monthName((bestStart + 2) % 12)}`,
      seasonShare: total > 0 ? best / total : NaN,
      halfYears: n,
      nYears: ys.length,
      topYears: ys.slice(0, n).map(([yr]) => yr).sort((a, b) => a - b),
    };
  }, [daily, meta.start]);

  const items = [
    { big: cal.raw_viirs_to_modis_ratio ? `${cal.raw_viirs_to_modis_ratio.toFixed(1)}×` : "n/a", tone: "amber", label: "more hotspots reported by VIIRS than by MODIS over the same ground and days" },
    {
      big: `${pctText(h?.aqua_in_viirs?.rate)} vs ${pctText(h?.viirs_in_aqua?.rate)}`,
      tone: "cyan",
      label: `of Aqua detections have a NOAA-20 partner, against the share of NOAA-20 detections with an Aqua partner (1 km, ±60 min, Aug to Oct ${y ?? ""})`,
    },
    { big: `${Math.round(cal.cv_coverage_80 * 100)}%`, tone: "amber", label: "of weeks in years the model never saw fall inside its stated 80% range" },
    { big: topLabel, tone: "fire", label: top?.times_normal ? `the largest episode in the record, ${top.times_normal}× the normal level for that time of year` : "the largest episode in the record" },
    {
      big: Number.isNaN(facts.seasonShare) ? "n/a" : `${Math.round(facts.seasonShare * 100)}%`,
      tone: "amber",
      label: `of all detections since ${meta.start.slice(0, 4)} fell in just three months, ${facts.season}. That is the window to prepare for.`,
    },
    {
      big: `${facts.halfYears} of ${facts.nYears}`,
      tone: "fire",
      label: `years hold half of every detection in the record (${facts.topYears.join(", ")}). Bad years are rare and very large.`,
    },
  ];

  return (
    <div className="view-pad">
      <header className="view-head">
        <div className="scene-code mono">INSIGHTS · MISSION BRIEFING</div>
        <h2>
          <Scramble text="What the record tells us" />
        </h2>
        <p className="lede">
          Six numbers a reader should leave with, all computed from the loaded data. With one consistent scale, the past becomes a yardstick: you can
          tell whether this week is ordinary or the start of something, with a stated margin of error.
        </p>
      </header>

      <div className="headlines six">
        {items.map((it) => (
          <div key={it.label} className={`headline glass ${it.tone}`}>
            <div className="headline-big">
              <Ticker text={it.big} />
            </div>
            <div className="headline-label">{it.label}</div>
          </div>
        ))}
      </div>

      <div className="outlook-grid">
        <article className="v-box">
          <div className="mono who">HAZE AND WEATHER AGENCIES</div>
          <h3>Early warning</h3>
          <p>Compare the current week with the same weeks across 25 years, and flag an unusual build-up upwind before smoke crosses a border.</p>
        </article>
        <article className="v-box">
          <div className="mono who">LAND AND FIRE MANAGERS</div>
          <h3>Know your critical weeks</h3>
          <p>Select any area and read its own burning calendar: when its season starts, how long it lasts and which years broke the pattern.</p>
        </article>
        <article className="v-box">
          <div className="mono who">SCIENTISTS</div>
          <h3>A series you can cite</h3>
          <p>One scale across MODIS and VIIRS, a documented method, held-out validation and downloadable data with its uncertainty attached.</p>
        </article>
      </div>

      <div className="v-box next">
        <h3>What comes next</h3>
        <ul>
          <li>Add NOAA-21, which now carries the record forward after Suomi NPP's fire data ended on 2 November 2026.</li>
          <li>Connect the near-real-time feed, so the console shows this week against its history as it happens.</li>
          <li>Show how much of each week the satellites could actually see through cloud and smoke.</li>
          <li>Replace the coarse region outlines with official boundaries and add peatland and land-cover layers.</li>
        </ul>
      </div>

      <div className="outlook-cta">
        <button className="btn-primary" onClick={() => go("overview")}>
          Back to the globe
        </button>
        <button className="btn-ghost" onClick={() => go("method")}>
          See the validation
        </button>
      </div>
    </div>
  );
}
