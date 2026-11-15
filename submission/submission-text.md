# Mission Ignis: submission text

## Project summary (about 180 words)

Mission Ignis is a web-based mission console for the challenge "Harmonization of MODIS and VIIRS Hot Spots". MODIS (1 km) and VIIRS (375 m) have watched Earth's fires for two decades, but they count differently, so raw hotspot totals cannot be compared across years. Ignis shows why, using a pixel lab that splits one MODIS pixel into 375 m VIIRS pixels. It measures how often detections truly agree, with live matching at adjustable distance and time tolerances. It then calibrates MODIS onto the NOAA-20 VIIRS scale with a per-region seasonal regression, and shows leave-one-year-out uncertainty on every estimated value. The result is one consistent record from 2001 to 2026, explored on an interactive 3D globe, with a live seven-day view from FIRMS near-real-time data. On top of it we built a 26-week fire forecast that uses El Niño and NASA POWER rainfall, a haze outlook, and a burn-window planner. Eight world sectors run through identical code, so they can be compared directly. This matters because fire smoke drives haze, health and climate impacts, and decision makers need trends they can trust across sensor generations, with the uncertainty shown honestly.

## NASA data or resources used

| Link text | URL |
|---|---|
| NASA FIRMS (Fire Information for Resource Management System): MODIS and VIIRS active-fire archive and near-real-time data | https://firms.modaps.eosdis.nasa.gov/ |
| FIRMS Area API | https://firms.modaps.eosdis.nasa.gov/api/area/ |
| FIRMS country yearly files | https://firms.modaps.eosdis.nasa.gov/data/country |
| NASA LANCE (Land, Atmosphere Near real-time Capability for Earth observations) | https://www.earthdata.nasa.gov/data/tools/lance |
| NASA Earthdata / ESDIS | https://www.earthdata.nasa.gov/ |
| NASA GIBS (Global Imagery Browse Services): Blue Marble, Black Marble and daily true-colour imagery | https://gibs.earthdata.nasa.gov/ |
| NASA POWER (MERRA-2 / GEOS daily rainfall and 50 m wind) | https://power.larc.nasa.gov/ |

## Space agency partner and other data, resources and tools

| Link text | URL |
|---|---|
| NOAA CPC Oceanic Niño Index (ONI) | https://www.cpc.ncep.noaa.gov/data/indices/oni.ascii.txt |
| Natural Earth (admin-0 and admin-1 boundaries, public domain) | https://www.naturalearthdata.com/ |
| Esri World Dark Gray basemap tiles | https://www.arcgis.com/home/item.html?id=1970c1995b8f44749f4b9b6e81b5ba45 |
| three.js (3D globe) | https://threejs.org/ |
| MapLibre GL JS (flat map) | https://maplibre.org/ |
| React | https://react.dev/ |
| d3 (scales, shapes, geo, array) | https://d3js.org/ |
| Vite | https://vite.dev/ |
| TopoJSON client | https://github.com/topojson/topojson-client |
| Fontsource: Space Grotesk, Inter, IBM Plex Mono (open-source fonts) | https://fontsource.org/ |
| Vercel (hosting and serverless function) | https://vercel.com/ |
| Claude (Anthropic): AI assistance with code and analysis | https://www.anthropic.com/claude |

Notes before you submit:
- Check the Esri basemap terms. The README already flags this. You can swap the basemap in `web/src/components/MapView.tsx` if unsure.
- Check that Space Apps rules on disclosing AI use are met. The README says to edit that section to match your actual contribution.
- All links above are public. The FIRMS MAP_KEY is never published.
- The two NASA URLs for LANCE and Earthdata are the current public pages; the README cites the older earthdata.nasa.gov/lance form.
- Team: powerful_explorers. Project director: Rachel Lee Yi Wen. Code: https://github.com/RacNeu/NasaSpaceApps2026. Demo: https://powerfulexplorersnasa2026.vercel.app/
