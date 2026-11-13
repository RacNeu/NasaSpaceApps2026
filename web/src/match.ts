import type { DemoDay } from "./types";

const KM = 111.195;

export interface MatchResult {
  modis: Uint8Array; // 1 if the MODIS detection has a VIIRS partner
  viirs: Uint8Array; // 1 if the VIIRS detection has a MODIS partner
  modisDt: Float32Array; // minutes (VIIRS minus MODIS) to the nearest partner, NaN if none
}

/**
 * Pair detections of the two sensors. Two detections match when they are within `radiusKm` of each
 * other on the ground and `dtMin` minutes apart. This is a statement about two sensors flagging a
 * thermal anomaly at about the same place and time, not proof of one fire.
 */
export function matchDetections(demo: DemoDay, radiusKm: number, dtMin: number, aquaOnly = false): MatchResult {
  const cell = 0.02;
  const key = (x: number, y: number) => Math.floor(x / cell) * 100000 + Math.floor(y / cell);
  const index = (pts: number[][]) => {
    const m = new Map<number, number[]>();
    pts.forEach((p, i) => {
      const k = key(p[0], p[1]);
      const a = m.get(k);
      if (a) a.push(i);
      else m.set(k, [i]);
    });
    return m;
  };
  const viirsIdx = index(demo.viirs);
  const modisUse = demo.modis.map((p) => (aquaOnly ? (p[5] === 1 ? p : null) : p));
  const modisIdx = new Map<number, number[]>();
  modisUse.forEach((p, i) => {
    if (!p) return;
    const k = key(p[0], p[1]);
    const a = modisIdx.get(k);
    if (a) a.push(i);
    else modisIdx.set(k, [i]);
  });

  const near = (ax: number, ay: number, at: number, idx: Map<number, number[]>, pts: (number[] | null)[]) => {
    const cx = Math.floor(ax / cell);
    const cy = Math.floor(ay / cell);
    let best = Infinity;
    let bestDt = NaN;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const list = idx.get((cx + dx) * 100000 + (cy + dy));
        if (!list) continue;
        for (const j of list) {
          const q = pts[j];
          if (!q) continue;
          const dt = q[2] - at;
          if (Math.abs(dt) > dtMin) continue;
          const d = Math.hypot((q[1] - ay) * KM, (q[0] - ax) * KM * Math.cos((ay * Math.PI) / 180));
          if (d < best) {
            best = d;
            bestDt = dt;
          }
        }
      }
    }
    return best <= radiusKm ? bestDt : NaN;
  };

  const modis = new Uint8Array(demo.modis.length);
  const modisDt = new Float32Array(demo.modis.length).fill(NaN);
  demo.modis.forEach((p, i) => {
    if (aquaOnly && p[5] !== 1) return;
    const dt = near(p[0], p[1], p[2], viirsIdx, demo.viirs);
    if (!Number.isNaN(dt)) {
      modis[i] = 1;
      modisDt[i] = dt;
    }
  });
  const viirs = new Uint8Array(demo.viirs.length);
  demo.viirs.forEach((p, i) => {
    const dt = near(p[0], p[1], p[2], modisIdx, modisUse);
    if (!Number.isNaN(dt)) viirs[i] = 1;
  });
  return { modis, viirs, modisDt };
}

export const hhmm = (minute: number) => {
  const h = Math.floor(minute / 60) % 24;
  const m = Math.round(minute % 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
