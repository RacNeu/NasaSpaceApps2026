import { useMemo } from "react";
import { scaleBand, scaleLinear, scaleLog } from "d3-scale";
import { interpolateViridis } from "d3-scale-chromatic";
import type { Dataset } from "../types";
import { fmtNum } from "../lib";
import { Ticker } from "../fx";

interface Props {
  data: Dataset;
  regionId: string;
}

const W = 520;
const H = 340;
const M = { top: 14, right: 14, bottom: 38, left: 52 };

function Scatter({ points }: { points: [number, number, number][] }) {
  const pts = points.map(([yr, o, p]) => [yr, Math.max(o, 1), Math.max(p, 1)] as const);
  const max = Math.max(10, ...pts.flatMap((p) => [p[1], p[2]])) * 1.3;
  const sc = scaleLog().domain([1, max]).range([0, H - M.top - M.bottom]);
  const sx = scaleLog().domain([1, max]).range([0, W - M.left - M.right]);
  const sy = scaleLog().domain([1, max]).range([H - M.top - M.bottom, 0]);
  const years = pts.map((p) => p[0]);
  const y0 = Math.min(...years);
  const y1 = Math.max(...years);
  const ticks = [1, 10, 100, 1000, 10000, 100000].filter((v) => v <= max);
  void sc;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="vchart" role="img" aria-label="Observed versus predicted weekly detections">
      <g transform={`translate(${M.left},${M.top})`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={0} x2={W - M.left - M.right} y1={sy(v)} y2={sy(v)} className="grid" />
            <line y1={0} y2={H - M.top - M.bottom} x1={sx(v)} x2={sx(v)} className="grid" />
            <text x={-8} y={sy(v)} dy="0.32em" textAnchor="end" className="axis">
              {fmtNum(v)}
            </text>
            <text x={sx(v)} y={H - M.top - M.bottom + 16} textAnchor="middle" className="axis">
              {fmtNum(v)}
            </text>
          </g>
        ))}
        <line x1={sx(1)} y1={sy(1)} x2={sx(max)} y2={sy(max)} className="one-one" />
        {pts.map((p, i) => (
          <circle key={i} cx={sx(p[1])} cy={sy(p[2])} r={2.6} fill={interpolateViridis((p[0] - y0) / Math.max(1, y1 - y0))} opacity={0.75} />
        ))}
        <text x={(W - M.left - M.right) / 2} y={H - M.top - 2} textAnchor="middle" className="axis-title">
          Observed by VIIRS (7-day detections)
        </text>
        <text transform={`translate(-40,${(H - M.top - M.bottom) / 2}) rotate(-90)`} textAnchor="middle" className="axis-title">
          Predicted from MODIS alone
        </text>
      </g>
    </svg>
  );
}

function Annual({ rows }: { rows: { year: number; observed: number; predicted: number }[] }) {
  const x0 = scaleBand<number>().domain(rows.map((r) => r.year)).range([0, W - M.left - M.right]).paddingInner(0.2);
  const x1 = scaleBand<string>().domain(["observed", "predicted"]).range([0, x0.bandwidth()]).padding(0.05);
  const max = Math.max(1, ...rows.flatMap((r) => [r.observed, r.predicted]));
  const y = scaleLinear().domain([0, max * 1.05]).range([H - M.top - M.bottom, 0]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="vchart" role="img" aria-label="Observed versus predicted annual totals">
      <g transform={`translate(${M.left},${M.top})`}>
        {y.ticks(4).map((v) => (
          <g key={v}>
            <line x1={0} x2={W - M.left - M.right} y1={y(v)} y2={y(v)} className="grid" />
            <text x={-8} y={y(v)} dy="0.32em" textAnchor="end" className="axis">
              {fmtNum(v)}
            </text>
          </g>
        ))}
        {rows.map((r) => (
          <g key={r.year} transform={`translate(${x0(r.year)},0)`}>
            <rect x={x1("observed")} y={y(r.observed)} width={x1.bandwidth()} height={y(0) - y(r.observed)} fill="#b18cff" />
            <rect x={x1("predicted")} y={y(r.predicted)} width={x1.bandwidth()} height={y(0) - y(r.predicted)} fill="#f4a259" />
            <text x={x0.bandwidth() / 2} y={H - M.top - M.bottom + 16} textAnchor="middle" className="axis">
              {String(r.year).slice(2)}
            </text>
          </g>
        ))}
        <text x={(W - M.left - M.right) / 2} y={H - M.top - 2} textAnchor="middle" className="axis-title">
          Year ({rows.length ? `’${String(rows[0].year).slice(2)} to ’${String(rows[rows.length - 1].year).slice(2)}` : ""}): total detections
        </text>
      </g>
    </svg>
  );
}

