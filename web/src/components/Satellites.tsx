import { Suspense, lazy, useState } from "react";
import type { Dataset } from "../types";
import { audio } from "../audio";
import { useSeen, useVisible } from "../hooks";
import type { GlobeSat } from "./EarthGlobe";

// three.js is large, so it is only downloaded when this scene comes near the viewport
const EarthGlobe = lazy(() => import("./EarthGlobe").then((m) => ({ default: m.EarthGlobe })));

interface Sat extends GlobeSat {
  sensor: "MODIS" | "VIIRS";
  launched: string;
  crossing: string;
  pixel: string;
  swath: string;
  note?: string;
  studyKey?: "modis" | "snpp" | "noaa20";
}

const SATS: Sat[] = [
  {
    id: "terra", name: "Terra", sensor: "MODIS", color: "#45B8D1", altKm: 705, incl: 98.2, raan: 0, phase: 0.05, periodMin: 0,
    launched: "Dec 1999", crossing: "about 10:30 local, heading south", pixel: "1 km", swath: "about 2,330 km", studyKey: "modis",
    note: "Passes in the morning, so it sees a different part of the day's fire cycle than the afternoon satellites.",
  },
  {
    id: "aqua", name: "Aqua", sensor: "MODIS", color: "#7fe0f2", altKm: 705, incl: 98.2, raan: 135, phase: 0.55, periodMin: 0,
    launched: "May 2002", crossing: "about 13:30 local, heading north", pixel: "1 km", swath: "about 2,330 km", studyKey: "modis",
    note: "Flies at about the same local time as the VIIRS satellites, which makes it the right partner for matching detections.",
  },
  {
    id: "snpp", name: "Suomi NPP", sensor: "VIIRS", color: "#FFC27A", altKm: 824, incl: 98.7, raan: 140, phase: 0.15, periodMin: 0,
    launched: "Oct 2011", crossing: "about 13:30 local, heading north", pixel: "375 m", swath: "about 3,000 km", studyKey: "snpp",
    note: "NASA ended Suomi NPP fire data production on 2 November 2026. NOAA-20 and NOAA-21 carry the same sensor and continue the record.",
  },
  {
    id: "noaa20", name: "NOAA-20", sensor: "VIIRS", color: "#FF9D43", altKm: 824, incl: 98.7, raan: 140, phase: 0.66, periodMin: 0,
    launched: "Nov 2017", crossing: "about 13:30 local, heading north", pixel: "375 m", swath: "about 3,000 km", studyKey: "noaa20",
    note: "Follows the same orbital plane as Suomi NPP, about 50 minutes apart.",
  },
  {
    id: "noaa21", name: "NOAA-21", sensor: "VIIRS", color: "#F05A42", altKm: 824, incl: 98.7, raan: 140, phase: 0.41, periodMin: 0,
    launched: "Nov 2022", crossing: "about 13:30 local, heading north", pixel: "375 m", swath: "about 3,000 km",
    note: "Not yet in this version's record. It is the natural next step: the same calibration extends to it.",
  },
];

const MU = 398600.4418; // km^3 / s^2
const R = 6371; // km
const physics = (altKm: number) => {
  const a = R + altKm;
  const period = (2 * Math.PI * Math.sqrt((a * a * a) / MU)) / 60; // minutes
  const speed = Math.sqrt(MU / a); // km/s
  return { period, speed, perDay: 1440 / period };
};
SATS.forEach((s) => {
  s.periodMin = physics(s.altKm).period;
});

