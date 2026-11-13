const DAY_MS = 86_400_000;

export const parseDate = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

export const dateAt = (start: string, i: number) => new Date(parseDate(start) + i * DAY_MS);

export const indexOf = (start: string, date: string) => Math.round((parseDate(date) - parseDate(start)) / DAY_MS);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmtDate = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
export const fmtShort = (d: Date) => `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
export const monthName = (m: number) => MONTHS[m];
export const yearOf = (start: string, i: number) => dateAt(start, i).getUTCFullYear();

export const dayOfYear = (d: Date) => {
  const jan1 = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.round((d.getTime() - jan1) / DAY_MS);
};

export const fmtNum = (v: number) => {
  if (!isFinite(v)) return "n/a";
  if (Math.abs(v) < 0.05) return "0";
  if (v >= 100000) return `${Math.round(v / 1000)}k`;
  if (v >= 10000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  if (v >= 1000) return Math.round(v).toLocaleString("en-US");
  if (v >= 100) return String(Math.round(v));
  if (v >= 10) return v.toFixed(0);
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
};

export type Level = { label: string; tone: "quiet" | "typical" | "elevated" | "high" | "extreme" };

export const levelFor = (pct: number): Level => {
  if (!isFinite(pct)) return { label: "No baseline", tone: "typical" };
  if (pct >= 97) return { label: "Exceptional", tone: "extreme" };
  if (pct >= 90) return { label: "Very high", tone: "high" };
  if (pct >= 75) return { label: "Elevated", tone: "elevated" };
  if (pct >= 25) return { label: "Typical", tone: "typical" };
  return { label: "Quiet", tone: "quiet" };
};

/** Centred rolling mean over `win` days, ignoring NaN; NaN when fewer than half the window is valid. */
export function rollingMean(a: Float32Array, win: number): Float32Array {
  const out = new Float32Array(a.length).fill(NaN);
  const h = Math.floor(win / 2);
  for (let i = 0; i < a.length; i++) {
    let s = 0;
    let c = 0;
    for (let k = Math.max(0, i - h); k <= Math.min(a.length - 1, i + h); k++) {
      const v = a[k];
      if (!Number.isNaN(v)) {
        s += v;
        c++;
      }
    }
    if (c >= Math.ceil(win / 2)) out[i] = s / c;
  }
  return out;
}

export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
