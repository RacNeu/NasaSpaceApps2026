import { useEffect, useMemo, useRef, useState } from "react";
import type { SectorEntry } from "../data";
import { audio } from "../audio";

interface Props {
  sectors: SectorEntry[];
  current: SectorEntry;
  loading: string | null;
  onPick: (s: SectorEntry) => void;
}

/** The location box in the top bar: shows the current sector and opens a searchable list. */
export function SectorPicker({ sectors, current, loading, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const hit = (s: SectorEntry) =>
      !needle || [s.name, s.short, s.group, ...(s.countries ?? [])].some((t) => t.toLowerCase().includes(needle));
    const out = new Map<string, SectorEntry[]>();
    for (const s of sectors.filter(hit)) out.set(s.group, [...(out.get(s.group) ?? []), s]);
    return [...out.entries()];
  }, [sectors, q]);

  if (sectors.length < 2) return null;

  return (
    <div className="sector" ref={box}>
      <button
        className={`sector-btn ${open ? "on" : ""}`}
        onClick={() => {
          setOpen((o) => !o);
          audio.ping(700);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
          <circle cx="12" cy="12" r="8" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
        </svg>
        <span className="mono sector-k">SECTOR</span>
        <span className="sector-name">{loading ? "Acquiring…" : current.short}</span>
        <span className="sector-caret" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="sector-panel glass" role="listbox" aria-label="Choose a sector">
          <input ref={input} className="sector-search" placeholder="Search a country or region…" value={q} onChange={(e) => setQ(e.target.value)} />
          {groups.length === 0 && <div className="sector-empty mono">NO MATCH</div>}
          {groups.map(([g, list]) => (
            <div key={g} className="sector-group">
              <div className="mono sector-g">{g.toUpperCase()}</div>
              {list.map((s) => (
                <button
                  key={s.id}
                  role="option"
                  aria-selected={s.id === current.id}
                  className={`sector-opt ${s.id === current.id ? "on" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    setQ("");
                    if (s.id !== current.id) onPick(s);
                  }}
                >
                  <span className="so-head">
                    <b>{s.name}</b>
                    {s.detailed && <span className="mono so-tag">DETAILED</span>}
                    {s.id === current.id && <span className="mono so-tag cur">ACTIVE</span>}
                  </span>
                  <span className="so-story">{s.story}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="sector-foot mono">EVERY SECTOR · SAME METHOD · 2001–2025</div>
        </div>
      )}
    </div>
  );
}
