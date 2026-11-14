import type { Headline } from "../world";
import { Scramble } from "../fx";
import "../wire.css";

interface Props {
  headlines: Headline[];
  index: number;
  /** Seconds each headline stays up; drives the progress bar. */
  dwell: number;
  tour: boolean;
  worldOn: boolean;
  status: "loading" | "error" | "ready";
  updated: string | null;
  onPick: (i: number) => void;
  onTour: (on: boolean) => void;
  onOpenSector?: (id: string) => void;
}

/** A breaking-news strip fed by the live planet-wide feed; each item flies the globe to its place. */
export function FireWire({ headlines, index, dwell, tour, worldOn, status, updated, onPick, onTour, onOpenSector }: Props) {
  const h = headlines[index];
  const n = headlines.length;
  return (
    <div className={`wire glass ${worldOn ? "world" : ""}`} role="region" aria-label="Fire Wire: live headlines">
      <div className="wire-tag">
        <span className="wire-brand mono">
          <i className="rec" /> FIRE WIRE
        </span>
        <span className="wire-live mono">{status === "ready" ? `LIVE · ${updated ?? ""}` : status === "loading" ? "CONNECTING" : "OFFLINE"}</span>
      </div>

      {status !== "ready" || !h ? (
        <div className="wire-body">
          <div className="wire-kicker mono">{status === "loading" ? "SCANNING THE PLANET" : "LIVE FEED UNAVAILABLE"}</div>
          <div className="wire-title dim">
            {status === "loading" ? "Pulling the last 48 hours of VIIRS detections for the whole Earth…" : "The archive below still works. Try again in a few minutes."}
          </div>
        </div>
      ) : (
        <button className="wire-body" onClick={() => onPick(index)} title="Fly there">
          <div className={`wire-kicker mono ${h.tone}`} key={`k-${h.id}`}>
            {h.kicker}
          </div>
          <div className="wire-title" key={`t-${h.id}`}>
            <Scramble text={h.title} ms={650} />
          </div>
          <div className="wire-sub" key={`s-${h.id}`}>
            {h.sub}
          </div>
        </button>
      )}

      <div className="wire-ctl">
        {status === "ready" && n > 0 && (
          <>
            <div className="wire-nav">
              <button aria-label="Previous headline" onClick={() => onPick((index - 1 + n) % n)}>
                ‹
              </button>
              <span className="mono">
                {String(index + 1).padStart(2, "0")}/{String(n).padStart(2, "0")}
              </span>
              <button aria-label="Next headline" onClick={() => onPick((index + 1) % n)}>
                ›
              </button>
            </div>
            <button className={`wire-tour mono ${tour ? "on" : ""}`} onClick={() => onTour(!tour)} aria-pressed={tour}>
              {tour ? "❚❚ TOUR ON" : "▶ AUTO TOUR"}
            </button>
            {h?.sectorId && worldOn && onOpenSector && (
              <button className="wire-open mono" onClick={() => onOpenSector(h.sectorId!)}>
                OPEN 25-YR ARCHIVE →
              </button>
            )}
          </>
        )}
      </div>
      {status === "ready" && <div className="wire-progress" key={`p-${index}-${tour}`} style={{ animationDuration: `${dwell}s` }} />}
    </div>
  );
}
