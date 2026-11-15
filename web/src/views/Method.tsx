import { useState } from "react";
import type { Mission } from "../mission";
import { Validation } from "../components/Validation";
import { SectorCompare } from "../components/SectorCompare";
import { dateAt, indexOf } from "../lib";

const download = (name: string, mime: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** Validation of the calibration, the method, its limits, credits and downloads. */
export function Method({ m }: { m: Mission }) {
  const { data, view, extras, regionId } = m;
  const { meta } = data;

  const [from, setFrom] = useState(meta.start);
  const [to, setTo] = useState(meta.end);
  const iFrom = Math.max(0, indexOf(meta.start, from));
  const iTo = Math.min(view.daily.days - 1, indexOf(meta.start, to));
  const regionName = view.meta.regions.find((r) => r.id === regionId)?.name ?? (m.isCustom ? "Your selected area" : regionId);
  const slugRange = `${from}_to_${to}`;
  const num = (v: number) => (Number.isNaN(v) ? "" : String(Math.round(v * 10) / 10));
  // a byte-order mark makes Excel read the file as UTF-8 and open it straight into columns
  const csv = (name: string, rows: string[]) => download(name, "text/csv;charset=utf-8", "﻿" + rows.join("\r\n"));

  const exportCsv = () => {
    const s = view.daily.regions[regionId];
    const rows = ["Date,Area,Detections per day (VIIRS scale),Low (80% range),High (80% range),Source,Percentile vs other years,Typical for the date,MODIS raw,Suomi NPP raw,NOAA-20 raw"];
    for (let i = iFrom; i <= iTo; i++) {
      if (s.src[i] === 0) continue;
      const d = dateAt(meta.start, i).toISOString().slice(0, 10);
      rows.push(
        [d, `"${regionName}"`, num(s.harm[i]), num(s.lo[i]), num(s.hi[i]), s.src[i] === 1 ? "Observed by VIIRS" : "Estimated from MODIS", num(s.pct[i]), num(s.norm[i]), num(s.modis[i]), num(s.snpp[i]), num(s.noaa20[i])].join(","),
      );
    }
    csv(`ignis_${regionId}_daily_${slugRange}.csv`, rows);
  };

  const exportMonthly = () => {
    const s = view.daily.regions[regionId];
    const months = new Map<string, { tot: number; norm: number; days: number }>();
    for (let i = iFrom; i <= iTo; i++) {
      if (Number.isNaN(s.harm[i])) continue;
      const k = dateAt(meta.start, i).toISOString().slice(0, 7);
      const e = months.get(k) ?? { tot: 0, norm: 0, days: 0 };
      e.tot += s.harm[i];
      e.norm += Number.isNaN(s.norm[i]) ? 0 : s.norm[i];
      e.days++;
      months.set(k, e);
    }
    // rank each month against the same calendar month in every year, by daily average so part months compare fairly
    const all = new Map<string, { tot: number; days: number }>();
    for (let i = 0; i < view.daily.days; i++) {
      if (Number.isNaN(s.harm[i])) continue;
      const k = dateAt(meta.start, i).toISOString().slice(0, 7);
      const e = all.get(k) ?? { tot: 0, days: 0 };
      e.tot += s.harm[i];
      e.days++;
      all.set(k, e);
    }
    const rows = ["Month,Area,Detections (VIIRS scale),Normal for the month,Times normal,Rank among the same month in all years,Years compared,Days with data"];
    for (const [k, e] of months) {
      const same = [...all.entries()].filter(([kk]) => kk.slice(5) === k.slice(5)).map(([, v]) => v.tot / v.days);
      const rank = 1 + same.filter((v) => v > e.tot / e.days).length;
      rows.push([k, `"${regionName}"`, Math.round(e.tot), Math.round(e.norm), e.norm > 0 ? (e.tot / e.norm).toFixed(2) : "", rank, same.length, e.days].join(","));
    }
    csv(`ignis_${regionId}_monthly_${slugRange}.csv`, rows);
  };
  const exportMethod = () =>
    download("ignis_calibration_validation.json", "application/json", JSON.stringify({ generated: meta.generated, calibration: meta.calibration, validation: meta.validation, events: meta.events }, null, 1));
  const exportMatching = () => download("ignis_matching.json", "application/json", JSON.stringify(extras.matching, null, 1));

  return (
    <div className="view-pad">
      <header className="view-head">
        <div className="scene-code mono">METHOD · VALIDATION, DOWNLOADS AND LIMITS</div>
        {m.isCustom && <p className="aoi-note">Validation was run per region, so this view shows the whole study area while your own area is selected. The CSV still exports your area.</p>}
      </header>

      <section className="dl-grid">
        <div className="dl-card glass main">
          <div className="mono who">FIRE RECORD · CSV, OPENS IN EXCEL</div>
          <h3>Harmonized detections for {regionName}</h3>
          <p>
            The fire record on one scale: MODIS years converted to VIIRS, with the 80% range and how unusual each day was. Choose the dates, then take
            it day by day or as monthly totals with each month's rank.
          </p>
          <div className="dl-dates">
            <label>
              <span className="mono">FROM</span>
              <input type="date" value={from} min={meta.start} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} />
            </label>
            <label>
              <span className="mono">TO</span>
              <input type="date" value={to} min={from} max={meta.end} onChange={(e) => e.target.value && setTo(e.target.value)} />
            </label>
            <span className="mono dim">{Math.max(0, iTo - iFrom + 1).toLocaleString("en-US")} DAYS</span>
          </div>
          <div className="dl-row">
            <button className="btn-primary small" onClick={exportCsv}>
              ↓ Daily (CSV)
            </button>
            <button className="btn-ghost small" onClick={exportMonthly}>
              ↓ Monthly summary (CSV)
            </button>
          </div>
        </div>
        <div className="dl-card glass">
          <div className="mono who">CALIBRATION · JSON</div>
          <h3>How MODIS was converted</h3>
          <p>
            The conversion from MODIS to the VIIRS scale for each region, how well it held up on years it never saw, and the biggest episodes. For anyone
            checking or reusing the method.
          </p>
          <button className="btn-ghost small" onClick={exportMethod}>
            ↓ Calibration (JSON)
          </button>
        </div>
        <div className="dl-card glass">
          <div className="mono who">MATCHING · JSON</div>
          <h3>Do the sensors agree?</h3>
          <p>
            Individual MODIS and VIIRS detections paired within a set distance and time, with the match rates behind the Verify view. Southeast Asia
            only.
          </p>
          <button className="btn-ghost small" onClick={exportMatching} disabled={!extras.matching}>
            ↓ Matching (JSON)
          </button>
        </div>
      </section>

      <Validation data={data} regionId={m.isCustom ? "study_area" : regionId} />

      <SectorCompare currentId={meta.sector?.id ?? "sea"} />

      <div className="limits-grid">
        <div className="v-box">
          <h3>Method in six steps</h3>
          <ol className="steps">
            <li>Reference scale: NOAA-20 VIIRS 375 m, the satellite that carries the record forward.</li>
            <li>Suomi NPP is aligned to it with a per-region ratio from days both observed (about 1.0).</li>
            <li>MODIS is mapped to VIIRS with a per-region seasonal regression of log(1 + weekly detections).</li>
            <li>Uncertainty comes from leave-one-year-out cross-validation, so every band reflects error on years the model never saw.</li>
            <li>Each week is ranked against the same time of year in all other years, never including the year being judged.</li>
            <li>The forecast predicts each coming week's departure from normal from recent weeks and the El Niño index, and is scored on held-out years.</li>
          </ol>
        </div>
        <div className="v-box">
          <h3>Honest limits</h3>
          <ul>
            <li>Counts are detections, not burned area or emissions. A hotspot is a thermal anomaly, not a confirmed fire.</li>
            <li>The Live view and Fire Wire use near-real-time data, which is preliminary and is not filtered for static heat sources.</li>
            <li>Smouldering peat fires can stay below detection, and cloud or thick smoke can hide fires entirely.</li>
            <li>Regions use coarse outlines on a 0.5° grid: good for regional totals, not for borders.</li>
            <li>The MODIS conversion assumes the sensors related to each other in the past as they do today.</li>
            <li>Before Aqua's data began in mid-2002 only Terra was observing, so 2001 and early 2002 are probably undercounted.</li>
            <li>Detection matching covers two sample periods (August to October 2019 and 2023) and NOAA-20 only.</li>
            <li>2026 comes from NOAA-20 alone: standard data to July, near-real-time after, with static sources removed where standard data flagged them. NOAA-21 is not yet in the record.</li>
          </ul>
        </div>
        <div className="v-box">
          <h3>Data and acknowledgment</h3>
          <p className="ack">
            We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS)
            (https://earthdata.nasa.gov/firms), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE)
            (https://earthdata.nasa.gov/lance) and NASA's Earth Science Data and Information System (ESDIS). Globe and true-colour imagery: NASA Global
            Imagery Browse Services (GIBS). Map tiles: Esri. Data generated {meta.generated}.
          </p>
        </div>
        <div className="v-box">
          <h3>AI assistance</h3>
          <p>
            This project was built with the help of Claude (Anthropic) for code and analysis. Sound is generated in the browser. The team directed the
            work and is responsible for the choices and results.
          </p>
        </div>
      </div>
    </div>
  );
}
