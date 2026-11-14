import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Dataset } from "../types";
import { audio } from "../audio";
import { clamp01, lerp, smooth, useNear, useReducedMotion, useScrollProgress } from "../hooks";
import { fmtDate, indexOf, dateAt } from "../lib";

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";

interface Props {
  data: Dataset;
  onBegin?: () => void;
}

export function Hero({ data }: Props) {
  const section = useRef<HTMLElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const lastP = useRef(0);
  const starsEl = useRef<HTMLCanvasElement>(null);
  const globeLayer = useRef<HTMLDivElement>(null);
  const satEl = useRef<HTMLDivElement>(null);
  const titleEl = useRef<HTMLDivElement>(null);
  const capA = useRef<HTMLDivElement>(null);
  const capB = useRef<HTMLDivElement>(null);
  const hint = useRef<HTMLDivElement>(null);
  const fade = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  // the globe is only alive while the intro is near the viewport
  const [nearRef, near] = useNear<HTMLElement>("900px");

  const peak = (() => {
    const best = [...data.meta.events].sort((a, b) => b.total - a.total)[0];
    return best ? best.peak : data.meta.end;
  })();
  const peakIdx = indexOf(data.meta.start, peak);
  const peakWeek = Math.min(Math.floor(peakIdx / 7), data.grid.weeks - 1);

  // starfield
  useEffect(() => {
    const cv = starsEl.current;
    if (!cv) return;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = (cv.width = window.innerWidth * dpr);
      const h = (cv.height = window.innerHeight * dpr);
      const ctx = cv.getContext("2d")!;
      ctx.clearRect(0, 0, w, h);
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 520; i++) {
        const x = rnd() * w;
        const y = rnd() * h;
        const r = (rnd() < 0.06 ? 1.6 : rnd() < 0.3 ? 1.1 : 0.7) * dpr;
        ctx.globalAlpha = 0.25 + rnd() * 0.75;
        ctx.fillStyle = rnd() < 0.12 ? "#9fd8e8" : rnd() < 0.1 ? "#ffd7ae" : "#ffffff";
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, []);

  const apply = (p: number) => {
    lastP.current = p;
    const m = map.current;
    // camera
    const a = smooth(0, 0.38, p);
    const b = smooth(0.38, 0.78, p);
    const c = smooth(0.78, 1, p);
    const zoom = lerp(lerp(0.35, 1.55, a), lerp(1.55, 3.4, b), b > 0 ? 1 : 0) + c * 1.5;
    const lon = lerp(lerp(112, 110, a), 111.5, b) + c * 2;
    const lat = lerp(lerp(8, 3, a), -0.5, b) + c * -2.2;
    const pitch = b * 38 + c * 14;
    const bearing = -b * 14 + c * 10;
    if (m && ready.current) {
      m.jumpTo({ center: [lon, lat], zoom: Math.min(zoom, 5.4), pitch, bearing });
      const fireOpacity = smooth(0.62, 0.9, p) * 0.9;
      if (m.getLayer("fires-glow")) {
        m.setPaintProperty("fires-glow", "circle-opacity", fireOpacity);
        m.setPaintProperty("fires-core", "circle-opacity", fireOpacity * 0.9);
      }
    }
    // globe appears from darkness, then stays
    if (globeLayer.current) globeLayer.current.style.opacity = String(smooth(0.02, 0.2, p));
    if (starsEl.current) {
      starsEl.current.style.transform = `translateY(${-p * 70}px) scale(${1 + p * 0.3})`;
      starsEl.current.style.opacity = String(1 - smooth(0.7, 1, p) * 0.7);
    }
    // a satellite crossing the sky: a bright point with a trailing streak, as seen from orbit
    if (satEl.current) {
      const t = clamp01((p - 0.04) / 0.34);
      const x = lerp(-12, 112, t);
      const y = lerp(30, 14, t);
      satEl.current.style.transform = `translate3d(${x}vw, ${y}vh, 0) rotate(${lerp(8, -4, t)}deg)`;
      satEl.current.style.opacity = String(smooth(0.03, 0.08, p) * (1 - smooth(0.32, 0.4, p)));
    }
    // live camera telemetry
    if (hudRef.current) {
      const zoomNow = Math.min(zoom, 5.4);
      const alt = Math.max(550, 24000 / Math.pow(2, zoomNow));
      const f = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(2)}° ${v >= 0 ? pos : neg}`;
      hudRef.current.innerHTML = `<div><span>LAT</span>${f(lat, "N", "S")}</div><div><span>LON</span>${f(lon, "E", "W")}</div><div><span>CAMERA ALT</span>${Math.round(alt).toLocaleString("en-US")} km</div><div><span>DESCENT</span>${Math.round(p * 100)}%</div>`;
      hudRef.current.style.opacity = String(smooth(0.06, 0.16, p));
    }
    if (titleEl.current) {
      const o = smooth(0.1, 0.24, p) * (1 - smooth(0.46, 0.58, p));
      titleEl.current.style.opacity = String(o);
      titleEl.current.style.transform = `translateY(${lerp(30, 0, smooth(0.1, 0.24, p)) + lerp(0, -40, smooth(0.46, 0.58, p))}px)`;
      titleEl.current.style.pointerEvents = o > 0.5 ? "auto" : "none";
    }
    if (capA.current) {
      capA.current.style.opacity = String(smooth(0.6, 0.7, p) * (1 - smooth(0.8, 0.86, p)));
      capA.current.style.transform = `translateY(${lerp(24, 0, smooth(0.6, 0.7, p))}px)`;
    }
    if (capB.current) {
      capB.current.style.opacity = String(smooth(0.86, 0.95, p));
      capB.current.style.transform = `translateY(${lerp(24, 0, smooth(0.86, 0.95, p))}px)`;
    }
    if (hint.current) hint.current.style.opacity = String(1 - smooth(0.02, 0.1, p));
    if (fade.current) fade.current.style.opacity = String(smooth(0.94, 1, p) * 0.0);
  };

  useScrollProgress(section, apply, !reduced);

  useEffect(() => {
    if (reduced) apply(0.5);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  // globe
  useEffect(() => {
    if (!near || !mapEl.current || map.current) return;
    const m = new maplibregl.Map({
      container: mapEl.current,
      interactive: false,
      attributionControl: false,
      center: [112, 8],
      zoom: 0.35,
      style: {
        version: 8,
        projection: { type: "globe" },
        sky: {
          "sky-color": "#080D17",
          "horizon-color": "#2a6f99",
          "fog-color": "#0a1626",
          "sky-horizon-blend": 0.6,
          "horizon-fog-blend": 0.5,
          "fog-ground-blend": 0.3,
          "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 4, 0.8, 6, 0],
        },
        sources: {
          // a single bundled world image sits under the live tiles, so the globe is never blank
          bm0: {
            type: "image",
            url: `${import.meta.env.BASE_URL}textures/earth_mercator.jpg`,
            coordinates: [[-180, 85.0511], [180, 85.0511], [180, -85.0511], [-180, -85.0511]],
          },
          bm: {
            type: "raster",
            tiles: [`${GIBS}/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`],
            tileSize: 256,
            maxzoom: 8,
          },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#05080f" } },
          { id: "bm0", type: "raster", source: "bm0", paint: { "raster-brightness-max": 0.82, "raster-saturation": -0.1, "raster-contrast": 0.1 } },
          { id: "bm", type: "raster", source: "bm", paint: { "raster-brightness-max": 0.82, "raster-saturation": -0.1, "raster-contrast": 0.1 } },
        ],
      } as any,
    });
    const w = Math.min(peakWeek, data.grid.weeks - 1);
    m.on("load", () => {
      // Smooth the 0.5 degree weekly grid and upsample it 4x so the glow reads as one continuous
      // thermal surface rather than a lattice of cells.
      const { nx, ny, cell, box } = data.meta;
      const row = data.grid.data[w] ?? [];
      const V = new Float32Array(nx * ny);
      for (let i = 0; i < row.length; i += 2) {
        const [cx, cy] = data.grid.cells[row[i]];
        if (cx >= 0 && cx < nx && cy >= 0 && cy < ny) V[cy * nx + cx] += row[i + 1];
      }
      const kernel = [0.06, 0.24, 0.4, 0.24, 0.06];
      const blur = (src: Float32Array, horizontal: boolean) => {
        const out = new Float32Array(src.length);
        for (let y = 0; y < ny; y++) {
          for (let x = 0; x < nx; x++) {
            let s = 0;
            for (let k = -2; k <= 2; k++) {
              const xx = horizontal ? x + k : x;
              const yy = horizontal ? y : y + k;
              if (xx >= 0 && xx < nx && yy >= 0 && yy < ny) s += src[yy * nx + xx] * kernel[k + 2];
            }
            out[y * nx + x] = s;
          }
        }
        return out;
      };
      const S = blur(blur(V, true), false);
      const UP = 4;
      const sample = (px: number, py: number) => {
        const x0 = Math.max(0, Math.min(nx - 2, Math.floor(px)));
        const y0 = Math.max(0, Math.min(ny - 2, Math.floor(py)));
        const fx = Math.max(0, Math.min(1, px - x0));
        const fy = Math.max(0, Math.min(1, py - y0));
        const a = S[y0 * nx + x0] * (1 - fx) + S[y0 * nx + x0 + 1] * fx;
        const b = S[(y0 + 1) * nx + x0] * (1 - fx) + S[(y0 + 1) * nx + x0 + 1] * fx;
        return a * (1 - fy) + b * fy;
      };
      const feats: GeoJSON.Feature[] = [];
      for (let fy = 0; fy < ny * UP; fy++) {
        for (let fx = 0; fx < nx * UP; fx++) {
          const px = fx / UP; // position in cell units
          const py = fy / UP;
          const v = sample(px - 0.5, py - 0.5);
          if (v < 1.5) continue;
          feats.push({
            type: "Feature",
            properties: { v: Math.round(v * 10) / 10 },
            geometry: { type: "Point", coordinates: [box[0] + px * cell, box[1] + py * cell] },
          });
        }
      }
      m.addSource("fires", { type: "geojson", data: { type: "FeatureCollection", features: feats } });
      // Intensity is carried by colour alpha, so quiet cells fade out completely instead of
      // leaving a regular lattice of dots, and only genuinely hot areas glow.
      const halo: any = ["interpolate", ["linear"], ["get", "v"], 1.5, "rgba(150,40,30,0)", 8, "rgba(200,60,45,0.035)", 40, "rgba(240,90,50,0.07)", 200, "rgba(255,130,60,0.1)"];
      const hot: any = ["interpolate", ["linear"], ["get", "v"], 30, "rgba(255,140,60,0)", 150, "rgba(255,185,95,0.1)", 500, "rgba(255,225,160,0.17)", 1500, "rgba(255,250,235,0.3)"];
      const rad = (small: number, large: number): any => ["interpolate", ["linear"], ["zoom"], 2, small, 5.4, large];
      // two overlapping soft layers: a wide red halo and a smaller yellow-white hot core
      m.addLayer({
        id: "fires-glow",
        type: "circle",
        source: "fires",
        paint: { "circle-color": halo, "circle-radius": rad(3.6, 16), "circle-blur": 1, "circle-opacity": 0, "circle-pitch-alignment": "map" },
      });
      m.addLayer({
        id: "fires-core",
        type: "circle",
        source: "fires",
        paint: { "circle-color": hot, "circle-radius": rad(1.8, 8), "circle-blur": 1, "circle-opacity": 0, "circle-pitch-alignment": "map" },
      });
      ready.current = true;
      apply(lastP.current);
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near]);

  const begin = async (withSound: boolean) => {
    if (withSound) await audio.enable();
    else audio.mute();
    const el = section.current;
    if (el) window.scrollTo({ top: el.offsetTop + (el.offsetHeight - window.innerHeight) * 0.16, behavior: "smooth" });
  };

  const peakDate = fmtDate(dateAt(data.meta.start, peakIdx));

  return (
    <section
      id="intro"
      ref={(n) => {
        (section as React.MutableRefObject<HTMLElement | null>).current = n;
        nearRef(n);
      }}
      className={`hero ${reduced ? "reduced" : ""}`}>
      <div className="hero-stage">
        <canvas ref={starsEl} className="stars" aria-hidden />
        <div ref={globeLayer} className="hero-globe">
          <div ref={mapEl} className="hero-map" aria-hidden />
        </div>
        <div className="hero-vignette" aria-hidden />
        <div ref={satEl} className="sat-fore" aria-hidden>
          <i className="streak" />
          <span className="streak-label mono">AQUA · 705 KM</span>
        </div>
        <div ref={hudRef} className="hero-hud mono" aria-hidden />

        <div ref={titleEl} className="hero-title">
          <div className="eyebrow-line mono">NASA SPACE APPS CHALLENGE 2026 · MODIS × VIIRS HOTSPOT HARMONIZATION</div>
          <h1>
            <span className="h1-pre">MISSION</span>
            IGNIS
          </h1>
          <p className="hero-sub">Two satellite families have watched Earth burn for two decades. They never counted the same way.</p>
          <div className="gate">
            <button className="btn-primary" onClick={() => begin(true)}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 12c2-6 4-6 6 0s4 6 6 0 4-6 6 0" />
              </svg>
              Begin with sound
            </button>
            <button className="btn-ghost" onClick={() => begin(false)}>
              Begin in silence
            </button>
          </div>
        </div>

        <div ref={capA} className="hero-cap cap-a">
          <div className="mono cap-k">SOUTHEAST ASIA · {peakDate.toUpperCase()}</div>
          <p>Across Borneo and Sumatra, peat, forest and farmland burn in the dry season, and the smoke crosses borders.</p>
        </div>
        <div ref={capB} className="hero-cap cap-b">
          <div className="mono cap-k">THE PROBLEM</div>
          <p>Every glow here was found by a satellite. But MODIS and VIIRS see the same fires with different eyes.</p>
          <p className="cap-arrow mono">Keep scrolling ↓</p>
        </div>

        <div ref={hint} className="scroll-hint">
          <span className="mono">SCROLL TO BEGIN</span>
          <i />
        </div>
        <div ref={fade} className="hero-fade" aria-hidden />
      </div>
    </section>
  );
}
