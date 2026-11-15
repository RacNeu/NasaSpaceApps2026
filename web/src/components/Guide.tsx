import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ViewId } from "../mission";
import { audio } from "../audio";
import "../guide.css";

/**
 * A guided tour of the whole console. Each step opens the right page, scrolls the feature into
 * view, dims everything around it and explains what it shows and how to use it.
 */
interface Step {
  view: ViewId;
  /** CSS selector of the feature to spotlight; the card is centred when there is none. */
  sel?: string;
  kicker: string;
  title: string;
  body: string;
  tip?: string;
}

const STEPS: Step[] = [
  {
    view: "overview",
    kicker: "WELCOME",
    title: "Mission Ignis: one fire record from two generations of satellites",
    body:
      "NASA's MODIS satellites have counted fires since 2000; the newer VIIRS satellites see smaller fires at 375 m and count several times more. Mission Ignis harmonizes the two into one consistent record from 2001 to today, so any week can be compared with 25 years of history and the coming months can be forecast. This tour visits every feature.",
    tip: "Use Next and Back, or the arrow keys. Esc closes the tour at any time.",
  },
  {
    view: "overview",
    sel: ".sector-btn",
    kicker: "SECTOR",
    title: "Choose where on Earth",
    body:
      "Eight sectors, all built with the same method: Southeast Asia (the detailed default), Mainland Southeast Asia, India, Central Africa, Australia, Brazil, the United States and Canada. Search by country or region; the whole console switches to the sector you pick.",
  },
  {
    view: "overview",
    sel: ".region-boxes",
    kicker: "REGIONS",
    title: "Regions inside each sector",
    body:
      "Each sector is split into regions: countries, or groups of states such as the US West Coast or India's North. Each box shows detections per day this week and how that compares with normal. Click one to focus the whole console on it; click again for all regions. The arrow folds the panel away.",
  },
  {
    view: "overview",
    sel: ".kpis",
    kicker: "THE NUMBERS",
    title: "This week at a glance",
    body:
      "Detections per day (7-day average, on the VIIRS scale), how many times the normal level that is for this time of year, its percentile against every other year, and the typical value. Below, the donut shows where the burning is, and the year chart shows this year against the dashed normal.",
  },
  {
    view: "overview",
    sel: ".ov-map",
    kicker: "THE GLOBE",
    title: "Fire activity on a 3D globe",
    body:
      "Each column is one grid cell: its height and colour show how many fires were detected that week. Drag to rotate, scroll to zoom, hover a column for its count. Numbered markers point to the three busiest places of the week.",
  },
  {
    view: "overview",
    sel: ".ov-tools",
    kicker: "GLOBE CONTROLS",
    title: "Archive, Live Earth and map styles",
    body:
      "Archive shows the harmonized record for the selected week. Live Earth swaps to every fire detected on the planet in the last two days. 3D, Heat and Grid change how fire is drawn. Select area lets you drag a rectangle to get the record for any area you choose.",
  },
  {
    view: "overview",
    sel: ".borders-row",
    kicker: "BORDERS",
    title: "Select a country or province",
    body:
      "Turn on country or province (state) borders. Hover to see a name, click to select it: every view then shows that place, from its burning calendar to the CSV download. Click again or press ✕ to clear.",
  },
  {
    view: "overview",
    sel: ".ov-bottom",
    kicker: "TIMELINE",
    title: "Travel through 25 years",
    body:
      "The bars are fire activity in every month since 2001. Drag the slider to any week, or press play to watch the seasons go by. The biggest episodes are listed on the right: click one to jump straight to it.",
  },
  {
    view: "overview",
    sel: ".wire, .wire-pill",
    kicker: "FIRE WIRE",
    title: "Live headlines from the whole planet",
    body:
      "A news strip fed by NASA's near-real-time feed: the most active countries right now, the most intense fire cluster, and each sector's count. Click a headline to fly the globe there, or press Auto tour to visit them one by one. The ✕ hides it; the small tab brings it back.",
  },
  {
    view: "live",
    sel: ".ov-map",
    kicker: "LIVE",
    title: "This week, against 25 years",
    body:
      "The last seven days of fire detections for the sector, straight from NASA FIRMS. The newest fires glow brightest. Each region gets an early-warning level by ranking this week against every comparable week since 2001.",
  },
  {
    view: "record",
    sel: ".card",
    kicker: "RECORD",
    title: "The burning calendar",
    body:
      "One row per year, one cell per week, all on the same harmonized scale. Colour shows how unusual each week was for its time of year, so a haze year or a record season stands out at a glance. Click any cell to move the whole console to that date.",
  },
  {
    view: "satellites",
    kicker: "ORBIT",
    title: "The satellites behind the record",
    body:
      "The five satellites on their real orbits: MODIS on Terra and Aqua (1 km pixels), and VIIRS on Suomi NPP, NOAA-20 and NOAA-21 (375 m). Day and night follow the real sun right now; the strip under the selected satellite is the ground it images, at true width. Click a satellite to read about it, or a sector beacon to open that sector.",
  },
  {
    view: "detection",
    kicker: "PIXELS · STEP 1 OF 2",
    title: "Why the two sensors count differently",
    body:
      "One real day drawn at each sensor's true pixel size over the real satellite photo, and a pixel lab: one 1 km MODIS pixel split into 375 m VIIRS pixels. Try the scenarios, or place your own fires, to see why VIIRS reports more hotspots. This is the problem the harmonization solves. (Southeast Asia only.)",
  },
  {
    view: "harmonize",
    kicker: "VERIFY · STEP 2 OF 2",
    title: "Do the sensors see the same fires?",
    body:
      "Individual MODIS and VIIRS detections are paired when they fall within a set distance and time of each other. Move the sliders and watch the match rate change. This is the evidence that the two records describe the same fires. (Southeast Asia only.)",
  },
  {
    view: "forecast",
    sel: "#fc-outlook",
    kicker: "FORECAST",
    title: "The next 26 weeks",
    body:
      "The last six months observed, then the forecast with its 80% range, the normal and the critical level. The strip gives each week's chance of being above normal. The forecast uses recent fire activity, the El Niño index and rainfall, and is tested on years it never saw. The buttons at the top jump between sections.",
  },
  {
    view: "forecast",
    sel: "#fc-map",
    kicker: "PREDICTED BURNING",
    title: "Where fire is expected",
    body:
      "The forecast drawn on a globe for the next 4 weeks, weeks 5 to 8 or 9 to 13. Height is the expected fire; colour is how that compares with normal. Places to watch lists the busiest spots: click one to fly there.",
  },
  {
    view: "forecast",
    sel: "#fc-burn",
    kicker: "BURN-WINDOW PLANNER",
    title: "When is it safer to burn?",
    body:
      "For farmers and land managers who burn on purpose. Every coming week is rated lower risk, caution or avoid. Choose how long the burning takes and it finds the best window, which you can add to your calendar. A planning aid only: always check weather and local rules.",
  },
  {
    view: "forecast",
    sel: "#fc-season",
    kicker: "SEASON TIMING",
    title: "When the fire season starts and ends",
    body:
      "Every past season drawn around the usual peak, the usual start and end, and when the coming season is expected to start or end, with a range and whether that is earlier or later than usual.",
  },
  {
    view: "forecast",
    sel: "#fc-drought",
    kicker: "DROUGHT",
    title: "How dry it has been",
    body:
      "Rain over the last 30 and 90 days compared with normal, from NASA POWER, where the region usually burns. Dry spells make fires easier to start; the forecast uses this and shows how much it adds.",
  },
  {
    view: "forecast",
    sel: "#fc-haze, #fc-accuracy",
    kicker: "HAZE AND ACCURACY",
    title: "Haze outlook and how far to trust it",
    body:
      "For Southeast Asia, haze potential for Malaysia and Singapore combines forecast fires in Sumatra and Kalimantan with the wind that carries smoke there. Further down, a replay of past years and the forecast's measured skill show how far ahead it can be trusted.",
  },
  {
    view: "method",
    sel: ".dl-grid",
    kicker: "METHOD AND DOWNLOADS",
    title: "Take the data with you",
    body:
      "Download the harmonized fire record for any date range, daily or as monthly totals ranked against every year (CSV, opens in Excel), plus the calibration and matching data. Below are the validation, the method in six steps and its honest limits.",
  },
  {
    view: "overview",
    sel: ".guide-btn",
    kicker: "THAT'S THE TOUR",
    title: "You're ready",
    body:
      "Open this guide again from here at any time. The button below it turns the soundtrack on or off. Start by picking a sector and a week, or press Live to see what is burning right now.",
  },
];

