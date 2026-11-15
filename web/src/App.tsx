import { useCallback, useEffect, useState } from "react";
import type { Dataset, Extras } from "./types";
import { loadAll, loadSector, type FileKey, type SectorEntry } from "./data";
import { SectorPicker } from "./components/SectorPicker";
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
import { Forecast } from "./views/Forecast";
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
  { id: "detection", label: "Pixels", title: "Step 1 · Why the counts differ", regions: false, icon: "M12 3v4M12 17v4M3 12h4M17 12h4M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z" },
  { id: "harmonize", label: "Verify", title: "Step 2 · Do the sensors agree?", regions: false, icon: "M9 5a5 5 0 1 0 0 10A5 5 0 0 0 9 5zM15 9a5 5 0 1 0 0 10 5 5 0 0 0 0-10z" },
  { id: "forecast", label: "Forecast", title: "Fire outlook", regions: true, icon: "M3 17l5-5 4 3 4-6 5 4M15 5h6v6M3 21h18" },
  { id: "method", label: "Method", title: "Method and validation", regions: true, icon: "M5 12l4 4 10-10M4 4h16v16H4z" },
];

const fromHash = (): ViewId => {
  const h = window.location.hash.replace("#", "");
  return (VIEWS.find((v) => v.id === h)?.id ?? "overview") as ViewId;
};

interface SectorCtx {
  sectors: SectorEntry[];
  sector: SectorEntry;
  loading: string | null;
  onPick: (s: SectorEntry) => void;
}

/** Shown on the views that only exist for the detailed sector. */
function DetailedOnly({ ctx, what }: { ctx: SectorCtx; what: string }) {
  const sea = ctx.sectors.find((x) => x.detailed);
  return (
    <div className="view-pad">
      <div className="detailed-only glass">
        <div className="scene-code mono">AVAILABLE IN THE DETAILED SECTOR</div>
        <h2>{what}</h2>
        <p className="lede">
          This analysis matches individual MODIS and VIIRS detections and draws them at true pixel size on real satellite imagery. It has been run
          for Southeast Asia so far. Every other view works for {ctx.sector.name}.
        </p>
        {sea && (
          <button className="btn-primary" onClick={() => ctx.onPick(sea)}>
            Switch to {sea.short}
          </button>
        )}
      </div>
    </div>
  );
}

