import { useEffect, useState } from "react";
import type { Dataset, Extras } from "./types";
import { loadDataset, loadExtras } from "./data";
import { Chrome, type SceneDef } from "./components/Chrome";
import { Hero } from "./components/Hero";
import { Satellites } from "./components/Satellites";
import { Detection } from "./components/Detection";
import { Harmonization } from "./components/Harmonization";
import { Findings } from "./components/Findings";
import { Outlook } from "./components/Outlook";

const SCENES: SceneDef[] = [
  { id: "intro", label: "Orbit", code: "01" },
  { id: "satellites", label: "Satellites", code: "02" },
  { id: "detection", label: "Detection", code: "03" },
  { id: "harmonization", label: "Harmonization", code: "04" },
  { id: "findings", label: "Findings", code: "05" },
  { id: "outlook", label: "Why it matters", code: "06" },
];

export default function App() {
  const [data, setData] = useState<Dataset | null>(null);
  const [extras, setExtras] = useState<Extras | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([loadDataset(), loadExtras()])
      .then(([d, e]) => {
        setData(d);
        setExtras(e);
      })
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <div className="splash error">Could not load the mission data: {error}</div>;
  if (!data || !extras)
    return (
      <div className="splash">
        <div className="mono">MISSION IGNIS</div>
        <div className="splash-bar">
          <i />
        </div>
        <div className="mono dim">ACQUIRING SIGNAL</div>
      </div>
    );

  return (
    <div className="app">
      <Chrome scenes={SCENES} onSkip={() => document.getElementById("satellites")?.scrollIntoView({ behavior: "smooth" })} />
      <Hero data={data} />
      <Satellites data={data} />
      <Detection demos={extras.demos} />
      <Harmonization demos={extras.demos} matching={extras.matching} />
      <Findings data={data} extras={extras} />
      <Outlook data={data} />
      <footer className="site-foot">
        <div className="mono">MISSION IGNIS · NASA SPACE APPS CHALLENGE 2026</div>
        <p>
          Hotspots: NASA FIRMS (MODIS, Suomi NPP VIIRS, NOAA-20 VIIRS), part of NASA LANCE and ESDIS. Imagery: NASA GIBS. Basemap: Esri. A hotspot is a
          satellite-detected thermal anomaly, not a confirmed fire. Data generated {data.meta.generated}.
        </p>
      </footer>
    </div>
  );
}
