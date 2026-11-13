import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dataset, Extras } from "../types";
import { audio } from "../audio";
import { useSeen, useVisible } from "../hooks";
import { dateAt, fmtDate, indexOf } from "../lib";
import { MapLegend, MapView } from "./MapView";
import { FireClock } from "./FireClock";
import { CalendarHeatmap, HeatLegend, type HeatMode } from "./CalendarHeatmap";
import { YearChart } from "./YearChart";
import { DetailPanel } from "./DetailPanel";
import { Validation } from "./Validation";

type Tab = "explore" | "validation" | "limits";

const download = (name: string, mime: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export function Findings({ data, extras }: { data: Dataset; extras: Extras }) {
  const { meta, daily } = data;
  const [seenRef, seen] = useSeen<HTMLDivElement>("600px");
  const [visRef, visible] = useVisible<HTMLElement>(0.15);
  const [tab, setTab] = useState<Tab>("explore");
  const [regionId, setRegionId] = useState("study_area");
  const [t, setT] = useState(0);
  const [mode, setMode] = useState<HeatMode>("anomaly");
  const [playing, setPlaying] = useState(false);
  const [mapMode, setMapMode] = useState<"heat" | "cells">("heat");

  useEffect(() => {
    const best = [...meta.events].sort((a, b) => b.total - a.total)[0];
    setT(best ? indexOf(meta.start, best.peak) : daily.days - 1);
  }, [meta, daily.days]);

  const maxT = daily.days - 1;
  const clamp = useCallback((v: number) => Math.max(0, Math.min(maxT, v)), [maxT]);
  const pick = useCallback(
    (i: number) => {
      setPlaying(false);
      setT(clamp(i));
      audio.ping(520);
    },
    [clamp],
  );

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setT((cur) => {
        if (cur + 7 > maxT) {
          setPlaying(false);
          return cur;
        }
        return cur + 7;
      });
    }, 140);
    return () => clearInterval(id);
  }, [playing, maxT]);

  useEffect(() => {
    if (!visible || tab !== "explore") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") setT((c) => clamp(c + (e.shiftKey ? 7 : 1)));
      if (e.key === "ArrowLeft") setT((c) => clamp(c - (e.shiftKey ? 7 : 1)));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, tab, clamp]);

  const events = useMemo(() => [...meta.events].sort((a, b) => b.total - a.total).slice(0, 8), [meta.events]);
  const week = Math.min(Math.floor(t / 7), data.grid.weeks - 1);

  const exportCsv = () => {
    const s = daily.regions[regionId];
    const rows = ["date,region,harmonized_detections_per_day,lower_80,upper_80,source,percentile_vs_other_years,typical_per_day,modis_raw,suomi_npp_raw,noaa20_raw"];
    const num = (v: number) => (Number.isNaN(v) ? "" : String(Math.round(v * 10) / 10));
    for (let i = 0; i < daily.days; i++) {
      if (s.src[i] === 0) continue;
      const d = dateAt(meta.start, i).toISOString().slice(0, 10);
      rows.push(
        [d, regionId, num(s.harm[i]), num(s.lo[i]), num(s.hi[i]), s.src[i] === 1 ? "observed_viirs" : "estimated_from_modis", num(s.pct[i]), num(s.norm[i]), num(s.modis[i]), num(s.snpp[i]), num(s.noaa20[i])].join(","),
      );
    }
    download(`ignis_${regionId}_harmonized_daily.csv`, "text/csv", rows.join("\n"));
  };
  const exportMethod = () =>
    download("ignis_calibration_validation.json", "application/json", JSON.stringify({ generated: meta.generated, calibration: meta.calibration, validation: meta.validation, events: meta.events }, null, 1));
  const exportMatching = () => download("ignis_matching.json", "application/json", JSON.stringify(extras.matching, null, 1));

  return (
    <section id="findings" ref={visRef} className="scene scene-find">
      <div className="scene-inner wide stack">
        <div className="scene-copy full">
          <div className="scene-code mono">SCENE 05 · FINDINGS</div>
          <h2>The mission results</h2>
          <p className="lede">
            Matching shows where the sensors agree. Counting over time needs more: each satellite is placed on one scale, MODIS is converted to the
            VIIRS scale where VIIRS did not yet exist, and every estimate carries an honest range. Explore 25 years of record below.
          </p>
          <div className="tabs-row" role="tablist">
            {([["explore", "Explore the record"], ["validation", "Does it hold up?"], ["limits", "Method & limits"]] as [Tab, string][]).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
            <span className="spacer" />
            <div className="dl-row">
              <button className="btn-ghost small" onClick={exportCsv}>
                ↓ Harmonized series (CSV)
              </button>
              <button className="btn-ghost small" onClick={exportMethod}>
                ↓ Calibration (JSON)
              </button>
              <button className="btn-ghost small" onClick={exportMatching}>
                ↓ Matching (JSON)
              </button>
            </div>
          </div>
          <div className="region-bar" role="group" aria-label="Region">
            <span className="label mono">REGION</span>
            {meta.regions.map((r) => (
              <button key={r.id} className={`pill ${regionId === r.id ? "on" : ""}`} onClick={() => setRegionId(r.id)}>
                <i style={{ background: r.color }} />
                {r.name}
              </button>
            ))}
          </div>
        </div>

        {tab === "explore" && (
          <div ref={seenRef}>
            <div className="episodes" aria-label="Major episodes">
              <span className="label mono">BIGGEST EPISODES</span>
              {events.map((ev) => (
                <button
                  key={ev.peak}
                  className={`episode ${t >= indexOf(meta.start, ev.start) && t <= indexOf(meta.start, ev.end) ? "on" : ""}`}
                  onClick={() => {
                    setRegionId("study_area");
                    pick(indexOf(meta.start, ev.peak));
                  }}
                >
                  {fmtDate(dateAt(meta.start, indexOf(meta.start, ev.peak))).replace(/^\d+ /, "")}
                  {ev.times_normal ? <em>{ev.times_normal}× normal</em> : null}
                </button>
              ))}
            </div>

            <div className="row two">
              <section className="card map-card">
                <div className="card-head">
                  <h3>Where it burned</h3>
                  <div className="play">
                    <div className="seg" role="group" aria-label="Map style">
                      <button className={mapMode === "heat" ? "on" : ""} onClick={() => setMapMode("heat")}>
                        Heat
                      </button>
                      <button className={mapMode === "cells" ? "on" : ""} onClick={() => setMapMode("cells")}>
                        Grid cells
                      </button>
                    </div>
                    <button className="btn-ghost small" onClick={() => setPlaying((p) => !p)} aria-label={playing ? "Pause" : "Play through time"}>
                      {playing ? "❚❚ Pause" : "▶ Play"}
                    </button>
                    <span className="week-label mono">Week of {fmtDate(dateAt(meta.start, week * 7))}</span>
                  </div>
                </div>
                <div className="map-box">
                  {seen && <MapView data={data} week={week} regionId={regionId} mode={mapMode} />}
                  <MapLegend />
                </div>
                <input className="slider" type="range" min={0} max={maxT} value={t} step={1} onChange={(e) => pick(Number(e.target.value))} aria-label="Date" />
                <div className="slider-ends">
                  <span>{fmtDate(dateAt(meta.start, 0))}</span>
                  <span className="hint">← → keys step a day, Shift for a week</span>
                  <span>{fmtDate(dateAt(meta.start, maxT))}</span>
                </div>
              </section>
              <section className="card">
                <div className="card-head">
                  <h3>The fire clock</h3>
                  <span className="muted">every year, every week</span>
                </div>
                <FireClock data={data} regionId={regionId} t={t} onPick={pick} />
              </section>
            </div>

            <section className="card">
              <div className="card-head">
                <h3>Burning calendar</h3>
                <div className="seg" role="group" aria-label="Colour by">
                  <button className={mode === "anomaly" ? "on" : ""} onClick={() => setMode("anomaly")}>
                    Unusual for the time of year
                  </button>
                  <button className={mode === "level" ? "on" : ""} onClick={() => setMode("level")}>
                    Activity level
                  </button>
                </div>
              </div>
              <CalendarHeatmap data={data} regionId={regionId} t={t} mode={mode} onPick={pick} />
              <div className="heat-foot">
                <HeatLegend mode={mode} />
                <span className="muted">Rows marked ~ are mostly estimated from MODIS because VIIRS was not flying yet.</span>
              </div>
            </section>

            <div className="row detail-row">
              <section className="card">
                <div className="card-head">
                  <h3>One year, sensor by sensor</h3>
                </div>
                <YearChart data={data} regionId={regionId} t={t} onPick={pick} />
              </section>
              <DetailPanel data={data} regionId={regionId} t={t} />
            </div>
          </div>
        )}

        {tab === "validation" && <Validation data={data} regionId={regionId} />}

        {tab === "limits" && (
          <div className="limits-grid">
            <div className="v-box">
              <h3>Method in five steps</h3>
              <ol className="steps">
                <li>Reference scale: NOAA-20 VIIRS 375 m, the satellite that carries the record forward.</li>
                <li>Suomi NPP is aligned to it with a per-region ratio from days both observed (about 1.0).</li>
                <li>MODIS is mapped to VIIRS with a per-region seasonal regression of log(1 + weekly detections).</li>
                <li>Uncertainty comes from leave-one-year-out cross-validation, so every band reflects error on years the model never saw.</li>
                <li>Each week is ranked against the same time of year in all other years, never including the year being judged.</li>
              </ol>
            </div>
            <div className="v-box">
              <h3>Honest limits</h3>
              <ul>
                <li>Counts are detections, not burned area or emissions. A hotspot is a thermal anomaly, not a confirmed fire.</li>
                <li>Smouldering peat fires can stay below detection, and cloud or thick smoke can hide fires entirely.</li>
                <li>Regions use coarse outlines on a 0.5° grid: good for regional totals, not for borders.</li>
                <li>The MODIS conversion assumes the sensors related to each other in the past as they do today.</li>
                <li>Before Aqua's data began in mid-2002 only Terra was observing, so 2001 and early 2002 are probably undercounted. Treat them as a lower bound.</li>
                <li>Detection matching covers two sample periods (August to October 2019 and 2023) and NOAA-20 only.</li>
                <li>NOAA-21 and 2026 near-real-time data are not yet in the record.</li>
              </ul>
            </div>
            <div className="v-box">
              <h3>Data and acknowledgment</h3>
              <p className="ack">
                We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS)
                (https://earthdata.nasa.gov/firms), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE)
                (https://earthdata.nasa.gov/lance) and NASA's Earth Science Data and Information System (ESDIS). Globe and true-colour imagery:
                NASA Global Imagery Browse Services (GIBS). Map tiles: Esri.
              </p>
            </div>
            <div className="v-box">
              <h3>AI assistance</h3>
              <p>
                This project was built with the help of Claude (Anthropic) for code and analysis. Sound is generated in the browser. The team directed
                the work and is responsible for the choices and results.
              </p>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
