import { useMemo, useState } from "react";
import type { DemoDay, Matching } from "../types";
import { useNear } from "../hooks";
import { matchDetections } from "../match";
import { HotspotMap, type HotspotView } from "./HotspotMap";
import { FrpBars, OffsetHistogram, SweepGrid } from "./MatchCharts";

type Mode = "side" | "overlay" | "match";

const pct = (v: number) => (Number.isFinite(v) ? `${Math.round(v * 100)}%` : "n/a");

export function Harmonization({ demos, matching }: { demos: DemoDay[]; matching: Matching }) {
  const [ref, seen] = useNear<HTMLElement>("600px");
  const [di, setDi] = useState(0);
  const [mode, setMode] = useState<Mode>("match");
  const [radius, setRadius] = useState(1);
  const [dt, setDt] = useState(60);
  const [aquaOnly, setAquaOnly] = useState(true);
  const demo = demos[di];
  const year = Number(demo.date.slice(0, 4));
  const period = `Aug to Oct ${year}`;

  const res = useMemo(() => matchDetections(demo, radius, dt, aquaOnly), [demo, radius, dt, aquaOnly]);

  const stats = useMemo(() => {
    const idxM = demo.modis.map((_, i) => i).filter((i) => !aquaOnly || demo.modis[i][5] === 1);
    const m = idxM.length;
    const mHit = idxM.filter((i) => res.modis[i]).length;
    const v = demo.viirs.length;
    const vHit = res.viirs.reduce((a, b) => a + b, 0);
    const dts = idxM.filter((i) => res.modis[i]).map((i) => res.modisDt[i]);
    const med = dts.length ? [...dts].sort((a, b) => a - b)[Math.floor(dts.length / 2)] : NaN;
    return { m, mHit, v, vHit, med };
  }, [demo, res, aquaOnly]);

  const view: HotspotView = {
    modis: true,
    viirs: true,
    terra: !aquaOnly,
    aqua: true,
    matchMode: mode === "match",
    window: null,
  };
  const viewMODIS: HotspotView = { ...view, viirs: false, matchMode: false };
  const viewVIIRS: HotspotView = { ...view, modis: false, matchMode: false };

  const head = matching.headline.by_year?.[String(year)];

  return (
    <section id="harmonization" ref={ref} className="scene scene-harm">
      <div className="scene-inner wide">
        <div className="scene-copy">
          <div className="scene-code mono">SCENE 04 · HARMONIZATION</div>
          <h2>Bringing observations together</h2>
          <p className="lede">
            Drawing both sensors on one map is not harmonization. Two detections only count as the same event if they agree in space and in
            time, so we set the tolerances explicitly and measure how often the sensors agree. Change them and watch the match rate move.
          </p>
          <div className="seg-row" role="group" aria-label="View">
            {(["match", "overlay", "side"] as Mode[]).map((k) => (
              <button key={k} className={`seg-btn ${mode === k ? "on" : ""}`} onClick={() => setMode(k)}>
                {k === "match" ? "Matched vs unmatched" : k === "overlay" ? "Overlay" : "Side by side"}
              </button>
            ))}
          </div>
          <div className="seg-row" role="group" aria-label="Day">
            {demos.map((d, i) => (
              <button key={d.id} className={`seg-btn ${di === i ? "on" : ""}`} onClick={() => setDi(i)}>
                {d.date}
              </button>
            ))}
          </div>
          <div className="slider-block">
            <div className="time-head">
              <span className="mono">SPATIAL TOLERANCE</span>
              <b className="mono">{radius.toFixed(2)} km</b>
            </div>
            <input type="range" className="slider" min={0.25} max={3} step={0.25} value={radius} onChange={(e) => setRadius(Number(e.target.value))} aria-label="Spatial tolerance in kilometres" />
          </div>
          <div className="slider-block">
            <div className="time-head">
              <span className="mono">TIME TOLERANCE</span>
              <b className="mono">±{dt} min</b>
            </div>
            <input type="range" className="slider" min={15} max={180} step={15} value={dt} onChange={(e) => setDt(Number(e.target.value))} aria-label="Time tolerance in minutes" />
          </div>
          <label className="check block">
            <input type="checkbox" checked={aquaOnly} onChange={(e) => setAquaOnly(e.target.checked)} /> Pair with Aqua only{" "}
            <span className="muted">(Terra passes about three hours earlier than the VIIRS satellites, so it should not be paired at tight tolerances)</span>
          </label>

          <div className="match-stats">
            <div className="ms">
              <div className="mono">MODIS WITH A VIIRS PARTNER</div>
              <b className="cyan">{pct(stats.m ? stats.mHit / stats.m : NaN)}</b>
              <span>
                {stats.mHit} of {stats.m}
              </span>
            </div>
            <div className="ms">
              <div className="mono">VIIRS WITH A MODIS PARTNER</div>
              <b className="amber">{pct(stats.v ? stats.vHit / stats.v : NaN)}</b>
              <span>
                {stats.vHit} of {stats.v}
              </span>
            </div>
            <div className="ms">
              <div className="mono">MEDIAN TIME GAP</div>
              <b>{Number.isNaN(stats.med) ? "n/a" : `${stats.med > 0 ? "+" : ""}${Math.round(stats.med)} min`}</b>
              <span>VIIRS relative to MODIS</span>
            </div>
          </div>
        </div>

        <div className="scene-map">
          {!seen ? (
            <div className="hs-map-wrap">
              <div className="hs-map" />
            </div>
          ) : mode === "side" ? (
              <div className="split">
                <HotspotMap key={`a${demo.id}`} demo={demo} view={viewMODIS} imagery="aqua" modisFlags={null} viirsFlags={null} syncId="harm" label="MODIS · 1 km · Aqua imagery" />
                <HotspotMap key={`b${demo.id}`} demo={demo} view={viewVIIRS} imagery="noaa20" modisFlags={null} viirsFlags={null} syncId="harm" label="VIIRS · 375 m · NOAA-20 imagery" />
              </div>
            ) : (
              <HotspotMap
                key={`c${demo.id}`}
                demo={demo}
                view={view}
                imagery="aqua"
                modisFlags={res.modis}
                viirsFlags={res.viirs}
              />
            )}
          <div className="map-key">
            {mode === "match" ? (
              <>
                <span className="k cyan" /> MODIS matched
                <span className="k cyan hollow" /> MODIS unmatched
                <span className="k amber" /> VIIRS matched
                <span className="k amber hollow" /> VIIRS unmatched
              </>
            ) : (
              <>
                <span className="k cyan" /> MODIS
                <span className="k amber" /> VIIRS
              </>
            )}
          </div>
        </div>
      </div>

      <div className="scene-inner wide below">
        <div className="findings-head">
          <div className="scene-code mono">WHAT THE MATCHING SHOWS · {period.toUpperCase()}</div>
          <p className="lede">
            At {matching.headline.radius_km} km and ±{matching.headline.dt_min} min,{" "}
            {head?.aqua_in_viirs ? (
              <>
                <b className="cyan">{pct(head.aqua_in_viirs.rate)}</b> of Aqua detections have a NOAA-20 partner
                {head.aqua_in_viirs.n_covered ? `, rising to ${pct(head.aqua_in_viirs.rate_covered)} where NOAA-20 observed the area at that time` : ""}.{" "}
              </>
            ) : null}
            {head?.viirs_in_aqua ? (
              <>
                In the other direction only <b className="amber">{pct(head.viirs_in_aqua.rate)}</b> of NOAA-20 detections have an Aqua partner
                {head.viirs_in_aqua.n_covered ? ` (${pct(head.viirs_in_aqua.rate_covered)} where Aqua observed the area)` : ""}. VIIRS reports many more
                small fires than MODIS can see.
              </>
            ) : null}
          </p>
        </div>
        <div className="chart-trio">
          <figure className="chart-card">
            <figcaption>Aqua detections with a VIIRS partner</figcaption>
            <SweepGrid matching={matching} period={period} satellite="Aqua" radius={radius} dt={dt} onPick={(r, t) => { setRadius(r); setDt(t); }} />
            <div className="fineprint">Click a cell to set both tolerances. Rates stop rising past about 90 minutes, which fixes the time window.</div>
          </figure>
          <figure className="chart-card">
            <figcaption>Why Terra is not paired</figcaption>
            <OffsetHistogram matching={matching} />
            <div className="fineprint">
              Aqua's nearest VIIRS neighbour is minutes away. Terra's is hours away, so it observes a different slice of the fire day.
            </div>
          </figure>
          <figure className="chart-card">
            <figcaption>Small fires are what MODIS misses</figcaption>
            <FrpBars matching={matching} />
            <div className="fineprint">
              Share of NOAA-20 detections that Aqua also reports, by fire power. Faint bars: all detections. Solid bars: where Aqua observed the area.
            </div>
          </figure>
        </div>
        <div className="takeaway">
          <div className="mono">THE CONSEQUENCE</div>
          <p>
            Matching pairs of detections proves the sensors agree on the larger fires, but it cannot make the two counts equal. Counting hotspots over
            time needs a calibration that also adapts to season and fire size. That is what the next scene delivers, with its uncertainty shown.
          </p>
        </div>
      </div>
    </section>
  );
}
