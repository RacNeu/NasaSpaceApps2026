import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { audio } from "./audio";

export const useReducedMotion = () => {
  const [r, setR] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setR(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return r;
};

/** True once the element has come within `margin` of the viewport (stays true afterwards). */
export function useSeen<T extends HTMLElement>(margin = "300px") {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin: margin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [seen, margin]);
  return [ref, seen] as const;
}

/** True while the element is on screen. */
export function useVisible<T extends HTMLElement>(threshold = 0.2) {
  const ref = useRef<T>(null);
  const [vis, setVis] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => setVis(es.some((e) => e.isIntersecting)), { threshold });
    io.observe(el);
    return () => io.disconnect();
  }, [threshold]);
  return [ref, vis] as const;
}

/**
 * Calls `cb(p)` every animation frame while the section scrolls, p in 0..1 across the section's
 * scrollable distance. Does not re-render React.
 */
export function useScrollProgress(ref: React.RefObject<HTMLElement>, cb: (p: number) => void, enabled = true) {
  const saved = useRef(cb);
  saved.current = cb;
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    let last = -1;
    const tick = () => {
      const el = ref.current;
      if (el) {
        const r = el.getBoundingClientRect();
        const total = r.height - window.innerHeight;
        const p = total > 0 ? Math.min(1, Math.max(0, -r.top / total)) : 0;
        if (Math.abs(p - last) > 0.0004) {
          last = p;
          saved.current(p);
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ref, enabled]);
}

export const useAudioOn = () =>
  useSyncExternalStore(
    (fn) => audio.subscribe(fn),
    () => audio.on,
  );

export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
