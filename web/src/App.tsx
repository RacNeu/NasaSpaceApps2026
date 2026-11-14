import { useCallback, useEffect, useState } from "react";
import type { Dataset, Extras } from "./types";
import { loadAll, type FileKey } from "./data";
import { Intro } from "./Intro";
import { audio } from "./audio";
import { useAudioOn, useReducedMotion } from "./hooks";
import { dateAt, fmtDate } from "./lib";
import { useMission, type ViewId } from "./mission";
import { Satellites } from "./components/Satellites";
import { Detection } from "./components/Detection";
import { Harmonization } from "./components/Harmonization";
import { Overview } from "./views/Overview";
import { Record } from "./views/Record";
import { Insights } from "./views/Insights";
import { Method } from "./views/Method";
import { Live } from "./views/Live";
import { Scramble, UtcClock } from "./fx";

interface ViewDef {
  id: ViewId;
  label: string;
  title: string;
  icon: string; // SVG path data, 24x24, stroked
  regions: boolean; // whether the region selector applies
}

const VIEWS: ViewDef[] = [
  { id: "overview", label: "Globe", title: "Fire watch", regions: true, icon: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" },
  { id: "live", label: "Live", title: "Live: this week", regions: false, icon: "M12 10.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" },
  { id: "record", label: "Record", title: "25-year record", regions: true, icon: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2" },
  { id: "satellites", label: "Orbit", title: "The satellites", regions: false, icon: "M9.5 14.5l5-5M7 12l-3 3 5 5 3-3M12 7l3-3 5 5-3 3M5 5l2 2M17 17l2 2" },
  { id: "detection", label: "Detect", title: "Detection", regions: false, icon: "M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" },
  { id: "harmonize", label: "Match", title: "Harmonization", regions: false, icon: "M9 5a5 5 0 1 0 0 10A5 5 0 0 0 9 5zM15 9a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" },
  { id: "insights", label: "Insights", title: "Mission briefing", regions: false, icon: "M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-7M20 16v-3" },
  { id: "method", label: "Method", title: "Method and validation", regions: true, icon: "M5 12l4 4 10-10M4 4h16v16H4z" },
];

const fromHash = (): ViewId => {
  const h = window.location.hash.replace("#", "");
  return (VIEWS.find((v) => v.id === h)?.id ?? "overview") as ViewId;
};

function Console({ data, extras }: { data: Dataset; extras: Extras }) {
  const m = useMission(data, extras);
  const reduced = useReducedMotion();
  const soundOn = useAudioOn();
  const [viewId, setViewId] = useState<ViewId>(fromHash);
  const def = VIEWS.find((v) => v.id === viewId)!;

  const go = useCallback((v: ViewId) => {
    setViewId((cur) => {
      if (cur !== v) {
        audio.sweep();
        window.history.pushState(null, "", `#${v}`);
      }
      return v;
    });
  }, []);

  useEffect(() => {
    const on = () => setViewId(fromHash());
    window.addEventListener("popstate", on);
    window.addEventListener("hashchange", on);
    return () => {
      window.removeEventListener("popstate", on);
      window.removeEventListener("hashchange", on);
    };
  }, []);

  // arrow keys step through time on the views that show a date
  useEffect(() => {
    if (viewId !== "overview" && viewId !== "record") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") m.step(e.shiftKey ? 7 : 1);
      if (e.key === "ArrowLeft") m.step(e.shiftKey ? -7 : -1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [viewId, m.step]);

  return (
    <div className="console">
      <nav className="nav" aria-label="Views">
        <div className="nav-logo" aria-hidden>
          <svg viewBox="0 0 24 24" width="22" height="22">
            <path d="M12 2c1 3.5 5 5.5 5 10.2A5 5 0 0 1 12 17a5 5 0 0 1-5-4.8c0-2 1-3.2 2-4.4.3 1.6 1.2 2.4 2 2.7C11.6 8 11 5 12 2z" fill="currentColor" />
            <path d="M7 20.5h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </div>
        <div className="nav-items">
          {VIEWS.map((v) => (
            <button key={v.id} className={`nav-btn ${viewId === v.id ? "on" : ""} ${v.id === "live" ? "live-btn" : ""}`} onClick={() => go(v.id)} aria-current={viewId === v.id} title={v.title}>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d={v.icon} />
              </svg>
              <span className="mono">{v.label}</span>
            </button>
          ))}
        </div>
        <button className={`nav-btn sound ${soundOn ? "live" : ""}`} onClick={() => audio.toggle()} aria-pressed={soundOn} title={soundOn ? "Sound on. Click to mute." : "Sound off. Click to enable."}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {soundOn ? <path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0" /> : <path d="M2 12h20M5 5l14 14" />}
          </svg>
          <span className="mono">{soundOn ? "Sound" : "Muted"}</span>
        </button>
      </nav>

      <div className="main">
        <header className="topbar">
          <div className="tb-title">
            <span className="mono tb-brand">IGNIS</span>
            <span className="tb-sep" />
            <h1>
              <Scramble text={def.title} />
            </h1>
          </div>
          {def.regions && (
            <div className="tb-regions" role="group" aria-label="Region">
              {m.view.meta.regions.map((r) => (
                <button key={r.id} className={`tb-pill ${m.regionId === r.id ? "on" : ""}`} onClick={() => m.setRegionId(r.id)}>
                  <i style={{ background: r.color }} />
                  {r.id === "study_area" ? "All regions" : r.name}
                </button>
              ))}
            </div>
          )}
          <div className="tb-right mono">
            <div>
              <span>UTC</span>
              <UtcClock />
            </div>
            {viewId === "live" ? (
              <>
                <div>
                  <span>FEED</span>
                  <i className="rec" /> FIRMS NEAR-REAL-TIME
                </div>
                <div>
                  <span>COMPARED WITH</span>
                  {data.meta.start.slice(0, 4)}–{data.meta.end.slice(0, 4)} RECORD
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>SELECTED</span>
                  {fmtDate(dateAt(data.meta.start, m.t)).toUpperCase()}
                </div>
                <div>
                  <span>RECORD</span>
                  <i className="live-dot" />
                  {data.meta.start.slice(0, 4)}–{data.meta.end.slice(0, 4)} · ARCHIVE
                </div>
              </>
            )}
          </div>
        </header>

        <div className="stage">
          <div className={`view v-${viewId}`} key={viewId}>
            {viewId === "overview" && <Overview m={m} go={go} />}
            {viewId === "live" && <Live m={m} go={go} />}
            {viewId === "record" && <Record m={m} />}
            {viewId === "satellites" && <Satellites data={data} />}
            {viewId === "detection" && <Detection demos={extras.demos} />}
            {viewId === "harmonize" && <Harmonization demos={extras.demos} matching={extras.matching} />}
            {viewId === "insights" && <Insights m={m} go={go} />}
            {viewId === "method" && <Method m={m} />}
          </div>
          {!reduced && (
            <div className="wipe" key={`w-${viewId}`} aria-hidden>
              <i />
              <span className="mono">› {def.title.toUpperCase()}</span>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

export default function App() {
  const reduced = useReducedMotion();
  const [loaded, setLoaded] = useState<Set<FileKey>>(() => new Set());
  const [bundle, setBundle] = useState<{ data: Dataset; extras: Extras } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    loadAll((key) => setLoaded((prev) => new Set(prev).add(key)))
      .then(setBundle)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  return (
    <>
      {bundle && revealed && <Console data={bundle.data} extras={bundle.extras} />}
      {!introDone && (
        <Intro
          loaded={loaded}
          ready={!!bundle}
          error={error}
          reduced={reduced}
          onReveal={() => setRevealed(true)}
          onDone={() => setIntroDone(true)}
        />
      )}
    </>
  );
}
