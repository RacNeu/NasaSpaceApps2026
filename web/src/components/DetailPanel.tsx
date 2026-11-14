import { useMemo } from "react";
import type { Dataset } from "../types";
import { dateAt, fmtDate, fmtNum, levelFor } from "../lib";

interface Props {
  data: Dataset;
  regionId: string;
  t: number;
}

const avg = (a: Float32Array, t: number, h = 3) => {
  let s = 0;
  let c = 0;
  for (let i = Math.max(0, t - h); i <= Math.min(a.length - 1, t + h); i++) {
    if (!Number.isNaN(a[i])) {
      s += a[i];
      c++;
    }
  }
  return c >= 4 ? s / c : NaN;
};

export function DetailPanel({ data, regionId, t }: Props) {
  const { meta, daily, grid } = data;
  const s = daily.regions[regionId];
  const custom = regionId === "custom";
  const regionName = regionId === "study_area" ? "the whole study area" : custom ? "your selected area" : (meta.regions.find((r) => r.id === regionId)?.name ?? regionId);
  const date = dateAt(meta.start, t);

  const info = useMemo(() => {
    const v = avg(s.harm, t);
    const norm = s.norm[t];
    const lo = avg(s.lo, t);
    const hi = avg(s.hi, t);
    return {
      v,
      norm,
      p: s.pct[t],
      ratio: norm > 0 ? v / norm : NaN,
      est: s.src[t] === 2,
      none: s.src[t] === 0,
      lo,
      hi,
      raw: { modis: avg(s.modis, t), snpp: avg(s.snpp, t), noaa20: avg(s.noaa20, t) },
    };
  }, [s, t]);

  const drivers = useMemo(() => {
    return meta.regions
      .filter((r) => r.id !== "study_area" && r.id !== "custom")
      .map((r) => {
        const rs = daily.regions[r.id];
        const v = avg(rs.harm, t);
        const norm = rs.norm[t];
        return { id: r.id, name: r.name, color: r.color, v, norm, ratio: norm > 0 ? v / norm : NaN };
      })
      .filter((d) => !Number.isNaN(d.v));
  }, [daily, meta.regions, t]);

  const totalV = drivers.reduce((a, d) => a + d.v, 0);

  const hotspots = useMemo(() => {
    const row = grid.data[Math.floor(t / 7)] ?? [];
    const items: { lat: number; lon: number; v: number; region: string }[] = [];
    for (let i = 0; i < row.length; i += 2) {
      const [cx, cy, rg] = grid.cells[row[i]];
      items.push({
        lon: meta.box[0] + (cx + 0.5) * meta.cell,
        lat: meta.box[1] + (cy + 0.5) * meta.cell,
        v: row[i + 1],
        region: rg >= 0 ? meta.regions[rg].name : "outside the four regions",
      });
    }
    items.sort((a, b) => b.v - a.v);
    const total = items.reduce((a, b) => a + b.v, 0);
    return { top: items.slice(0, 4), total };
  }, [grid, meta, t]);

  const level = levelFor(info.p);
  const lat = (v: number) => `${Math.abs(v).toFixed(2)}°${v >= 0 ? "N" : "S"}`;
  const lon = (v: number) => `${v.toFixed(2)}°E`;

  let story: string;
  if (info.none) {
    story = `No sensor reported data for ${regionName} around ${fmtDate(date)}.`;
  } else {
    const parts = [
      `Around ${fmtDate(date)}, ${regionName} recorded about ${fmtNum(info.v)} fire detections a day on the harmonized (VIIRS-equivalent) scale.`,
    ];
    if (!Number.isNaN(info.ratio) && !Number.isNaN(info.p)) {
      parts.push(
        info.ratio >= 1.15
          ? `That is ${info.ratio.toFixed(1)}× the typical level for this time of year, ${
              info.p >= 99.5 ? "higher than any other year at this point in the season." : `higher than ${Math.round(info.p)}% of the same period in other years.`
            }`
          : info.ratio <= 0.85
            ? `That is ${(1 / Math.max(info.ratio, 0.01)).toFixed(1)}× quieter than typical for this time of year.`
            : `That is close to the typical level for this time of year.`,
      );
    }
    story = parts.join(" ");
  }

  return (
    <section className="detail" aria-label="Selected date details">
      <header className="detail-head">
        <div>
          <div className="eyebrow">Selected date</div>
          <h3>{fmtDate(date)}</h3>
        </div>
        <span className={`badge ${level.tone}`}>{level.label}</span>
      </header>
      <p className="story">{story}</p>

      {!info.none && (
        <div className="stat-row">
          <div className="stat">
            <div className="stat-n">{fmtNum(info.v)}</div>
            <div className="stat-l">detections/day</div>
          </div>
          <div className="stat">
            <div className="stat-n">{Number.isNaN(info.norm) ? "n/a" : fmtNum(info.norm)}</div>
            <div className="stat-l">typical for date</div>
          </div>
          <div className="stat">
            <div className="stat-n">{Number.isNaN(info.p) ? "n/a" : `${Math.round(info.p)}`}</div>
            <div className="stat-l">percentile</div>
          </div>
        </div>
      )}

      <div className="provenance">
        {info.none ? null : custom ? (
          <>
            <b>{info.est ? "Estimated from MODIS." : "Observed by VIIRS."}</b> Your area is summed from the weekly 0.5° grid, so the value is a weekly
            average and has no uncertainty range of its own.
          </>
        ) : info.est ? (
          <>
            <b>Estimated from MODIS.</b> VIIRS did not exist yet. The 80% range is {fmtNum(info.lo)} to {fmtNum(info.hi)} per day,
            from cross-validated errors in years where both sensors flew.
          </>
        ) : (
          <>
            <b>Observed by VIIRS.</b> The value is measured directly at 375 m (Suomi NPP, or NOAA-20 where available).
          </>
        )}
      </div>

      <h4>{custom ? "The four regions that week" : "Which regions are driving it"}</h4>
      <ul className="drivers">
        {drivers.map((d) => (
          <li key={d.id}>
            <span className="dot" style={{ background: d.color }} />
            <span className="d-name">{d.name}</span>
            <span className="d-bar">
              <i style={{ width: `${totalV > 0 ? (100 * d.v) / totalV : 0}%`, background: d.color }} />
            </span>
            <span className="d-val">
              {fmtNum(d.v)}
              {!Number.isNaN(d.ratio) && <em className={d.ratio >= 1.5 ? "hot" : ""}> {d.ratio.toFixed(1)}×</em>}
            </span>
          </li>
        ))}
      </ul>
      <div className="fineprint">Bars show share of the four-region total; × is versus typical for this time of year.</div>

      {hotspots.top.length > 0 && (
        <>
          <h4>Hottest cells this week</h4>
          <ol className="hot-cells">
            {hotspots.top.map((h, i) => (
              <li key={i}>
                <b>{fmtNum(h.v)}</b> detections near {lat(h.lat)}, {lon(h.lon)} <span className="muted">· {h.region}</span>
              </li>
            ))}
          </ol>
        </>
      )}

      {!info.none && !custom && (
        <>
          <h4>Why raw counts can't be compared</h4>
          <table className="mini">
            <tbody>
              <tr>
                <td>MODIS (1 km)</td>
                <td>{Number.isNaN(info.raw.modis) ? "no data" : fmtNum(info.raw.modis)}</td>
              </tr>
              <tr>
                <td>Suomi NPP VIIRS (375 m)</td>
                <td>{Number.isNaN(info.raw.snpp) ? "no data" : fmtNum(info.raw.snpp)}</td>
              </tr>
              <tr>
                <td>NOAA-20 VIIRS (375 m)</td>
                <td>{Number.isNaN(info.raw.noaa20) ? "no data" : fmtNum(info.raw.noaa20)}</td>
              </tr>
            </tbody>
          </table>
          <div className="fineprint">Raw detections per day (7-day mean). Sensors see different fire sizes, so we put them on one scale.</div>
        </>
      )}
    </section>
  );
}
