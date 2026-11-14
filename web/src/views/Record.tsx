import { useState } from "react";
import type { Mission } from "../mission";
import { FireClock } from "../components/FireClock";
import { CalendarHeatmap, HeatLegend, type HeatMode } from "../components/CalendarHeatmap";
import { YearChart } from "../components/YearChart";
import { DetailPanel } from "../components/DetailPanel";

/** The 25-year record: burning calendar, fire clock and the per-sensor year chart. */
export function Record({ m }: { m: Mission }) {
  const [mode, setMode] = useState<HeatMode>("anomaly");
  const { view, regionId, t, pick } = m;
  return (
    <div className="view-pad">
      <header className="view-head">
        <div className="scene-code mono">
          RECORD · {view.meta.start.slice(0, 4)} TO {view.meta.end.slice(0, 4)}
        </div>
        <h2>The burning calendar</h2>
        <p className="lede">
          Every day of the record on one scale. Colour shows how unusual each week is for its time of year, so a haze year stands out at a glance.
          Click anywhere to move the selected date across the whole console.
        </p>
        {m.isCustom && <p className="aoi-note">Showing your selected area. Custom areas use weekly values from the 0.5° grid and have no uncertainty range.</p>}
      </header>

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
        <CalendarHeatmap data={view} regionId={regionId} t={t} mode={mode} onPick={pick} />
        <div className="heat-foot">
          <HeatLegend mode={mode} />
          <span className="muted">Rows marked ~ are mostly estimated from MODIS because VIIRS was not flying yet.</span>
        </div>
      </section>

      <div className="row record-row">
        <section className="card">
          <div className="card-head">
            <h3>The fire clock</h3>
            <span className="muted">every year, every week</span>
          </div>
          <FireClock data={view} regionId={regionId} t={t} onPick={pick} />
        </section>
        <section className="card">
          <div className="card-head">
            <h3>One year, sensor by sensor</h3>
          </div>
          <YearChart data={view} regionId={regionId} t={t} onPick={pick} />
        </section>
        <DetailPanel data={view} regionId={regionId} t={t} />
      </div>
    </div>
  );
}
