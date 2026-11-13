import { useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { DemoDay } from "../types";

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const KM = 111.195;

export type Imagery = "none" | "terra" | "aqua" | "noaa20" | "snpp";

const IMAGERY_LAYER: Record<Exclude<Imagery, "none">, string> = {
  terra: "MODIS_Terra_CorrectedReflectance_TrueColor",
  aqua: "MODIS_Aqua_CorrectedReflectance_TrueColor",
  noaa20: "VIIRS_NOAA20_CorrectedReflectance_TrueColor",
  snpp: "VIIRS_SNPP_CorrectedReflectance_TrueColor",
};

export interface HotspotView {
  modis: boolean;
  viirs: boolean;
  terra: boolean;
  aqua: boolean;
  /** colour detections by whether the other sensor has a partner */
  matchMode: boolean;
  /** {center, half} in minutes of the UTC day, or null for the whole day */
  window: { center: number; half: number } | null;
}

interface Props {
  demo: DemoDay;
  view: HotspotView;
  imagery: Imagery;
  modisFlags: Uint8Array | null;
  viirsFlags: Uint8Array | null;
  syncId?: string;
  label?: string;
}

const registry = new Map<string, Set<maplibregl.Map>>();

const square = (lon: number, lat: number, sizeKm: number) => {
  const h = sizeKm / 2 / KM;
  const w = h / Math.cos((lat * Math.PI) / 180);
  return [[[lon - w, lat - h], [lon + w, lat - h], [lon + w, lat + h], [lon - w, lat + h], [lon - w, lat - h]]];
};

function collections(demo: DemoDay, mf: Uint8Array | null, vf: Uint8Array | null) {
  const modis: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: demo.modis.map((p, i) => ({
      type: "Feature",
      properties: { frp: p[3], minute: p[2], aqua: p[5], matched: mf ? mf[i] : 0 },
      geometry: { type: "Polygon", coordinates: square(p[0], p[1], Math.max(1, p[4] || 1)) },
    })),
  };
  const viirs: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: demo.viirs.map((p, i) => ({
      type: "Feature",
      properties: { frp: p[3], minute: p[2], matched: vf ? vf[i] : 0 },
      geometry: { type: "Polygon", coordinates: square(p[0], p[1], 0.375) },
    })),
  };
  return { modis, viirs };
}

const CYAN = "#45B8D1";
const AMBER = "#FF9D43";

