import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { Dataset } from "../types";

interface Props {
  data: Dataset;
  week: number;
  regionId: string;
  mode?: "heat" | "cells";
}

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

export function MapView({ data, week, regionId, mode = "heat" }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const popup = useRef<maplibregl.Popup | null>(null);
  const { meta, grid } = data;
  const latest = useRef({ week, regionId, mode });
  latest.current = { week, regionId, mode };

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
      bounds: [[w, s], [e, n]],
      fitBoundsOptions: { padding: 12 },
      attributionControl: { compact: true },
      style: {
        version: 8,
        sources: {
          base: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            maxzoom: 16,
            attribution: "Tiles © Esri, HERE, Garmin, OpenStreetMap contributors",
          },
          labels: {
            type: "raster",
            tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"],
            tileSize: 256,
            maxzoom: 16,
          },
        },
        layers: [
          { id: "bg", type: "background", paint: { "background-color": "#0b1117" } },
          { id: "base", type: "raster", source: "base" },
        ],
      },
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
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
      ready.current = true;

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
    if (m.getLayer("regions-hi")) m.setFilter("regions-hi", ["==", ["get", "id"], regionId]);
  }, [regionId]);

  return <div ref={el} className="map" />;
}
