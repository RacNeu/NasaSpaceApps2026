import type { Mission } from "../mission";
import { Validation } from "../components/Validation";
import { dateAt } from "../lib";

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

  const exportCsv = () => {
    const s = view.daily.regions[regionId];
    const rows = ["date,region,harmonized_detections_per_day,lower_80,upper_80,source,percentile_vs_other_years,typical_per_day,modis_raw,suomi_npp_raw,noaa20_raw"];
    const num = (v: number) => (Number.isNaN(v) ? "" : String(Math.round(v * 10) / 10));
    for (let i = 0; i < view.daily.days; i++) {
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
    <div className="view-pad">
      <header className="view-head">
        <div className="scene-code mono">METHOD · VALIDATION AND LIMITS</div>
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
        {m.isCustom && <p className="aoi-note">Validation was run per region, so this view shows the whole study area while your own area is selected. The CSV still exports your area.</p>}
      </header>

      <Validation data={data} regionId={m.isCustom ? "study_area" : regionId} />

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
            <li>The console replays a historical record. It is not a live feed.</li>
            <li>Smouldering peat fires can stay below detection, and cloud or thick smoke can hide fires entirely.</li>
            <li>Regions use coarse outlines on a 0.5° grid: good for regional totals, not for borders.</li>
            <li>The MODIS conversion assumes the sensors related to each other in the past as they do today.</li>
            <li>Before Aqua's data began in mid-2002 only Terra was observing, so 2001 and early 2002 are probably undercounted.</li>
            <li>Detection matching covers two sample periods (August to October 2019 and 2023) and NOAA-20 only.</li>
            <li>NOAA-21 and 2026 data are not yet in the record.</li>
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
