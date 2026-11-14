import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Dataset } from "../types";
import type { Aoi } from "../aoi";

interface Props {
  data: Dataset;
  week: number;
  regionId: string;
  mode?: "heat" | "cells";
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
}

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

export function MapLegend() {
  return (
    <div className="map-legend" aria-label="Map legend">
      <div className="legend-title">Detections per week</div>
      <div className="legend-bar" style={{ background: `linear-gradient(90deg, ${RAMP.map((r) => r[1]).join(",")})` }} />
      <div className="legend-ticks">
        <span>1</span>
        <span>15</span>
        <span>150+</span>
      </div>
      <div className="legend-note">VIIRS-equivalent, 0.5° cells</div>
    </div>
  );
}

export function MapView({ data, week, regionId, mode = "heat", aoi = null, drawing = false, onDraw, padding = 12, nav = true, globe = false, highlights = 0 }: Props) {
  const markers = useRef<maplibregl.Marker[]>([]);
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const popup = useRef<maplibregl.Popup | null>(null);
  const { meta, grid } = data;
  const latest = useRef({ week, regionId, mode, aoi, onDraw });
  latest.current = { week, regionId, mode, aoi, onDraw };
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

  const applyMode = (m: maplibregl.Map, md: "heat" | "cells") => {
    if (m.getLayer("fires-heat")) m.setLayoutProperty("fires-heat", "visibility", md === "heat" ? "visible" : "none");
    if (m.getLayer("fires-fill")) m.setLayoutProperty("fires-fill", "visibility", md === "cells" ? "visible" : "none");
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
    const [w, s, e, n] = meta.box;
    const m = new maplibregl.Map({
      container: el.current,
      ...(globe ? { center: [128, 14] as [number, number], zoom: 0.6 } : { bounds: [[w, s], [e, n]] as [[number, number], [number, number]], fitBoundsOptions: { padding } }),
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
      applyMode(m, latest.current.mode);
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
      m.addSource("aoi", { type: "geojson", data: rectFeature(latest.current.aoi) });
      m.addLayer({ id: "aoi-fill", type: "fill", source: "aoi", paint: { "fill-color": "#ffffff", "fill-opacity": 0.07 } });
      m.addLayer({ id: "aoi-glow", type: "line", source: "aoi", paint: { "line-color": "#45B8D1", "line-width": 7, "line-blur": 6, "line-opacity": 0.6 } });
      m.addLayer({ id: "aoi-line", type: "line", source: "aoi", paint: { "line-color": "#ffffff", "line-width": 1.6, "line-dasharray": [3, 2] } });
      ready.current = true;
      setLoaded(true);
      if (globe) {
        const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        m.fitBounds([[w, s], [e, n]], { padding, duration: still ? 0 : 3200, essential: true });
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
    if (!m || !loaded || highlights <= 0) return;
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
  }, [week, loaded, highlights]);

  return (
    <>
      <div ref={el} className="map" />
      {!settled && <div className="map-status mono">LOADING MAP</div>}
      {baseFailed && <div className="map-status warn mono">BASEMAP UNAVAILABLE · FIRE DATA STILL SHOWN</div>}
      {drawing && <div className="map-status draw mono">DRAG ON THE MAP TO SELECT AN AREA</div>}
    </>
  );
}