const PAD = 8;

export function Guide({ go, onClose }: { go: (v: ViewId) => void; onClose: () => void }) {
  const [i, setI] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardPos, setCardPos] = useState<{ left: number; top: number } | null>(null);
  // the card only starts gliding once it has been placed the first time
  const [placed, setPlaced] = useState(false);
  useEffect(() => {
    if (cardPos && !placed) {
      const t = window.setTimeout(() => setPlaced(true), 60);
      return () => window.clearTimeout(t);
    }
  }, [cardPos, placed]);
  const step = STEPS[i];

  const find = useCallback(() => {
    if (!step.sel) return null;
    for (const s of step.sel.split(",")) {
      const el = document.querySelector<HTMLElement>(s.trim());
      if (el && el.getBoundingClientRect().width > 0) return el;
    }
    return null;
  }, [step]);

  // open the page, wait for the feature to appear, bring it into view and measure it
  useEffect(() => {
    go(step.view);
    // a step with no feature to point at: the spotlight closes to the centre
    if (!step.sel) setRect(null);
    let tries = 0;
    let timer = 0;
    const look = () => {
      const el = find();
      if (el) {
        // jump (not glide) so the measurement is of where it ends up; tall sections come in from the top
        el.scrollIntoView({ block: el.offsetHeight > window.innerHeight * 0.7 ? "start" : "center", behavior: "auto" });
        timer = window.setTimeout(() => setRect(find()?.getBoundingClientRect() ?? null), 120);
      } else if (step.sel && tries++ < 20) {
        timer = window.setTimeout(look, 150);
      } else if (step.sel) {
        setRect(null);
      }
    };
    timer = window.setTimeout(look, 250);
    return () => window.clearTimeout(timer);
  }, [i, go, find, step]);

  // follow the feature if the page scrolls or resizes
  useEffect(() => {
    const update = () => {
      const el = find();
      if (el) setRect(el.getBoundingClientRect());
    };
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, [find]);

  // place the card beside the spotlight, wherever there is room
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (!rect) {
      setCardPos({ left: (W - cw) / 2, top: (H - ch) / 2 });
      return;
    }
    // only the part of the feature that is on screen counts
    const vis = { left: Math.max(rect.left, 0), top: Math.max(rect.top, 0), right: Math.min(rect.right, W), bottom: Math.min(rect.bottom, H) };
    if (vis.bottom - vis.top > H * 0.6 && vis.right - vis.left > W * 0.6) {
      // a feature that fills the screen: the card sits in its lower right corner
      setCardPos({ left: W - cw - 24, top: H - ch - 24 });
      return;
    }
    const r = { ...vis, width: vis.right - vis.left, height: vis.bottom - vis.top };
    const gap = 16;
    const clampX = (x: number) => Math.max(12, Math.min(W - cw - 12, x));
    const clampY = (y: number) => Math.max(12, Math.min(H - ch - 12, y));
    let pos: { left: number; top: number };
    if (r.right + gap + cw < W - 12) pos = { left: r.right + gap, top: clampY(r.top) };
    else if (r.left - gap - cw > 12) pos = { left: r.left - gap - cw, top: clampY(r.top) };
    else if (r.bottom + gap + ch < H - 12) pos = { left: clampX(r.left), top: r.bottom + gap };
    else if (r.top - gap - ch > 12) pos = { left: clampX(r.left), top: r.top - gap - ch };
    else pos = { left: clampX(W - cw - 24), top: clampY(H - ch - 24) };
    setCardPos(pos);
  }, [rect, i]);

  const next = useCallback(() => {
    if (i >= STEPS.length - 1) onClose();
    else {
      setI(i + 1);
      audio.ping(700);
    }
  }, [i, onClose]);
  const back = useCallback(() => {
    if (i > 0) {
      setI(i - 1);
      audio.ping(560);
    }
  }, [i]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, onClose]);

  // the spotlight is clipped to the screen so its outline always shows
  // with nothing to point at, the spotlight shrinks to a point in the middle and the whole page dims
  const hole = rect
    ? (() => {
        const l = Math.max(rect.left - PAD, 4);
        const t = Math.max(rect.top - PAD, 4);
        const r = Math.min(rect.right + PAD, window.innerWidth - 4);
        const b = Math.min(rect.bottom + PAD, window.innerHeight - 4);
        return { left: l, top: t, width: Math.max(0, r - l), height: Math.max(0, b - t) };
      })()
    : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };

  return (
    <div className="guide" role="dialog" aria-modal="true" aria-label="Guided tour">
      <div className={`guide-hole ${rect ? "" : "empty"}`} style={hole} />
      <div className={`guide-card glass ${placed ? "placed" : ""}`} ref={cardRef} style={cardPos ?? { left: -9999, top: 0 }}>
        <div className="guide-body" key={i}>
        <div className="guide-top">
          <span className="mono guide-kicker">{step.kicker}</span>
          <span className="mono dim">
            {i + 1} / {STEPS.length}
          </span>
        </div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        {step.tip && <p className="guide-tip">{step.tip}</p>}
        </div>
        <div className="guide-progress">
          <i style={{ width: `${((i + 1) / STEPS.length) * 100}%` }} />
        </div>
        <div className="guide-actions">
          <button className="btn-ghost small" onClick={onClose}>
            Skip tour
          </button>
          <span />
          <button className="btn-ghost small" onClick={back} disabled={i === 0}>
            ← Back
          </button>
          <button className="btn-primary small" onClick={next}>
            {i === STEPS.length - 1 ? "Finish" : "Next →"}
          </button>
        </div>
      </div>
    </div>
  );
}
