import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Dataset } from "../types";
import type { Aoi } from "../aoi";
import { viewBox } from "../sectorViews";

interface Props {
  data: Dataset;
  week: number;
  regionId: string;
  mode?: MapMode;
  /** The user's selected area, drawn as an outline. */
  aoi?: Aoi | null;
  /** While true, dragging on the map draws a rectangle instead of panning. */
  drawing?: boolean;
  onDraw?: (box: Aoi) => void;
  /** Padding around the study area when the camera is fitted, to leave room for floating panels. */
  padding?: number | { top: number; bottom: number; left: number; right: number };
  /** Show the zoom buttons. */
  nav?: boolean;
  /** Draw on a 3D globe and fly in from orbit. */
  globe?: boolean;
  /** Number of pulsing markers placed on the hottest cells of the week. */
  highlights?: number;
  /** Live columns for the whole planet; shown instead of the sector archive while worldOn is true. */
  worldCols?: GeoJSON.FeatureCollection | null;
  worldOn?: boolean;
  /** Forecast columns for the sector; shown instead of the archive while fcOn is true. */
  fcCols?: GeoJSON.FeatureCollection | null;
  fcOn?: boolean;
  /** Where the camera should fly next; a new key triggers a new flight. */
  focus?: MapFocus | null;
}

export interface MapFocus {
  key: string | number;
  lon: number;
  lat: number;
  zoom: number;
  label?: string;
}

export type MapMode = "columns" | "heat" | "cells";

const rectFeature = (b: Aoi | null): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: b
    ? [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [[[b.west, b.south], [b.east, b.south], [b.east, b.north], [b.west, b.north], [b.west, b.south]]] },
        },
      ]
    : [],
});

const RAMP: [number, string][] = [
  [1, "#4a2a1e"],
  [4, "#9a3412"],
  [15, "#ea580c"],
  [50, "#fbbf24"],
  [150, "#fef3c7"],
];

export function MapLegend({ cell = 0.5 }: { cell?: number }) {
  return (
    <div className="map-legend" aria-label="Map legend">
      <div className="legend-title">Detections per week</div>
      <div className="legend-bar" style={{ background: `linear-gradient(90deg, ${RAMP.map((r) => r[1]).join(",")})` }} />
      <div className="legend-ticks">
        <span>1</span>
        <span>15</span>
        <span>150+</span>
      </div>
      <div className="legend-note">VIIRS-equivalent, {cell}° cells</div>
    </div>
  );
}

