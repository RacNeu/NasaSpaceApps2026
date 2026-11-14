import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./hooks";

/* ---------------------------------------------------------------- counting numbers */

interface Num {
  value: number;
  decimals: number;
  comma: boolean;
}
interface Parsed {
  /** The text with every animatable number replaced by a placeholder. */
  template: string;
  parts: (string | Num)[];
  nums: number[];
}

const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

function parse(text: string): Parsed {
  const parts: (string | Num)[] = [];
  const nums: number[] = [];
  let template = "";
  let last = 0;
  for (const m of text.matchAll(NUMBER)) {
    const raw = m[0];
    const at = m.index ?? 0;
    const value = Number(raw.replace(/,/g, ""));
    // years read as labels, so they stay still
    const isYear = !raw.includes(",") && !raw.includes(".") && raw.length === 4 && value >= 1900 && value <= 2100;
    if (isYear) continue;
    parts.push(text.slice(last, at));
    template += text.slice(last, at) + "\u0000";
    const dot = raw.indexOf(".");
    parts.push({ value, decimals: dot >= 0 ? raw.length - dot - 1 : 0, comma: raw.includes(",") });
    nums.push(value);
    last = at + raw.length;
  }
  parts.push(text.slice(last));
  template += text.slice(last);
  return { template, parts, nums };
}

function render(p: Parsed, values: number[]) {
  let i = 0;
  return p.parts
    .map((part) => {
      if (typeof part === "string") return part;
      const v = values[i++];
      return part.comma
        ? v.toLocaleString("en-US", { minimumFractionDigits: part.decimals, maximumFractionDigits: part.decimals })
        : v.toFixed(part.decimals);
    })
    .join("");
}

const ease = (k: number) => 1 - Math.pow(1 - k, 3);

/**
 * Shows `text`, with every number in it counting up from zero the first time it appears and
 * rolling smoothly to the new value whenever the text changes. Years and words stay as they are.
 */
export function Ticker({ text, ms = 1100 }: { text: string; ms?: number }) {
  const reduced = useReducedMotion();
  const [out, setOut] = useState(() => (reduced ? text : render(parse(text), parse(text).nums.map(() => 0))));
  const current = useRef<{ template: string; nums: number[] } | null>(null);

  useEffect(() => {
    const p = parse(text);
    if (reduced || p.nums.length === 0) {
      setOut(text);
      current.current = { template: p.template, nums: p.nums };
      return;
    }
    const same = current.current?.template === p.template;
    const from = same ? current.current!.nums : p.nums.map(() => 0);
    const dur = same ? Math.min(ms, 420) : ms;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      const e = ease(k);
      const vals = from.map((f, i) => f + (p.nums[i] - f) * e);
      current.current = { template: p.template, nums: vals };
      setOut(render(p, vals));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, reduced, ms]);

  return <>{out}</>;
}

/* ---------------------------------------------------------------- decoding text */

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
/** A random stand-in of the same kind as the real character, so the decode stays tidy. */
const standIn = (c: string) => {
  const pool = /[A-Z]/.test(c) ? UPPER : /[a-z]/.test(c) ? LOWER : /[0-9]/.test(c) ? DIGITS : "";
  return pool ? pool[(Math.random() * pool.length) | 0] : c;
};

/** How many characters scramble at once, just ahead of the reveal. */
const WAVE = 4;

/**
 * Text that locks on left to right like a decoding signal. Only a short wave of characters
 * flickers ahead of the reveal; each stand-in sits over an invisible copy of the real character,
 * so the line never changes width or wraps differently while it decodes.
 */
export function Scramble({ text, ms = 750 }: { text: string; ms?: number }) {
  const reduced = useReducedMotion();
  const n = text.length;
  const [state, setState] = useState(() => ({ pos: reduced ? n + WAVE : 0, fakes: [] as string[] }));

  useEffect(() => {
    if (reduced) {
      setState({ pos: n + WAVE, fakes: [] });
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    let lastSwap = -1e9;
    let fakes: string[] = [];
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const pos = Math.round(k * (n + WAVE));
      // swap the stand-ins at a calm pace rather than every frame
      if (now - lastSwap > 70) {
        lastSwap = now;
        fakes = Array.from(text, standIn);
      }
      setState({ pos, fakes });
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, ms, reduced, n]);

  const revealed = Math.max(0, state.pos - WAVE);
  if (revealed >= n) return <>{text}</>;
  const chars = Array.from(text);
  return (
    <span className="scr" aria-label={text}>
      <span aria-hidden>{chars.slice(0, revealed).join("")}</span>
      {chars.slice(revealed).map((c, j) => {
        const i = revealed + j;
        if (c === " ") return " ";
        if (i < state.pos)
          return (
            <span key={i} className="scr-c" aria-hidden>
              <span className="scr-real">{c}</span>
              <span className="scr-fake">{state.fakes[i] ?? c}</span>
            </span>
          );
        return (
          <span key={i} className="scr-wait" aria-hidden>
            {c}
          </span>
        );
      })}
    </span>
  );
}

/* ---------------------------------------------------------------- clock */

/** The real current time in UTC, ticking every second. */
export function UtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <>{now.toISOString().slice(11, 19)}</>;
}
