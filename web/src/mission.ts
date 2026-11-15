import { useCallback, useEffect, useMemo, useState } from "react";
import type { Dataset, Extras } from "./types";
import { audio } from "./audio";
import { indexOf } from "./lib";
import { buildAreaSeries, CUSTOM_ID, withArea, type Aoi } from "./aoi";

export type ViewId = "overview" | "live" | "record" | "satellites" | "detection" | "harmonize" | "forecast" | "method";

/** State shared by every view of the console: selected date, region, area of interest and playback. */
export function useMission(data: Dataset, extras: Extras) {
  const { meta, daily } = data;
  const maxT = daily.days - 1;
  const clamp = useCallback((v: number) => Math.max(0, Math.min(maxT, v)), [maxT]);

  const [regionId, setRegionId] = useState("study_area");
  const [t, setT] = useState(() => {
    const best = [...meta.events].sort((a, b) => b.total - a.total)[0];
    return best ? indexOf(meta.start, best.peak) : maxT;
  });
  const [playing, setPlaying] = useState(false);
  const [mapMode, setMapMode] = useState<"columns" | "heat" | "cells">("columns");
  const [aoi, setAoi] = useState<Aoi | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [drawMsg, setDrawMsg] = useState<string | null>(null);

  const area = useMemo(() => (aoi ? buildAreaSeries(data, aoi) : null), [data, aoi]);
  /** The dataset with the user's area added as one more region. */
  const view = useMemo(() => withArea(data, area), [data, area]);

  const pick = useCallback(
    (i: number) => {
      setPlaying(false);
      setT(clamp(i));
      audio.ping(520);
    },
    [clamp],
  );
  const step = useCallback((d: number) => setT((c) => clamp(c + d)), [clamp]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setT((cur) => {
        if (cur + 7 > maxT) {
          setPlaying(false);
          return cur;
        }
        return cur + 7;
      });
    }, 140);
    return () => clearInterval(id);
  }, [playing, maxT]);

  const onDraw = useCallback(
    (box: Aoi) => {
      const res = buildAreaSeries(data, box);
      if (!res) {
        setDrawMsg("That selection is outside the study area. Try again inside the data.");
        return;
      }
      setDrawMsg(null);
      setAoi(res.snapped);
      setRegionId(CUSTOM_ID);
      setDrawing(false);
      audio.ping(880);
    },
    [data],
  );
  /** Select a country or province from the globe: its own cells, name and outline. */
  const pickArea = useCallback(
    (a: Aoi) => {
      setDrawMsg(null);
      setDrawing(false);
      setAoi(a);
      setRegionId(CUSTOM_ID);
      audio.ping(880);
    },
    [],
  );
  const clearArea = useCallback(() => {
    setAoi(null);
    setDrawing(false);
    setDrawMsg(null);
    setRegionId((r) => (r === CUSTOM_ID ? "study_area" : r));
  }, []);

  const isCustom = regionId === CUSTOM_ID && !!area;
  // never point at a region that no longer exists
  const safeRegion = view.daily.regions[regionId] ? regionId : "study_area";

  return {
    data, extras, view, maxT,
    regionId: safeRegion, setRegionId,
    t, pick, step,
    playing, setPlaying,
    mapMode, setMapMode,
    aoi, area, isCustom, drawing, setDrawing, drawMsg, setDrawMsg, onDraw, clearArea, pickArea,
  };
}

export type Mission = ReturnType<typeof useMission>;
