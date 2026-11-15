import { useEffect, useMemo, useState } from "react";
import type { DemoDay } from "../types";
import { audio } from "../audio";
import { useNear } from "../hooks";
import { HotspotMap, type HotspotView, type Imagery } from "./HotspotMap";
import { hhmm } from "../match";
import { Scramble, Ticker } from "../fx";

/* ------------------------------------------------------------------ pixel lab */

const BIG = 270; // px for 1 km
const SMALL = BIG * 0.375; // px for 375 m
const COLS = Math.ceil(BIG / SMALL);

type Size = "small" | "medium" | "large";
interface Fire {
  x: number;
  y: number;
  size: Size;
}
/** How much heat each fire puts out, in arbitrary units, and how far it spreads. */
const HEAT: Record<Size, number> = { small: 1, medium: 2, large: 2 };
const SPREAD: Record<Size, number> = { small: 0, medium: 0, large: 46 };
/** A 1 km pixel needs more total heat to stand out than a 375 m one, because the fire fills less of it. */
const MODIS_THRESHOLD = 2;
const VIIRS_THRESHOLD = 1;

/** A large fire is a front of burning points; small and medium fires are one point. */
const heatPoints = (f: Fire) => {
  if (f.size !== "large") return [{ x: f.x, y: f.y, h: HEAT[f.size] }];
  const pts: { x: number; y: number; h: number }[] = [];
  for (let a = 0; a < 7; a++) {
    const t = (a / 6) * Math.PI * 1.6 - 0.3;
    pts.push({ x: f.x + Math.cos(t) * SPREAD.large, y: f.y + Math.sin(t) * SPREAD.large * 0.7, h: HEAT.large });
  }
  return pts.map((p) => ({ ...p, x: Math.max(4, Math.min(BIG - 4, p.x)), y: Math.max(4, Math.min(BIG - 4, p.y)) }));
};

const SCENARIOS: { id: string; label: string; fires: Fire[]; text: string }[] = [
  {
    id: "two",
    label: "Two fires, one pixel",
    fires: [
      { x: 52, y: 60, size: "medium" },
      { x: 205, y: 190, size: "medium" },
    ],
    text: "Both fires sit inside the same 1 km pixel, so MODIS can only say “this pixel is hot” once. VIIRS sees them in separate 375 m pixels and counts two.",
  },
  {
    id: "small",
    label: "A small fire",
    fires: [{ x: 140, y: 120, size: "small" }],
    text: "A small fire heats only a sliver of a 1 km pixel, often too little to cross MODIS's threshold. In a 375 m pixel the same fire is a much bigger share, so VIIRS flags it. In our matching, VIIRS's weakest detections were the ones Aqua most often missed.",
  },
  {
    id: "large",
    label: "A large fire",
    fires: [{ x: 135, y: 130, size: "large" }],
    text: "A large fire front spreads across several 375 m pixels, and VIIRS reports each one. MODIS reports its one pixel. Same fire, very different counts.",
  },
];

