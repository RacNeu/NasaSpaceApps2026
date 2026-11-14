import { useEffect, useMemo, useState } from "react";
import type { DemoDay } from "../types";
import { audio } from "../audio";
import { useNear } from "../hooks";
import { HotspotMap, type HotspotView, type Imagery } from "./HotspotMap";
import { hhmm } from "../match";
import { Scramble, Ticker } from "../fx";

/* ------------------------------------------------------------------ pixel lab */

const BIG = 240; // px for 1 km
const SMALL = BIG * 0.375; // 90 px for 375 m

function PixelLab() {
  const [fires, setFires] = useState<{ x: number; y: number }[]>([{ x: 70, y: 66 }]);

  const modisPixels = new Set<string>();
  const viirsPixels = new Set<string>();
  fires.forEach((f) => {
    modisPixels.add("m"); // one MODIS pixel covers the whole square
    viirsPixels.add(`${Math.floor(f.x / SMALL)}-${Math.floor(f.y / SMALL)}`);
  });
  const cols = Math.ceil(BIG / SMALL);

  return (
    <div className="pixel-lab">
      <div className="pl-head">
        <div className="mono scene-code">TRY IT · ONE MODIS PIXEL, SEEN BY VIIRS</div>
        <p>Click inside the square to place fires. The big square is one 1 km MODIS pixel. The small squares are 375 m VIIRS pixels.</p>
      </div>
      <div className="pl-body">
        <svg
          width={BIG}
          height={BIG}
          viewBox={`0 0 ${BIG} ${BIG}`}
          className="pl-svg"
          role="img"
          aria-label="A 1 kilometre MODIS pixel divided into 375 metre VIIRS pixels"
          onClick={(e) => {
            const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
            const x = ((e.clientX - r.left) / r.width) * BIG;
            const y = ((e.clientY - r.top) / r.height) * BIG;
            setFires((f) => (f.length >= 8 ? [{ x, y }] : [...f, { x, y }]));
            audio.ping(660 + fires.length * 60);
          }}
        >
          <rect x="1" y="1" width={BIG - 2} height={BIG - 2} fill="rgba(69,184,209,0.16)" stroke="#45B8D1" strokeWidth="2" />
          {Array.from({ length: cols }, (_, cx) =>
            Array.from({ length: cols }, (_, cy) => {
              const hit = viirsPixels.has(`${cx}-${cy}`);
              const w = Math.min(SMALL, BIG - cx * SMALL);
              const h = Math.min(SMALL, BIG - cy * SMALL);
              return (
                <rect
                  key={`${cx}-${cy}`}
                  x={cx * SMALL}
                  y={cy * SMALL}
                  width={w}
                  height={h}
                  fill={hit ? "rgba(255,157,67,0.55)" : "none"}
                  stroke="#FF9D43"
                  strokeOpacity={hit ? 1 : 0.45}
                  strokeDasharray={hit ? "" : "3 3"}
                />
              );
            }),
          )}
          {fires.map((f, i) => (
            <g key={i}>
              <circle cx={f.x} cy={f.y} r="9" fill="#F05A42" opacity="0.35" />
              <circle cx={f.x} cy={f.y} r="4" fill="#F05A42" />
            </g>
          ))}
        </svg>
        <div className="pl-count">
          <div className="pl-stat modis">
            <div className="mono">MODIS REPORTS</div>
            <b>{fires.length ? 1 : 0}</b>
            <span>{fires.length ? "hotspot" : "hotspots"}</span>
          </div>
          <div className="pl-stat viirs">
            <div className="mono">VIIRS REPORTS</div>
            <b>{viirsPixels.size}</b>
            <span>{viirsPixels.size === 1 ? "hotspot" : "hotspots"}</span>
          </div>
          <button className="btn-ghost small" onClick={() => setFires([])}>
            Clear
          </button>
          <p className="fineprint">
            {fires.length} fire{fires.length === 1 ? "" : "s"} placed. A 1 km pixel holds about {(1 / 0.375 ** 2).toFixed(1)} VIIRS pixels, so the same
            ground can produce more VIIRS hotspots than MODIS ones, and VIIRS pins each one down more tightly.
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

export function Detection({ demos }: { demos: DemoDay[] }) {
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
          <div className="scene-code mono">DETECT · ONE DAY, PIXEL BY PIXEL</div>
          <h2>
            <Scramble text="Finding thermal anomalies" />
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
        <PixelLab />
      </div>
    </section>
  );
}