export function Validation({ data, regionId }: Props) {
  const { meta } = data;
  const cal = meta.calibration[regionId];
  const val = meta.validation[regionId];
  const name = regionId === "study_area" ? "the whole study area" : (meta.regions.find((r) => r.id === regionId)?.name ?? regionId);
  const typicalFactor = useMemo(() => Math.exp(cal.median_abs_log_error), [cal]);
  const annualErr = useMemo(() => {
    const errs = val.annual.map((a) => Math.abs(a.predicted - a.observed) / Math.max(a.observed, 1));
    return errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : NaN;
  }, [val]);

  return (
    <div className="validation">
      <div className="v-intro">
        <h2>Does the harmonization hold up?</h2>
        <p>
          Before 2012 only MODIS flew, so any claim about the older record rests on one question: can MODIS counts be turned into the
          VIIRS scale reliably? We tested that for <b>{name}</b> by hiding one year at a time, building the conversion from the
          other years, and checking it against what VIIRS actually saw in the hidden year. Every point below is a prediction the model
          had never seen.
        </p>
      </div>

      <div className="v-cards">
        <div className="v-card">
          <div className="v-big"><Ticker text={String(`×${typicalFactor.toFixed(2)}`)} /></div>
          <div className="v-label">typical error on a weekly total (median)</div>
        </div>
        <div className="v-card">
          <div className="v-big"><Ticker text={String(`${Math.round(cal.cv_coverage_80 * 100)}%`)} /></div>
          <div className="v-label">of held-out weeks fall inside the stated 80% band</div>
        </div>
        <div className="v-card">
          <div className="v-big"><Ticker text={String(cal.cv_r2_log === null ? "n/a" : cal.cv_r2_log.toFixed(2))} /></div>
          <div className="v-label">cross-validated R² (log scale)</div>
        </div>
        <div className="v-card">
          <div className="v-big"><Ticker text={String(Number.isNaN(annualErr) ? "n/a" : `${Math.round(annualErr * 100)}%`)} /></div>
          <div className="v-label">average error on whole-year totals</div>
        </div>
      </div>

      <div className="v-grid">
        <figure>
          <figcaption>Weekly detections: MODIS-based prediction vs VIIRS observation</figcaption>
          <Scatter points={val.scatter} />
          <div className="fineprint">Both axes are logarithmic. Points on the diagonal are perfect. Colour runs from the earliest to the latest year.</div>
        </figure>
        <figure>
          <figcaption>Yearly totals, held-out predictions</figcaption>
          <Annual rows={val.annual} />
          <div className="fineprint">
            <span className="key" style={{ background: "#b18cff" }} /> observed by VIIRS <span className="key" style={{ background: "#f4a259" }} /> predicted from MODIS
          </div>
        </figure>
      </div>

      <div className="v-grid">
        <div className="v-box">
          <h3>Sensor facts for {name}</h3>
          <table className="mini wide">
            <tbody>
              <tr>
                <td>Raw VIIRS-to-MODIS detection ratio</td>
                <td>{cal.raw_viirs_to_modis_ratio ? `${cal.raw_viirs_to_modis_ratio}×` : "n/a"}</td>
              </tr>
              <tr>
                <td>Suomi NPP → NOAA-20 factor</td>
                <td>×{cal.snpp_to_noaa20.toFixed(2)}</td>
              </tr>
              <tr>
                <td>Mean fire power per detection, MODIS</td>
                <td>{cal.mean_frp_mw.modis} MW</td>
              </tr>
              <tr>
                <td>Mean fire power per detection, Suomi NPP</td>
                <td>{cal.mean_frp_mw.snpp} MW</td>
              </tr>
              <tr>
                <td>Mean fire power per detection, NOAA-20</td>
                <td>{cal.mean_frp_mw.noaa20} MW</td>
              </tr>
              <tr>
                <td>Independent weekly windows used to fit</td>
                <td>{cal.n_windows}</td>
              </tr>
            </tbody>
          </table>
          <div className="fineprint">
            MODIS reports fewer, stronger detections because its pixels are 1 km wide; VIIRS pixels are 375 m, so it also sees small fires.
            A single constant factor cannot bridge them, which is why the conversion also adapts to the season and to the fire level.
          </div>
        </div>
        <div className="v-box">
          <h3>How the harmonization works</h3>
          <ol className="steps">
            <li>Put every satellite on one scale: NOAA-20 VIIRS, the sensor that carries the record forward.</li>
            <li>Align Suomi NPP to it using days both observed. NOAA-21 will extend it the same way.</li>
            <li>Learn how a week of MODIS detections maps to VIIRS, separately for each region and each season.</li>
            <li>Where VIIRS did not exist, estimate from MODIS and show an honest 80% range taken from held-out errors.</li>
            <li>Rank every week against the same time of year in all other years, never including the year being judged.</li>
          </ol>
          <div className="fineprint">Days when a sensor returned zero detections over the whole study box are treated as missing data, not as "no fire".</div>
        </div>
      </div>

      <div className="v-box limits">
        <h3>Known limits</h3>
        <ul>
          <li>Counts are detections, not burned area or emissions. Peat fires burn underground and may stay below detection.</li>
          <li>Cloud and thick smoke block the view, so a quiet day can be a blind day. This is largest in the wet season.</li>
          <li>Regions use coarse outlines on a 0.5° grid. They are good for regional totals but not for border questions.</li>
          <li>The conversion was learned from 2012 onward. It assumes MODIS and VIIRS relate to each other the same way in earlier years.</li>
        </ul>
      </div>
    </div>
  );
}