function Console({ data, extras, ctx }: { data: Dataset; extras: Extras; ctx: SectorCtx }) {
  const m = useMission(data, extras);
  const reduced = useReducedMotion();
  const soundOn = useAudioOn();
  const [viewId, setViewId] = useState<ViewId>(fromHash);
  const def = VIEWS.find((v) => v.id === viewId)!;

  const go = useCallback((v: ViewId) => {
    setViewId((cur) => {
      if (cur !== v) {
        audio.sweep();
        audio.decode();
        window.history.pushState(null, "", `#${v}`);
      }
      return v;
    });
  }, []);

  useEffect(() => {
    const on = () => {
      audio.decode();
      setViewId(fromHash());
    };
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
          <SectorPicker sectors={ctx.sectors} current={ctx.sector} loading={ctx.loading} onPick={ctx.onPick} />
          {def.regions && m.view.meta.regions.filter((r) => r.id !== "study_area").length > 1 && (
            <div className="tb-regions" role="group" aria-label="Region">
              {/* on the globe the regions live in the left column; the bar keeps "All regions" and the one selected */}
              {(viewId === "overview" ? [...m.view.meta.regions].sort((a, b) => (a.id === "study_area" ? -1 : b.id === "study_area" ? 1 : 0)) : m.view.meta.regions).filter((r) => viewId !== "overview" || r.id === "study_area" || r.id === m.regionId).map((r) => (
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
            {viewId === "overview" && (
              <Overview
                m={m}
                go={go}
                nav={{
                  sectors: ctx.sectors,
                  current: ctx.sector.id,
                  path: ctx.sector.path,
                  onOpen: (id) => {
                    const s = ctx.sectors.find((x) => x.id === id);
                    if (s && s.id !== ctx.sector.id) ctx.onPick(s);
                  },
                }}
              />
            )}
            {viewId === "live" && <Live m={m} go={go} />}
            {viewId === "record" && <Record m={m} />}
            {viewId === "satellites" && (
              <Satellites
                data={data}
                nav={{
                  sectors: ctx.sectors,
                  current: ctx.sector.id,
                  onOpen: (s) => {
                    go("overview");
                    if (s.id !== ctx.sector.id) ctx.onPick(s);
                  },
                }}
              />
            )}
            {viewId === "detection" && (ctx.sector.detailed ? <Detection demos={extras.demos} ratio={data.meta.calibration.study_area?.raw_viirs_to_modis_ratio ?? undefined} /> : <DetailedOnly ctx={ctx} what="Detection, pixel by pixel" />)}
            {viewId === "harmonize" && (ctx.sector.detailed ? <Harmonization demos={extras.demos} matching={extras.matching} /> : <DetailedOnly ctx={ctx} what="Detection-level matching" />)}
            {viewId === "forecast" && <Forecast m={m} go={go} path={ctx.sector.path} />}
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

      {ctx.loading && (
        <div className="warp" aria-live="polite">
          <div className="boot-radar" aria-hidden>
            <i />
            <i />
            <i />
            <b />
          </div>
          <div className="mono warp-t">ACQUIRING SECTOR · {ctx.loading.toUpperCase()}</div>
        </div>
      )}
    </div>
  );
}

const sectorFromUrl = () => new URLSearchParams(window.location.search).get("sector") ?? "sea";

export default function App() {
  const reduced = useReducedMotion();
  const [loaded, setLoaded] = useState<Set<FileKey>>(() => new Set());
  const [boot, setBoot] = useState<{ extras: Extras; sectors: SectorEntry[] } | null>(null);
  const [bundles, setBundles] = useState<Record<string, Dataset>>({});
  const [sectorId, setSectorId] = useState(sectorFromUrl);
  const [loadingSector, setLoadingSector] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    loadAll((key) => setLoaded((prev) => new Set(prev).add(key)))
      .then(({ data, extras, sectors }) => {
        setBundles({ sea: data });
        setBoot({ extras, sectors });
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const pick = useCallback(
    async (s: SectorEntry) => {
      const setUrl = () => {
        const u = new URL(window.location.href);
        if (s.id === "sea") u.searchParams.delete("sector");
        else u.searchParams.set("sector", s.id);
        window.history.replaceState(null, "", u.toString());
      };
      if (bundles[s.id]) {
        setSectorId(s.id);
        setUrl();
        audio.sweep();
        return;
      }
      setLoadingSector(s.short);
      try {
        const d = await loadSector(s);
        setBundles((b) => ({ ...b, [s.id]: d }));
        setSectorId(s.id);
        setUrl();
        audio.sweep();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingSector(null);
      }
    },
    [bundles],
  );

  // a shared link may point straight at another sector
  useEffect(() => {
    if (!boot || bundles[sectorId]) return;
    const s = boot.sectors.find((x) => x.id === sectorId);
    if (s) pick(s);
    else setSectorId("sea");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boot]);

  const sector = boot?.sectors.find((x) => x.id === sectorId) ?? boot?.sectors[0];
  const data = bundles[sectorId] ?? bundles.sea;
  const shown = sector && bundles[sectorId] ? sector : boot?.sectors.find((x) => x.id === "sea") ?? sector;

  return (
    <>
      {boot && data && shown && revealed && (
        <Console
          key={shown.id}
          data={data}
          extras={boot.extras}
          ctx={{ sectors: boot.sectors, sector: shown, loading: loadingSector, onPick: pick }}
        />
      )}
      {!introDone && (
        <Intro
          loaded={loaded}
          ready={!!boot}
          error={error}
          reduced={reduced}
          onReveal={() => setRevealed(true)}
          onDone={() => setIntroDone(true)}
        />
      )}
    </>
  );
}