export function MapView({ data, week, regionId, mode = "columns", aoi = null, drawing = false, onDraw, padding = 12, nav = true, globe = false, highlights = 0, worldCols = null, worldOn = false, fcCols = null, fcOn = false, focus = null }: Props) {
  const focusMarker = useRef<maplibregl.Marker | null>(null);
  const markers = useRef<maplibregl.Marker[]>([]);
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const popup = useRef<maplibregl.Popup | null>(null);
  const { meta, grid } = data;
  const latest = useRef({ week, regionId, mode, aoi, onDraw, worldOn, fcOn });
  latest.current = { week, regionId, mode, aoi, onDraw, worldOn, fcOn };
  const [loaded, setLoaded] = useState(false);
  const [settled, setSettled] = useState(false);
  const [baseFailed, setBaseFailed] = useState(false);

  const weekPoints = (w: number): GeoJSON.FeatureCollection => {
    const row = grid.data[w] ?? [];
    const features: GeoJSON.Feature[] = [];
    for (let i = 0; i < row.length; i += 2) {
      const [cx, cy] = grid.cells[row[i]];
      features.push({
        type: "Feature",
        properties: { v: row[i + 1] },
        geometry: { type: "Point", coordinates: [meta.box[0] + (cx + 0.5) * meta.cell, meta.box[1] + (cy + 0.5) * meta.cell] },
      });
    }
    return { type: "FeatureCollection", features };
  };

  // column height in metres: the square root keeps quiet cells visible next to extreme ones
  const heightOf = (v: number) => Math.sqrt(v) * (meta.cell >= 1 ? 7000 : 5000);

  /** Each cell as an inset square, so neighbouring columns read as separate towers. */
  const weekColumns = (w: number): GeoJSON.FeatureCollection => {
    const row = grid.data[w] ?? [];
    const inset = meta.cell * 0.14;
    const features: GeoJSON.Feature[] = [];
    for (let i = 0; i < row.length; i += 2) {
      const [cx, cy, rg] = grid.cells[row[i]];
      const v = row[i + 1];
      const x0 = meta.box[0] + cx * meta.cell + inset;
      const y0 = meta.box[1] + cy * meta.cell + inset;
      const x1 = x0 + meta.cell - 2 * inset;
      const y1 = y0 + meta.cell - 2 * inset;
      features.push({
        type: "Feature",
        properties: { v, h: heightOf(v), region: rg >= 0 ? meta.regions[rg]?.name ?? "" : "" },
        geometry: { type: "Polygon", coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] },
      });
    }
    return { type: "FeatureCollection", features };
  };

  const applyMode = (m: maplibregl.Map, md: MapMode, animate = true) => {
    const vis = (id: string, on: boolean) => m.getLayer(id) && m.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    // the world layer replaces the sector archive while it is on
    const arch = !latest.current.worldOn && !latest.current.fcOn;
    vis("fires-heat", arch && md !== "cells");
    vis("fires-fill", arch && md === "cells");
    vis("fires-cols", arch && md === "columns");
    for (const id of ["regions-fill", "regions-fill-hi", "regions-glow", "regions-line", "regions-hi"]) vis(id, arch);
    vis("world-cols", latest.current.worldOn);
    vis("fc-cols", latest.current.fcOn && !latest.current.worldOn);
    for (const id of ["regions-line", "regions-hi"]) vis(id, arch || latest.current.fcOn);
    if (!arch) return;
    // under the columns the heat becomes a soft ground glow, never a white blob
    if (m.getLayer("fires-heat")) {
      m.setPaintProperty("fires-heat", "heatmap-opacity", md === "columns" ? 0.45 : 0.95);
      m.setPaintProperty("fires-heat", "heatmap-intensity", md === "columns" ? 0.55 : (["interpolate", ["linear"], ["zoom"], 3, 0.9, 6, 1.7] as any));
    }
    if (globe && animate) m.easeTo({ pitch: md === "columns" ? 52 : 0, duration: 1400 });
  };

  const cellFeature = (ci: number, v: number): GeoJSON.Feature => {
    const [cx, cy, rg] = grid.cells[ci];
    const w = meta.box[0] + cx * meta.cell;
    const s = meta.box[1] + cy * meta.cell;
    const e = w + meta.cell;
    const n = s + meta.cell;
    return {
      type: "Feature",
      properties: { v, region: rg >= 0 ? meta.regions[rg]?.name ?? "" : "Outside the four study regions" },
      geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
    };
  };

  const weekCollection = (w: number): GeoJSON.FeatureCollection => {
    const row = grid.data[w] ?? [];
    const features: GeoJSON.Feature[] = [];
    for (let i = 0; i < row.length; i += 2) features.push(cellFeature(row[i], row[i + 1]));
    return { type: "FeatureCollection", features };
  };

  useEffect(() => {
    if (!el.current || map.current) return;
    // frame the part of the sector where fires happen
    const [w, s, e, n] = viewBox(meta);
    const m = new maplibregl.Map({
      container: el.current,
      ...(globe ? { center: [(w + e) / 2, (s + n) / 2 + 8] as [number, number], zoom: 0.6 } : { bounds: [[w, s], [e, n]] as [[number, number], [number, number]], fitBoundsOptions: { padding } }),
      attributionControl: { compact: true },
      style: {
        version: 8,
        ...(globe
          ? {
              projection: { type: "globe" },
              sky: {
                "sky-color": "#04070d",
                "horizon-color": "#2a86b0",
                "fog-color": "#081424",
                "sky-horizon-blend": 0.7,
                "horizon-fog-blend": 0.6,
                "fog-ground-blend": 0.2,
                "atmosphere-blend": ["interpolate", ["linear"], ["zoom"], 0, 1, 5, 0.9, 7, 0.4],
              },
            }
          : {}),
        sources: {
          base: {
            type: "raster",
            // the globe uses NASA Blue Marble, dimmed so the fire glow stands out; the flat map uses a dark basemap
            tiles: [
              globe
                ? "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg"
                : "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
            maxzoom: globe ? 8 : 16,
            attribution: globe ? "Imagery: NASA GIBS Blue Marble · Labels © Esri" : "Tiles © Esri, HERE, Garmin, OpenStreetMap contributors",
          },
          // a bundled world image under the live tiles, so the globe is never blank
          ...(globe
            ? {
                under: {
                  type: "image",
                  url: `${import.meta.env.BASE_URL}textures/earth_mercator.jpg`,
                  coordinates: [[-180, 85.0511], [180, 85.0511], [180, -85.0511], [-180, -85.0511]],
                },
              }
            : {}),
          labels: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            maxzoom: 16,
          },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#0b1117" } },
          ...(globe ? [{ id: "under", type: "raster", source: "under", paint: { "raster-brightness-max": 0.72, "raster-saturation": -0.2, "raster-contrast": 0.25 } }] : []),
          { id: "base", type: "raster", source: "base", paint: globe ? { "raster-brightness-max": 0.72, "raster-saturation": -0.2, "raster-contrast": 0.25 } : {} },
        ],
      } as any,
    });
    if (nav) m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.on("load", () => {
      m.addSource("fires", { type: "geojson", data: weekCollection(latest.current.week) });
      m.addSource("firepts", { type: "geojson", data: weekPoints(latest.current.week) });
      m.addSource("cols", { type: "geojson", data: weekColumns(latest.current.week) });
      m.addLayer({
        id: "fires-heat",
        type: "heatmap",
        source: "firepts",
        paint: {
          "heatmap-weight": ["interpolate", ["linear"], ["get", "v"], 0, 0, 3, 0.12, 20, 0.45, 100, 0.85, 300, 1] as any,
          "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 3, 0.9, 6, 1.7] as any,
          "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 3, 22, 5, 46, 7, 92] as any,
          "heatmap-opacity": 0.95,
          "heatmap-color": [
            "interpolate", ["linear"], ["heatmap-density"],
            0, "rgba(8,13,23,0)",
            0.1, "rgba(120,30,20,0.35)",
            0.28, "rgba(240,90,66,0.72)",
            0.5, "#FF8A3D",
            0.72, "#FFC27A",
            0.9, "#FFE9C4",
            1, "#FFFFFF",
          ] as any,
        },
      });
      m.addLayer({
        id: "fires-fill",
        type: "fill",
        source: "fires",
        layout: { visibility: "none" },
        paint: {
          "fill-color": ["interpolate", ["linear"], ["get", "v"], ...RAMP.flat()] as any,
          "fill-opacity": 0.85,
        },
      });
      const regionLines: GeoJSON.FeatureCollection = {
        type: "FeatureCollection",
        features: meta.regions
          .filter((r) => r.polygon)
          .map((r) => ({
            type: "Feature",
            properties: { id: r.id, color: r.color },
            geometry: { type: "Polygon", coordinates: [[...r.polygon!, r.polygon![0]]] },
          })),
      };
      m.addSource("regions", { type: "geojson", data: regionLines });
      m.addLayer({ id: "regions-fill", type: "fill", source: "regions", paint: { "fill-color": ["get", "color"], "fill-opacity": 0.04 } });
      m.addLayer({
        id: "regions-fill-hi",
        type: "fill",
        source: "regions",
        filter: ["==", ["get", "id"], latest.current.regionId],
        paint: { "fill-color": ["get", "color"], "fill-opacity": 0.16 },
      });
      m.addLayer({
        id: "regions-glow",
        type: "line",
        source: "regions",
        filter: ["==", ["get", "id"], latest.current.regionId],
        paint: { "line-color": ["get", "color"], "line-width": 9, "line-blur": 8, "line-opacity": 0.7 },
      });
      m.addLayer({
        id: "regions-line",
        type: "line",
        source: "regions",
        paint: { "line-color": ["get", "color"], "line-width": 1.2, "line-opacity": 0.55 },
      });
      m.addLayer({
        id: "regions-hi",
        type: "line",
        source: "regions",
        filter: ["==", ["get", "id"], latest.current.regionId],
        paint: { "line-color": ["get", "color"], "line-width": 2.6, "line-opacity": 1 },
      });
      m.addLayer({ id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.8 } });
      // 3D fire columns: height and colour both follow the week's detections
      m.addLayer({
        id: "fires-cols",
        type: "fill-extrusion",
        source: "cols",
        paint: {
          "fill-extrusion-color": ["interpolate", ["linear"], ["get", "v"], 1, "#7a2a14", 15, "#F05A42", 60, "#FF9D43", 250, "#FFD9A0", 1200, "#FFF6E6"] as any,
          "fill-extrusion-height": ["get", "h"] as any,
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.9,
          "fill-extrusion-vertical-gradient": true,
        },
      });
      // the whole planet's live detections, one column per 0.5 degree cell
      m.addSource("world", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "world-cols",
        type: "fill-extrusion",
        source: "world",
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": ["interpolate", ["linear"], ["get", "v"], 1, "#8a2f16", 6, "#F05A42", 30, "#FF9D43", 150, "#FFD9A0", 500, "#FFF6E6"] as any,
          "fill-extrusion-height": ["get", "h"] as any,
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.92,
          "fill-extrusion-vertical-gradient": true,
        },
      });
      // forecast columns: height is the expected weekly detections, colour how that compares with normal
      m.addSource("fc", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      m.addLayer({
        id: "fc-cols",
        type: "fill-extrusion",
        source: "fc",
        layout: { visibility: "none" },
        paint: {
          "fill-extrusion-color": ["interpolate", ["linear"], ["get", "r"], 0.4, "#2b7caa", 0.8, "#5ca0be", 1, "#5b6672", 1.4, "#e88c46", 2.2, "#F05A42", 4, "#ff2e4d"] as any,
          "fill-extrusion-height": ["get", "h"] as any,
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 0.9,
          "fill-extrusion-vertical-gradient": true,
        },
      });
      applyMode(m, latest.current.mode, false);
      m.addSource("aoi", { type: "geojson", data: rectFeature(latest.current.aoi) });
      m.addLayer({ id: "aoi-fill", type: "fill", source: "aoi", paint: { "fill-color": "#ffffff", "fill-opacity": 0.07 } });
      m.addLayer({ id: "aoi-glow", type: "line", source: "aoi", paint: { "line-color": "#45B8D1", "line-width": 7, "line-blur": 6, "line-opacity": 0.6 } });
      m.addLayer({ id: "aoi-line", type: "line", source: "aoi", paint: { "line-color": "#ffffff", "line-width": 1.6, "line-dasharray": [3, 2] } });
      ready.current = true;
      setLoaded(true);
      if (globe) {
        const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        m.fitBounds([[w, s], [e, n]], { padding, duration: still ? 0 : 3200, essential: true });
        // once the fly-in lands, tilt the camera so the columns stand up
        m.once("moveend", () => {
          if (latest.current.mode === "columns") m.easeTo({ pitch: 52, duration: still ? 0 : 1600 });
        });
      }

      popup.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 8 });
      m.on("mousemove", "fires-fill", (ev) => {
        const f = ev.features?.[0];
        if (!f) return;
        m.getCanvas().style.cursor = "pointer";
        popup.current!
          .setLngLat(ev.lngLat)
          .setHTML(`<strong>${Math.round(Number(f.properties?.v))}</strong> detections this week<br/><span>${f.properties?.region}</span>`)
          .addTo(m);
      });
      m.on("mousemove", "fires-cols", (ev) => {
        const f = ev.features?.[0];
        if (!f) return;
        m.getCanvas().style.cursor = "pointer";
        popup.current!
          .setLngLat(ev.lngLat)
          .setHTML(`<strong>${Math.round(Number(f.properties?.v)).toLocaleString("en-US")}</strong> detections this week${f.properties?.region ? `<br/><span>${f.properties.region}</span>` : ""}`)
          .addTo(m);
      });
      m.on("mousemove", "world-cols", (ev) => {
        const f = ev.features?.[0];
        if (!f) return;
        m.getCanvas().style.cursor = "pointer";
        popup.current!
          .setLngLat(ev.lngLat)
          .setHTML(`<strong>${Math.round(Number(f.properties?.v)).toLocaleString("en-US")}</strong> detections, last 48 h${f.properties?.country ? `<br/><span>${f.properties.country}</span>` : ""}`)
          .addTo(m);
      });
      m.on("mousemove", "fc-cols", (ev) => {
        const f = ev.features?.[0];
        if (!f) return;
        m.getCanvas().style.cursor = "pointer";
        const p = f.properties as any;
        popup.current!
          .setLngLat(ev.lngLat)
          .setHTML(`<strong>~${Math.round(p.v).toLocaleString("en-US")}</strong> detections a week expected<br/><span>normal ${Math.round(p.n).toLocaleString("en-US")} · ${Number(p.r).toFixed(1)}× normal${p.region ? ` · ${p.region}` : ""}</span>`)
          .addTo(m);
      });
      m.on("mouseleave", "fc-cols", () => {
        m.getCanvas().style.cursor = "";
        popup.current?.remove();
      });
      m.on("mouseleave", "world-cols", () => {
        m.getCanvas().style.cursor = "";
        popup.current?.remove();
      });
      m.on("mouseleave", "fires-cols", () => {
        m.getCanvas().style.cursor = "";
        popup.current?.remove();
      });
      m.on("mouseleave", "fires-fill", () => {
        m.getCanvas().style.cursor = "";
        popup.current?.remove();
      });
    });
    m.once("idle", () => setSettled(true));
    // if the basemap provider is unreachable the fire data still draws over the dark background
    m.on("error", (e) => {
      if ((e as any).sourceId === "base") setBaseFailed(true);
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    (m.getSource("aoi") as maplibregl.GeoJSONSource | undefined)?.setData(rectFeature(aoi));
  }, [aoi, loaded]);

  // draw-a-rectangle mode (mouse and touch)
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded || !drawing) return;
    m.dragPan.disable();
    m.boxZoom.disable();
    m.getCanvas().style.cursor = "crosshair";
    let start: maplibregl.LngLat | null = null;
    let last: maplibregl.LngLat | null = null;
    const box = (): Aoi | null =>
      start && last
        ? { west: Math.min(start.lng, last.lng), east: Math.max(start.lng, last.lng), south: Math.min(start.lat, last.lat), north: Math.max(start.lat, last.lat) }
        : null;
    const down = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      e.preventDefault();
      start = last = e.lngLat;
    };
    const move = (e: maplibregl.MapMouseEvent | maplibregl.MapTouchEvent) => {
      if (!start) return;
      last = e.lngLat;
      (m.getSource("aoi") as maplibregl.GeoJSONSource | undefined)?.setData(rectFeature(box()));
    };
    const up = () => {
      const b = box();
      start = null;
      if (b) latest.current.onDraw?.(b);
    };
    m.on("mousedown", down);
    m.on("mousemove", move);
    m.on("mouseup", up);
    m.on("touchstart", down);
    m.on("touchmove", move);
    m.on("touchend", up);
    return () => {
      m.off("mousedown", down);
      m.off("mousemove", move);
      m.off("mouseup", up);
      m.off("touchstart", down);
      m.off("touchmove", move);
      m.off("touchend", up);
      m.dragPan.enable();
      m.boxZoom.enable();
      m.getCanvas().style.cursor = "";
    };
  }, [drawing, loaded]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    (m.getSource("fires") as maplibregl.GeoJSONSource | undefined)?.setData(weekCollection(week));
    (m.getSource("firepts") as maplibregl.GeoJSONSource | undefined)?.setData(weekPoints(week));
    (m.getSource("cols") as maplibregl.GeoJSONSource | undefined)?.setData(weekColumns(week));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week]);

  useEffect(() => {
    const m = map.current;
    if (m && ready.current) applyMode(m, mode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    for (const id of ["regions-hi", "regions-fill-hi", "regions-glow"]) {
      if (m.getLayer(id)) m.setFilter(id, ["==", ["get", "id"], regionId]);
    }
  }, [regionId, loaded]);

  // pulsing markers on the hottest cells of the selected week
  useEffect(() => {
    const m = map.current;
    markers.current.forEach((k) => k.remove());
    markers.current = [];
    if (!m || !loaded || highlights <= 0 || worldOn || fcOn) return;
    const row = grid.data[week] ?? [];
    const cells: { lon: number; lat: number; v: number }[] = [];
    for (let i = 0; i < row.length; i += 2) {
      const [cx, cy] = grid.cells[row[i]];
      cells.push({ lon: meta.box[0] + (cx + 0.5) * meta.cell, lat: meta.box[1] + (cy + 0.5) * meta.cell, v: row[i + 1] });
    }
    cells.sort((a, b) => b.v - a.v);
    // keep the top cells that are not right next to a hotter one
    const picked: typeof cells = [];
    for (const c of cells) {
      if (c.v < 25 || picked.length >= highlights) break;
      if (picked.every((p) => Math.hypot(p.lon - c.lon, p.lat - c.lat) > 2)) picked.push(c);
    }
    picked.forEach((c, i) => {
      const el = document.createElement("div");
      el.className = "hot-marker";
      el.innerHTML = `<i></i><i></i><b></b><span>${String(i + 1).padStart(2, "0")} · ${Math.round(c.v).toLocaleString("en-US")}/wk</span>`;
      markers.current.push(new maplibregl.Marker({ element: el }).setLngLat([c.lon, c.lat]).addTo(m));
    });
    return () => {
      markers.current.forEach((k) => k.remove());
      markers.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, loaded, highlights, worldOn, fcOn]);

  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    (m.getSource("fc") as maplibregl.GeoJSONSource | undefined)?.setData(fcCols ?? { type: "FeatureCollection", features: [] });
  }, [fcCols, loaded]);

  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    (m.getSource("world") as maplibregl.GeoJSONSource | undefined)?.setData(worldCols ?? { type: "FeatureCollection", features: [] });
  }, [worldCols, loaded]);

  // switching between the sector archive and the live planet
  const firstWorld = useRef(true);
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded) return;
    applyMode(m, mode, false);
    if (firstWorld.current) {
      firstWorld.current = false;
      return;
    }
    if (!worldOn) {
      focusMarker.current?.remove();
      const [w, s, e, n] = viewBox(meta);
      m.fitBounds([[w, s], [e, n]], { padding, duration: 2600, essential: true });
      m.once("moveend", () => {
        if ((latest.current.mode === "columns" || latest.current.fcOn) && !latest.current.worldOn) m.easeTo({ pitch: 52, duration: 1200 });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [worldOn, fcOn, loaded]);

  // fly to a headline
  useEffect(() => {
    const m = map.current;
    if (!m || !loaded || !focus) return;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    m.flyTo({
      center: [focus.lon, focus.lat],
      zoom: focus.zoom,
      pitch: focus.zoom > 2 ? 55 : 20,
      bearing: focus.zoom > 2 ? -18 + ((Math.abs(focus.lon * 7) % 36)) : 0,
      duration: still ? 0 : 4200,
      curve: 1.6,
      essential: true,
    });
    focusMarker.current?.remove();
    focusMarker.current = null;
    if (focus.label) {
      const el = document.createElement("div");
      el.className = "hot-marker wire-marker";
      el.innerHTML = `<i></i><i></i><b></b><span>${focus.label}</span>`;
      focusMarker.current = new maplibregl.Marker({ element: el }).setLngLat([focus.lon, focus.lat]).addTo(m);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus?.key, loaded]);

  return (
    <>
      <div ref={el} className="map" />
      {!settled && <div className="map-status mono">LOADING MAP</div>}
      {baseFailed && <div className="map-status warn mono">BASEMAP UNAVAILABLE · FIRE DATA STILL SHOWN</div>}
      {drawing && <div className="map-status draw mono">DRAG ON THE MAP TO SELECT AN AREA</div>}
    </>
  );
}