export function HotspotMap({ demo, view, imagery, modisFlags, viirsFlags, syncId, label }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const ready = useRef(false);
  const latest = useRef({ demo, view, imagery, modisFlags, viirsFlags });
  latest.current = { demo, view, imagery, modisFlags, viirsFlags };

  const apply = () => {
    const m = map.current;
    if (!m || !ready.current) return;
    const { demo: d, view: v, imagery: im, modisFlags: mf, viirsFlags: vf } = latest.current;
    const c = collections(d, mf, vf);
    (m.getSource("modis") as maplibregl.GeoJSONSource).setData(c.modis);
    (m.getSource("viirs") as maplibregl.GeoJSONSource).setData(c.viirs);

    const timeF: any[] = v.window
      ? [["all", [">=", ["get", "minute"], v.window.center - v.window.half], ["<=", ["get", "minute"], v.window.center + v.window.half]]]
      : [];
    const satFilter: any = v.aqua && v.terra ? true : v.aqua ? ["==", ["get", "aqua"], 1] : v.terra ? ["==", ["get", "aqua"], 0] : false;
    const vFilter: any = ["all", ...timeF, true];
    for (const part of ["glow", "fill", "line"]) {
      m.setFilter(`modis-${part}`, ["all", ...timeF, satFilter]);
      m.setFilter(`viirs-${part}`, vFilter);
      m.setLayoutProperty(`modis-${part}`, "visibility", v.modis ? "visible" : "none");
      m.setLayoutProperty(`viirs-${part}`, "visibility", v.viirs ? "visible" : "none");
    }
    m.setPaintProperty("modis-glow", "line-opacity", v.matchMode ? ["case", ["==", ["get", "matched"], 1], 0.5, 0] : 0.4);
    m.setPaintProperty("viirs-glow", "line-opacity", v.matchMode ? ["case", ["==", ["get", "matched"], 1], 0.5, 0] : 0.3);

    const matchFill = (color: string): any =>
      v.matchMode ? ["case", ["==", ["get", "matched"], 1], color, "rgba(0,0,0,0)"] : color;
    m.setPaintProperty("modis-fill", "fill-color", matchFill(CYAN));
    m.setPaintProperty("viirs-fill", "fill-color", matchFill(AMBER));
    m.setPaintProperty("modis-fill", "fill-opacity", v.matchMode ? 0.7 : 0.3);
    m.setPaintProperty("viirs-fill", "fill-opacity", v.matchMode ? 0.78 : 0.42);
    m.setPaintProperty("modis-line", "line-opacity", v.matchMode ? ["case", ["==", ["get", "matched"], 1], 0.95, 0.55] : 0.9);
    m.setPaintProperty("viirs-line", "line-opacity", v.matchMode ? ["case", ["==", ["get", "matched"], 1], 0.95, 0.45] : 0.55);

    for (const k of Object.keys(IMAGERY_LAYER)) {
      if (!m.getLayer(`img-${k}`)) continue;
      m.setLayoutProperty(`img-${k}`, "visibility", im === k ? "visible" : "none");
      m.setPaintProperty(`img-${k}`, "raster-brightness-max", v.matchMode ? 0.5 : 0.9);
    }
  };

  useEffect(() => {
    if (!el.current || map.current) return;
    const [w, s, e, n] = demo.box;
    const sources: Record<string, any> = {};
    const layers: any[] = [{ id: "bg", type: "background", paint: { "background-color": "#080D17" } }];
    (Object.keys(IMAGERY_LAYER) as (keyof typeof IMAGERY_LAYER)[]).forEach((k) => {
      sources[`img-${k}`] = {
        type: "raster",
        tiles: [`${GIBS}/${IMAGERY_LAYER[k]}/default/${demo.date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`],
        tileSize: 256,
        maxzoom: 9,
      };
      layers.push({ id: `img-${k}`, type: "raster", source: `img-${k}`, layout: { visibility: "none" }, paint: { "raster-brightness-max": 0.9 } });
    });
    const m = new maplibregl.Map({
      container: el.current,
      bounds: [[w, s], [e, n]],
      fitBoundsOptions: { padding: 8 },
      attributionControl: false,
      maxPitch: 0,
      style: { version: 8, sources, layers } as any,
    });
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    m.addControl(new maplibregl.ScaleControl({ unit: "metric", maxWidth: 90 }), "bottom-left");
    m.on("load", () => {
      const c = collections(demo, null, null);
      m.addSource("modis", { type: "geojson", data: c.modis });
      m.addSource("viirs", { type: "geojson", data: c.viirs });
      // each sensor: a soft glow under a translucent footprint with a crisp hairline edge
      m.addLayer({ id: "modis-glow", type: "line", source: "modis", paint: { "line-color": CYAN, "line-width": 6, "line-blur": 5, "line-opacity": 0.4 } });
      m.addLayer({ id: "modis-fill", type: "fill", source: "modis", paint: { "fill-color": CYAN, "fill-opacity": 0.3 } });
      m.addLayer({ id: "modis-line", type: "line", source: "modis", paint: { "line-color": "#8fe3f3", "line-width": 0.9 } });
      m.addLayer({ id: "viirs-glow", type: "line", source: "viirs", paint: { "line-color": AMBER, "line-width": 5, "line-blur": 4, "line-opacity": 0.3 } });
      m.addLayer({ id: "viirs-fill", type: "fill", source: "viirs", paint: { "fill-color": AMBER, "fill-opacity": 0.42 } });
      m.addLayer({ id: "viirs-line", type: "line", source: "viirs", paint: { "line-color": "#ffc98f", "line-width": 0.6 } });
      ready.current = true;
      apply();
    });
    // camera sync between maps that share an id
    if (syncId) {
      if (!registry.has(syncId)) registry.set(syncId, new Set());
      registry.get(syncId)!.add(m);
      // only user-driven moves carry an originalEvent, so programmatic jumps never echo back
      m.on("move", (ev) => {
        if (!(ev as any).originalEvent) return;
        registry.get(syncId)!.forEach((o) => {
          if (o !== m) o.jumpTo({ center: m.getCenter(), zoom: m.getZoom() });
        });
      });
    }
    map.current = m;
    return () => {
      if (syncId) registry.get(syncId)?.delete(m);
      m.remove();
      map.current = null;
      ready.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(apply, [demo, view, imagery, modisFlags, viirsFlags]);

  return (
    <div className="hs-map-wrap">
      <div ref={el} className="hs-map" />
      {label && <div className="hs-label mono">{label}</div>}
    </div>
  );
}
