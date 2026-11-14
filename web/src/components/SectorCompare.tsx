import { useEffect, useState } from "react";
import type { SectorEntry } from "../data";
import { Ticker } from "../fx";

interface Row {
  id: string;
  name: string;
  ratio: number;
  modisFrp: number;
  viirsFrp: number;
  coverage: number;
}

/** Spearman rank correlation, enough to say whether two orderings agree. */
function spearman(a: number[], b: number[]) {
  const rank = (v: number[]) => {
    const order = v.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]);
    const r = new Array(v.length);
    order.forEach(([, i], k) => (r[i] = k));
    return r as number[];
  };
  const ra = rank(a);
  const rb = rank(b);
  const n = a.length;
  const d2 = ra.reduce((s, x, i) => s + (x - rb[i]) ** 2, 0);
  return 1 - (6 * d2) / (n * (n * n - 1));
}

/**
 * How big the MODIS-to-VIIRS gap is in each sector. Loads every sector's calibration (a few kB
 * each). The explanatory sentence about fire size only appears if the data supports it.
 */
export function SectorCompare({ currentId }: { currentId: string }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let alive = true;
    const base = import.meta.env.BASE_URL;
    (async () => {
      try {
        const idx = await fetch(`${base}data/sectors.json`).then((r) => (r.ok ? r.json() : null));
        const list: SectorEntry[] = idx?.sectors ?? [];
        if (list.length < 3) return;
        const out = await Promise.all(
          list.map(async (s) => {
            const meta = await fetch(`${base}${s.path}meta.json`).then((r) => r.json());
            const c = meta.calibration.study_area;
            return {
              id: s.id,
              name: s.short,
              ratio: c.raw_viirs_to_modis_ratio ?? NaN,
              modisFrp: c.mean_frp_mw?.modis ?? NaN,
              viirsFrp: c.mean_frp_mw?.noaa20 ?? NaN,
              coverage: c.cv_coverage_80 ?? NaN,
            } as Row;
          }),
        );
        if (alive) setRows(out.filter((r) => Number.isFinite(r.ratio)).sort((a, b) => b.ratio - a.ratio));
      } catch {
        /* the panel is optional */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (!rows || rows.length < 3) return null;
  const max = Math.max(...rows.map((r) => r.ratio));
  const hi = rows[0];
  const lo = rows[rows.length - 1];
  const rho = spearman(
    rows.map((r) => r.ratio),
    rows.map((r) => r.modisFrp),
  );
  const supported = rho <= -0.6;

  return (
    <div className="v-box compare">
      <div className="mono who">ACROSS {rows.length} SECTORS · SAME METHOD</div>
      <h3>The gap between the sensors is not the same everywhere</h3>
      <p className="compare-lede">
        VIIRS reports <b className="amber">{hi.ratio.toFixed(1)}×</b> as many hotspots as MODIS in {hi.name}, but only{" "}
        <b className="cyan">{lo.ratio.toFixed(1)}×</b> in {lo.name}.{" "}
        {supported
          ? "The gap is widest where MODIS sees the weakest fires on average, which fits small fires slipping below its 1 km pixels. One conversion factor cannot serve every region, so each sector is calibrated on its own."
          : "Because the gap differs this much, one conversion factor cannot serve every region, so each sector is calibrated on its own."}
      </p>
      <div className="cmp-rows">
        <div className="cmp-head mono">
          <span>SECTOR</span>
          <span>VIIRS ÷ MODIS HOTSPOTS</span>
          <span>MODIS FRP / DETECTION</span>
          <span>80% BAND HIT</span>
        </div>
        {rows.map((r, i) => (
          <div key={r.id} className={`cmp-row ${r.id === currentId ? "on" : ""}`}>
            <span className="cmp-name">{r.name}</span>
            <span className="cmp-bar">
              <i className="grow-x" style={{ width: `${(100 * r.ratio) / max}%`, animationDelay: `${i * 90}ms` }} />
              <b className="mono">
                <Ticker text={`${r.ratio.toFixed(1)}×`} />
              </b>
            </span>
            <span className="mono">{Number.isFinite(r.modisFrp) ? `${r.modisFrp.toFixed(0)} MW` : "–"}</span>
            <span className="mono">{Number.isFinite(r.coverage) ? `${Math.round(r.coverage * 100)}%` : "–"}</span>
          </div>
        ))}
      </div>
      <p className="fineprint">
        Ratio of all VIIRS (NOAA-20 scale) to MODIS detections on days both flew, 2012–2025. FRP is fire radiative power, a measure of how intense a
        detection is. Rank correlation between the two columns: {rho.toFixed(2)}.
      </p>
    </div>
  );
}