export function Satellites({ data }: { data: Dataset }) {
  const [sel, setSel] = useState("aqua");
  const [seenRef, seen] = useSeen<HTMLDivElement>("700px");
  const [visRef, visible] = useVisible<HTMLDivElement>(0.05);
  const selected = SATS.find((s) => s.id === sel)!;
  const ph = physics(selected.altKm);
  const first = selected.studyKey ? data.meta.sensors[selected.studyKey]?.first : null;

  const pick = (id: string) => {
    setSel(id);
    audio.ping(id.startsWith("noaa") || id === "snpp" ? 990 : 740);
  };

  const readout: { k: string; v: string; unit?: string }[] = [
    { k: "Altitude", v: String(selected.altKm), unit: "km" },
    { k: "Inclination", v: selected.incl.toFixed(1), unit: "°" },
    { k: "Period", v: ph.period.toFixed(1), unit: "min" },
    { k: "Speed", v: ph.speed.toFixed(2), unit: "km/s" },
    { k: "Orbits a day", v: ph.perDay.toFixed(1) },
    { k: "Pixel size", v: selected.pixel },
  ];

  return (
    <section id="satellites" className="scene scene-sats">
      <div className="scene-inner">
        <div className="scene-copy">
          <div className="scene-code mono">SCENE 02 · THE SATELLITES</div>
          <h2>Two perspectives. One Earth.</h2>
          <p className="lede">
            Fires are found from orbit by looking for heat. Two families of instruments do this job. They fly at different heights, at different times of
            day, and with different pixel sizes, so a fire can count once for one and many times for the other.
          </p>
          <div className="sensor-compare">
            <div className="sc modis glass">
              <div className="sc-n mono">MODIS</div>
              <div className="sc-big">1 km</div>
              <div className="sc-l">active-fire pixel · swath about 2,330 km · Terra and Aqua</div>
            </div>
            <div className="sc viirs glass">
              <div className="sc-n mono">VIIRS</div>
              <div className="sc-big">375 m</div>
              <div className="sc-l">active-fire pixel · swath about 3,000 km · Suomi NPP, NOAA-20, NOAA-21</div>
            </div>
          </div>
          <div className="sat-list" role="tablist" aria-label="Satellites">
            {SATS.map((s) => (
              <button key={s.id} role="tab" aria-selected={sel === s.id} className={sel === s.id ? "on" : ""} onClick={() => pick(s.id)} style={{ ["--c" as any]: s.color }}>
                <i />
                {s.name}
                <span className="mono">{s.sensor}</span>
              </button>
            ))}
          </div>
          <article className="sat-card glass" key={selected.id} aria-live="polite">
            <header>
              <div>
                <div className="mono eyebrow">{selected.sensor} PLATFORM</div>
                <h3>{selected.name}</h3>
              </div>
              <span className="status mono" style={{ color: selected.color }}>
                <i style={{ background: selected.color }} />
                {selected.id === "snpp" ? "FIRE DATA ENDED 2 NOV 2026" : selected.id === "noaa21" ? "NOT YET IN RECORD" : "IN RECORD"}
              </span>
            </header>
            <div className="readout">
              {readout.map((r) => (
                <div key={r.k}>
                  <div className="mono k">{r.k}</div>
                  <div className="v">
                    {r.v}
                    {r.unit && <small>{r.unit}</small>}
                  </div>
                </div>
              ))}
            </div>
            <dl>
              <div>
                <dt className="mono">Launched</dt>
                <dd>{selected.launched}</dd>
              </div>
              <div>
                <dt className="mono">Crosses the equator</dt>
                <dd>{selected.crossing}</dd>
              </div>
              <div>
                <dt className="mono">Swath</dt>
                <dd>{selected.swath}</dd>
              </div>
              <div>
                <dt className="mono">In this study</dt>
                <dd>{first ? `from ${first}` : "not included yet"}</dd>
              </div>
            </dl>
            {selected.note && <p className="sat-note">{selected.note}</p>}
            <p className="fineprint">Period and speed are computed from altitude with Kepler's third law.</p>
          </article>
        </div>

        <div className="globe-card glass" ref={visRef}>
          <div className="hud-corner tl mono">ORBITAL VIEW</div>
          <div className="hud-corner tr mono">SUN-SYNCHRONOUS · ~{selected.altKm} KM</div>
          <div ref={seenRef} className="globe-stage">
            {seen && (
              <Suspense fallback={<div className="globe-loading mono">LOADING ORBITAL VIEW</div>}>
                <EarthGlobe sats={SATS} selected={sel} onSelect={pick} active={visible} />
              </Suspense>
            )}
          </div>
          <div className="hud-corner bl mono">DRAG TO ROTATE · CLICK A SATELLITE</div>
          <div className="hud-corner br mono">ORBIT HEIGHTS EXAGGERATED</div>
        </div>
      </div>
    </section>
  );
}