function PixelLab({ ratio }: { ratio?: number }) {
  const [scenario, setScenario] = useState("two");
  const [fires, setFires] = useState<Fire[]>(SCENARIOS[0].fires);
  const [brush, setBrush] = useState<Size>("medium");
  const active = SCENARIOS.find((s) => s.id === scenario);

  // heat per VIIRS cell and in the single MODIS pixel
  const cellHeat = new Map<string, number>();
  let modisHeat = 0;
  for (const f of fires) {
    for (const p of heatPoints(f)) {
      const k = `${Math.floor(p.x / SMALL)}-${Math.floor(p.y / SMALL)}`;
      cellHeat.set(k, (cellHeat.get(k) ?? 0) + p.h);
      modisHeat += p.h;
    }
  }
  const viirsHits = [...cellHeat.values()].filter((h) => h >= VIIRS_THRESHOLD).length;
  const modisHit = modisHeat >= MODIS_THRESHOLD ? 1 : 0;

  const pick = (id: string) => {
    const s = SCENARIOS.find((x) => x.id === id)!;
    setScenario(id);
    setFires(s.fires);
    audio.ping(760);
  };

  return (
    <div className="pixel-lab">
      <div className="pl-head">
        <div className="mono scene-code">WHY THE COUNTS DIFFER · ONE MODIS PIXEL, SEEN BY VIIRS</div>
        <p>
          The big square is one 1 km MODIS pixel; the small squares are the 375 m VIIRS pixels inside it. Pick a scenario, or click inside the square to
          place your own fires.
        </p>
        <div className="seg-row pl-scen" role="group" aria-label="Scenario">
          {SCENARIOS.map((s) => (
            <button key={s.id} className={`seg-btn ${scenario === s.id ? "on" : ""}`} onClick={() => pick(s.id)}>
              {s.label}
            </button>
          ))}
          <button className={`seg-btn ${scenario === "free" ? "on" : ""}`} onClick={() => { setScenario("free"); setFires([]); }}>
            Your own
          </button>
        </div>
      </div>
      <div className="pl-body">
        <svg
          width={BIG}
          height={BIG}
          viewBox={`0 0 ${BIG} ${BIG}`}
          className="pl-svg"
          role="img"
          aria-label={`A 1 kilometre MODIS pixel divided into 375 metre VIIRS pixels. MODIS reports ${modisHit}, VIIRS reports ${viirsHits}.`}
          onClick={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * BIG;
            const y = ((e.clientY - r.top) / r.height) * BIG;
            setScenario("free");
            setFires((f) => (f.length >= 8 ? [{ x, y, size: brush }] : [...f, { x, y, size: brush }]));
            audio.ping(660 + fires.length * 60);
          }}
        >
          <rect
            x="1"
            y="1"
            width={BIG - 2}
            height={BIG - 2}
            className={modisHit ? "pl-modis hit" : "pl-modis"}
            fill={modisHit ? "rgba(69,184,209,0.2)" : "rgba(69,184,209,0.04)"}
            stroke="#45B8D1"
            strokeWidth="2"
            strokeDasharray={modisHit ? "" : "6 5"}
          />
          {Array.from({ length: COLS }, (_, cx) =>
            Array.from({ length: COLS }, (_, cy) => {
              const hit = (cellHeat.get(`${cx}-${cy}`) ?? 0) >= VIIRS_THRESHOLD;
              return (
                <rect
                  key={`${cx}-${cy}`}
                  x={cx * SMALL}
                  y={cy * SMALL}
                  width={Math.min(SMALL, BIG - cx * SMALL)}
                  height={Math.min(SMALL, BIG - cy * SMALL)}
                  className={hit ? "pl-cell hit" : "pl-cell"}
                  fill={hit ? "rgba(255,157,67,0.5)" : "none"}
                  stroke="#FF9D43"
                  strokeOpacity={hit ? 1 : 0.4}
                  strokeDasharray={hit ? "" : "3 3"}
                />
              );
            }),
          )}
          {fires.map((f, i) =>
            f.size === "large" ? (
              <g key={i} className="pl-fire">
                {heatPoints(f).map((p, j) => (
                  <g key={j}>
                    <circle cx={p.x} cy={p.y} r="13" fill="#F05A42" opacity="0.3" />
                    <circle cx={p.x} cy={p.y} r="5" fill="#ffb27a" />
                  </g>
                ))}
              </g>
            ) : (
              <g key={i} className="pl-fire">
                <circle cx={f.x} cy={f.y} r={f.size === "small" ? 6 : 11} fill="#F05A42" opacity="0.35" />
                <circle cx={f.x} cy={f.y} r={f.size === "small" ? 2.5 : 4.5} fill="#ffb27a" />
              </g>
            ),
          )}
        </svg>
        <div className="pl-count">
          <div className="pl-stat modis">
            <div className="mono">MODIS REPORTS</div>
            <b>
              <Ticker text={String(modisHit)} ms={500} />
            </b>
            <span>{modisHit ? "hotspot" : "nothing: too faint for 1 km"}</span>
          </div>
          <div className="pl-stat viirs">
            <div className="mono">VIIRS REPORTS</div>
            <b>
              <Ticker text={String(viirsHits)} ms={500} />
            </b>
            <span>{viirsHits === 1 ? "hotspot" : "hotspots"}</span>
          </div>
          {scenario === "free" && (
            <div className="pl-brush" role="group" aria-label="Fire size">
              <span className="mono">NEXT FIRE</span>
              {(["small", "medium", "large"] as Size[]).map((s) => (
                <button key={s} className={`seg-btn ${brush === s ? "on" : ""}`} onClick={() => setBrush(s)}>
                  {s}
                </button>
              ))}
              <button className="btn-ghost small" onClick={() => setFires([])}>
                Clear
              </button>
            </div>
          )}
          <p className="pl-explain">{active ? active.text : "Mix small, medium and large fires and watch how the two counts drift apart."}</p>
          <p className="fineprint">
            Add this up over millions of fires and you get the gap in the record: VIIRS reports {ratio ? `${ratio.toFixed(1)}×` : "several times"} as many
            hotspots as MODIS in Southeast Asia. This is a simplified picture: real detection also depends on fire temperature, smoke, cloud and the
            viewing angle.
          </p>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ scene */

const IMAGERY: { id: Imagery; label: string }[] = [
  { id: "aqua", label: "Aqua true colour" },
  { id: "terra", label: "Terra true colour" },
  { id: "noaa20", label: "NOAA-20 true colour" },
  { id: "snpp", label: "Suomi NPP true colour" },
  { id: "none", label: "No imagery" },
];

export function Detection({ demos, ratio }: { demos: DemoDay[]; ratio?: number }) {
  const [ref, seen] = useNear<HTMLElement>("600px");
  const [di, setDi] = useState(0);
  const [imagery, setImagery] = useState<Imagery>("aqua");
  const [modis, setModis] = useState(true);
  const [viirs, setViirs] = useState(true);
  const [allDay, setAllDay] = useState(true);
  const [minute, setMinute] = useState(360);
  const [playing, setPlaying] = useState(false);
  const demo = demos[di];

  useEffect(() => {
    if (!playing) return;
    setAllDay(false);
    const id = setInterval(() => {
      setMinute((m) => {
        if (m >= 1439) {
          setPlaying(false);
          return 0;
        }
        return m + 10;
      });
    }, 70);
    return () => clearInterval(id);
  }, [playing]);

  const view: HotspotView = useMemo(
    () => ({ modis, viirs, terra: true, aqua: true, matchMode: false, window: allDay ? null : { center: minute, half: 45 } }),
    [modis, viirs, allDay, minute],
  );

  const counts = useMemo(() => {
    const inWin = (t: number) => allDay || Math.abs(t - minute) <= 45;
    const aqua = demo.modis.filter((p) => p[5] === 1 && inWin(p[2])).length;
    const terra = demo.modis.filter((p) => p[5] === 0 && inWin(p[2])).length;
    const v = demo.viirs.filter((p) => inWin(p[2])).length;
    return { aqua, terra, v };
  }, [demo, allDay, minute]);

  const centerLon = (demo.box[0] + demo.box[2]) / 2;
  const local = (minute + (centerLon / 15) * 60 + 1440) % 1440;

  return (
    <section id="detection" ref={ref} className="scene scene-detect">
      <div className="scene-inner wide">
        <div className="scene-copy">
          <div className="step-chip amber mono"><b>STEP 1 OF 2</b> THE PROBLEM</div>
          <div className="scene-code mono">PIXELS · ONE DAY, PIXEL BY PIXEL</div>
          <h2>
            <Scramble text="Why do the sensors count differently?" />
          </h2>
          <p className="lede">
            Each glowing footprint is one hotspot: a pixel that looked hot to a satellite. It is a thermal anomaly, not a confirmed fire. This is a single day
            over a 150 km window, drawn at the true pixel size of each sensor and laid over that day's real satellite photograph.
          </p>
          <div className="seg-row" role="group" aria-label="Choose a day">
            {demos.map((d, i) => (
              <button key={d.id} className={`seg-btn ${di === i ? "on" : ""}`} onClick={() => setDi(i)}>
                {d.date}
              </button>
            ))}
          </div>
          <div className="toggle-row">
            <button className={`tog cyan ${modis ? "on" : ""}`} onClick={() => setModis((v) => !v)} aria-pressed={modis}>
              <i /> MODIS · 1 km <b><Ticker text={String(counts.aqua + counts.terra)} /></b>
            </button>
            <button className={`tog amber ${viirs ? "on" : ""}`} onClick={() => setViirs((v) => !v)} aria-pressed={viirs}>
              <i /> VIIRS · 375 m <b><Ticker text={String(counts.v)} /></b>
            </button>
          </div>
          <label className="field">
            <span className="mono">BACKGROUND</span>
            <select value={imagery} onChange={(e) => setImagery(e.target.value as Imagery)}>
              {IMAGERY.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.label}
                </option>
              ))}
            </select>
          </label>
          <div className="time-box">
            <div className="time-head">
              <span className="mono">TIME OF DAY (UTC)</span>
              <label className="check">
                <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} /> whole day
              </label>
            </div>
            <input
              type="range"
              min={0}
              max={1439}
              step={5}
              value={minute}
              onChange={(e) => {
                setAllDay(false);
                setPlaying(false);
                setMinute(Number(e.target.value));
              }}
              aria-label="Time of day"
              className="slider"
            />
            <div className="time-read mono">
              {allDay ? "ALL DAY" : `${hhmm(minute)} UTC · about ${hhmm(local)} local solar time · ±45 min`}
            </div>
            <button className="btn-ghost small" onClick={() => setPlaying((p) => !p)}>
              {playing ? "❚❚ Pause" : "▶ Play the day"}
            </button>
          </div>
          <p className="fineprint">
            Watch the day: Terra passes in the morning, Aqua and the VIIRS satellites in the early afternoon, and each passes again at night. Aqua
            counted {counts.aqua}, Terra {counts.terra} and NOAA-20 {counts.v} in the current window.
          </p>
        </div>
        <div className="scene-map">
          {seen ? (
            <HotspotMap key={demo.id} demo={demo} view={view} imagery={imagery} modisFlags={null} viirsFlags={null} />
          ) : (
            <div className="hs-map-wrap">
              <div className="hs-map" />
            </div>
          )}
          <div className="map-key">
            <span className="k cyan" /> MODIS 1 km
            <span className="k amber" /> VIIRS 375 m
            <span className="muted">Imagery: NASA GIBS · Hotspots: NASA FIRMS</span>
          </div>
        </div>
      </div>
      <div className="scene-inner wide below">
        <PixelLab ratio={ratio} />
      </div>
    </section>
  );
}
