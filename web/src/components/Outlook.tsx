import { useMemo } from "react";
import type { Dataset } from "../types";
import { dateAt, monthName } from "../lib";

const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

/** Closing scene: what the record says about when to be ready, who could use it, and what is next. */
export function Outlook({ data }: { data: Dataset }) {
  const { meta, daily } = data;

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
    // the three consecutive months that hold the most detections
    let best = 0;
    let bestStart = 0;
    for (let m = 0; m < 12; m++) {
      const sum = byMonth[m] + byMonth[(m + 1) % 12] + byMonth[(m + 2) % 12];
      if (sum > best) {
        best = sum;
        bestStart = m;
      }
    }
    // how few years hold half of everything
    const years = [...byYear.entries()].sort((a, b) => b[1] - a[1]);
    let acc = 0;
    let n = 0;
    for (const [, v] of years) {
      acc += v;
      n++;
      if (acc >= total / 2) break;
    }
    return {
      season: `${monthName(bestStart)} to ${monthName((bestStart + 2) % 12)}`,
      seasonShare: total > 0 ? best / total : NaN,
      halfYears: n,
      nYears: years.length,
      topYears: years.slice(0, n).map(([y]) => y).sort((a, b) => a - b),
    };
  }, [daily, meta.start]);

  return (
    <section id="outlook" className="scene scene-outlook">
      <div className="scene-inner wide stack">
        <div className="scene-copy full">
          <div className="scene-code mono">SCENE 06 · WHY IT MATTERS</div>
          <h2>From record to readiness</h2>
          <p className="lede">
            A fire record is only useful if it can be trusted across sensors. With one consistent scale, the past becomes a yardstick: you can tell
            whether this week is ordinary or the start of something, and you can say so with a stated margin of error.
          </p>
        </div>

        <div className="outlook-facts">
          <div className="headline glass amber">
            <div className="headline-big">{Number.isNaN(facts.seasonShare) ? "n/a" : `${Math.round(facts.seasonShare * 100)}%`}</div>
            <div className="headline-label">
              of all detections since {meta.start.slice(0, 4)} fell in just three months, {facts.season}. That is the window to prepare for.
            </div>
          </div>
          <div className="headline glass fire">
            <div className="headline-big">
              {facts.halfYears} of {facts.nYears}
            </div>
            <div className="headline-label">
              years hold half of every detection in the record ({facts.topYears.join(", ")}). Bad years are rare and very large, so spotting one early
              matters.
            </div>
          </div>
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
            <li>Connect the near-real-time feed, so the calendar shows this week against its history as it happens.</li>
            <li>Show how much of each week the satellites could actually see through cloud and smoke.</li>
            <li>Replace the coarse region outlines with official boundaries and add peatland and land-cover layers.</li>
          </ul>
        </div>

        <div className="outlook-cta">
          <button className="btn-primary" onClick={() => go("findings")}>
            Explore your own area
          </button>
          <button className="btn-ghost" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>
            Replay the mission
          </button>
        </div>
      </div>
    </section>
  );
}
