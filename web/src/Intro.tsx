import { useEffect, useState } from "react";
import { DATA_FILES, type FileKey } from "./data";
import { Scramble } from "./fx";

const SEEN_KEY = "ignis-intro-seen";

interface Props {
  /** Files that have actually arrived so far. */
  loaded: Set<FileKey>;
  /** All data is parsed and the console can be shown. */
  ready: boolean;
  error: string | null;
  /** Called when the exit animation starts, so the console can mount underneath. */
  onReveal: () => void;
  /** Called when the intro has fully faded out. */
  onDone: () => void;
  reduced: boolean;
}

/**
 * The entry sequence, which doubles as the loading screen. A rotating Earth (NASA Blue Marble with
 * VIIRS Black Marble city lights on the night side) is circled by a MODIS and a VIIRS orbit while
 * the real data files arrive. Once everything is in, the Earth rushes toward the camera and the
 * console takes over. First visits get the full sequence, return visits a short one.
 */
export function Intro({ loaded, ready, error, onReveal, onDone, reduced }: Props) {
  const [firstVisit] = useState(() => !sessionStorage.getItem(SEEN_KEY));
  // first visits open with the original power-on screen, then hand over to the Earth
  const [stage, setStage] = useState<"boot" | "main">(() => (firstVisit && !reduced ? "boot" : "main"));
  const minMs = reduced ? 0 : firstVisit ? 4600 : 900;
  const [minDone, setMinDone] = useState(minMs === 0);
  const [phase, setPhase] = useState<"loading" | "exit">("loading");

  useEffect(() => {
    if (minMs === 0) return;
    const id = setTimeout(() => setMinDone(true), minMs);
    return () => clearTimeout(id);
  }, [minMs]);

  useEffect(() => {
    if (stage !== "boot") return;
    const id = setTimeout(() => setStage("main"), 1700);
    return () => clearTimeout(id);
  }, [stage]);

  const exit = () => {
    if (phase === "exit") return;
    sessionStorage.setItem(SEEN_KEY, "1");
    setPhase("exit");
    onReveal();
    setTimeout(onDone, reduced ? 0 : 900);
  };

  // leave as soon as the data is in and the minimum sequence has played
  // (in development, ?hold keeps the intro on screen for inspection)
  useEffect(() => {
    if (import.meta.env.DEV && window.location.search.includes("hold")) return;
    if (ready && minDone && !error) exit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, minDone, error]);

  const pct = Math.round((100 * loaded.size) / DATA_FILES.length);

  return (
    <div
      className={`intro ${phase} ${firstVisit ? "full" : "short"} ${reduced ? "still" : ""}`}
      onClick={() => ready && !error && exit()}
      role="status"
      aria-live="polite"
      aria-label={ready ? "Loaded" : `Loading mission data, ${pct} percent`}
    >
      <div className="intro-stars" aria-hidden />

      {stage === "boot" && (
        <div className="boot intro-boot" aria-hidden>
          <div className="boot-radar">
            <i />
            <i />
            <i />
            <b />
          </div>
          <div className="boot-title">IGNIS</div>
          <div className="boot-lines mono">
            <span>FIRE WATCH CONSOLE · MODIS × VIIRS HARMONIZATION</span>
            <span>LINKING TERRA · AQUA · SUOMI NPP · NOAA-20</span>
            <span>OPENING THE 2001–2026 ARCHIVE</span>
          </div>
        </div>
      )}

      {stage === "main" && (
        <>
      <div className="intro-stage" aria-hidden>
        <div className="boot-radar intro-radar">
          <i />
          <i />
          <i />
        </div>
        <svg className="intro-orbits" viewBox="-200 -200 400 400">
          <ellipse className="orbit modis" rx="170" ry="52" transform="rotate(-18)" pathLength={1} />
          <ellipse className="orbit viirs" rx="186" ry="66" transform="rotate(14)" pathLength={1} />
          <g transform="rotate(-18)">
            <circle r="3.4" className="sat modis">
              <animateMotion dur="5.5s" repeatCount="indefinite" path="M170,0 A170,52 0 1,1 -170,0 A170,52 0 1,1 170,0" />
            </circle>
          </g>
          <g transform="rotate(14)">
            <circle r="3.4" className="sat viirs">
              <animateMotion dur="6.6s" begin="-2s" repeatCount="indefinite" path="M-186,0 A186,66 0 1,1 186,0 A186,66 0 1,1 -186,0" />
            </circle>
          </g>
        </svg>
        <div className="intro-earth">
          <div className="day" />
          <div className="night" />
          <div className="shade" />
          <div className="sweep" />
        </div>
        <div className="intro-atmo" />
      </div>

      <div className="intro-text">
        <div className="intro-title">
          <Scramble text="IGNIS" ms={firstVisit ? 1100 : 400} />
        </div>
        <div className="intro-sub mono">FIRE WATCH CONSOLE · MODIS × VIIRS HOTSPOT HARMONIZATION</div>

        <ul className="intro-log mono">
          {DATA_FILES.map((f, i) => (
            <li key={f.key} className={loaded.has(f.key) ? "ok" : ""} style={{ animationDelay: `${firstVisit ? 0.5 + i * 0.18 : 0.1}s` }}>
              <span>{f.label}</span>
              <b>{loaded.has(f.key) ? "OK" : "···"}</b>
            </li>
          ))}
        </ul>

        <div className="intro-bar" aria-hidden>
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="intro-status mono">
          {error ? (
            <span className="err">COULD NOT LOAD THE MISSION DATA · {error}</span>
          ) : ready ? (
            <span className="ok">SIGNAL ACQUIRED{minDone ? "" : " · CLICK TO ENTER"}</span>
          ) : (
            <span>ACQUIRING SIGNAL · {pct}%</span>
          )}
        </div>
      </div>

        </>
      )}

      <div className="intro-flash" aria-hidden />
    </div>
  );
}
