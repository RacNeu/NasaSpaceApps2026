# Mission Ignis

**NASA MODIS × VIIRS hotspot harmonization, as a scroll-through mission from orbit to insight.**
Built for the 2026 NASA Space Apps Challenge, challenge *Harmonization of MODIS and VIIRS Hot Spots*, with a study area covering Sumatra, Kalimantan, Sarawak, Sabah, Brunei and Peninsular Malaysia.

MODIS (1 km) and VIIRS (375 m) have watched Earth's fires for two decades, but they never count the same way. Ignis shows why, measures how often the sensors actually agree, and builds one consistent record with its uncertainty shown.

## The experience

| Scene | What happens |
|---|---|
| **01 Orbit** | Darkness, then NASA Blue Marble Earth rises. A satellite passes, and scrolling descends onto Borneo as fire cells ignite. Skippable, with optional generated sound. |
| **02 Satellites** | A 3D Earth (NASA Blue Marble by day, VIIRS Black Marble city lights by night) with the five satellites on their inclined orbit planes. Drag to rotate and select a satellite for a mission-control readout. Orbital period and speed are computed from altitude with Kepler's third law; orbit heights are exaggerated on screen. |
| **03 Detection** | One real day (14 Sep 2019 or 27 Sep 2023) over the true satellite photograph, with each hotspot drawn at its sensor's true pixel size. Scrub through the day to watch each satellite pass. A pixel lab shows how one 1 km MODIS pixel can hold several 375 m VIIRS pixels. |
| **04 Harmonization** | Live detection matching with adjustable spatial and time tolerances: matched vs unmatched, overlay, or side by side. Three charts explain the result: tolerance sweep, why Terra is not paired, and which fires MODIS misses. |
| **05 Findings** | The calibrated 2012 to 2025 record (MODIS-extended further back where data is available): map, fire clock, burning calendar, per-sensor year chart, validation, limits, and downloads (CSV and JSON). |

## Two kinds of harmonization

1. **Detection-level matching** (`pipeline/match_sensors.py`). Two detections match when they are within a stated radius and time tolerance. Terra passes about three hours before the VIIRS satellites, so it is not paired at tight tolerances; Aqua is. We also report match rates restricted to detections where the other sensor actually observed the area, so a different overpass is not counted as disagreement. A hotspot is a satellite-detected thermal anomaly, not a confirmed fire.
2. **Count-level calibration** (`pipeline/build_dataset.py`). For trends and calendars:
   - reference scale: NOAA-20 VIIRS, the satellite that carries the record forward;
   - Suomi NPP is aligned to it with a per-region ratio from days both observed;
   - MODIS is mapped onto it with a per-region seasonal regression of `log(1 + weekly detections)`;
   - uncertainty bands come from leave-one-year-out cross-validation;
   - each week is ranked against the same time of year in all other years, never including its own year.

Days when a sensor reported zero detections over the whole study box are treated as missing data, not as "no fire". Only vegetation-fire detections (FIRMS `type` 0) are used, and low-confidence detections are excluded.

## Run it

Requirements: Node 20+. Python 3.10+ only to rebuild the data.

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in web/dist
```

The generated data lives in `web/public/data/`, so the site runs without any key.

### Rebuild the data

Create a free FIRMS MAP_KEY at <https://firms.modaps.eosdis.nasa.gov/api/map_key/> and pass it as an environment variable. Never commit it.

```bash
python -m venv pipeline/.venv
pipeline/.venv/Scripts/python -m pip install numpy pandas      # Windows
# pipeline/.venv/bin/python -m pip install numpy pandas        # macOS / Linux

# PowerShell:  $env:FIRMS_MAP_KEY = "your_key"
# bash:        export FIRMS_MAP_KEY=your_key

# count-level record (resumable; throttles itself to the key's request limit)
python pipeline/pull_firms.py --years 2018-2025
python pipeline/pull_firms.py --years 2012-2017 --sensors modis,snpp
python pipeline/pull_firms.py --years 2001-2011 --sensors modis
python pipeline/build_dataset.py

# detection-level matching
python pipeline/pull_raw_windows.py
python pipeline/match_sensors.py
```

The full record takes a few hours to download because FIRMS counts each request as several transactions.

## Deploy to Vercel

1. Push this repository to GitHub.
2. In Vercel choose **Add New → Project**, import the repo and set **Root Directory** to `web`. The Vite preset is detected automatically.
3. No environment variables are needed. The site is static, and the MAP_KEY must never be added to Vercel or to front-end code.

## Visual design

Glass panels, a faint engineering grid, mono telemetry and thin glowing edges, on a deep-space palette (space #080D17, orbit blue #152A40, signal cyan #45B8D1, thermal amber #FF9D43, active fire #F05A42). Sensors are colour-coded everywhere: MODIS cyan, VIIRS amber. Fire density is drawn as a smooth thermal surface rather than blocks: the weekly 0.5° grid is smoothed and upsampled for the intro globe, a heatmap layer is used on the flat map (with a *Grid cells* toggle for the raw data), and detection footprints keep their true pixel size with a soft glow. Typography is Space Grotesk, Inter and IBM Plex Mono, bundled locally. The 3D globe is built with three.js and is loaded only when that scene approaches the viewport.

## Sound

All audio is synthesised in the browser with the Web Audio API (a low drone, faint radio chirps, selection pings and scene sweeps). There are no audio files to license. Browsers require a click before audio can start, so the opening scene offers *Begin with sound* and *Begin in silence*, and the speaker button in the top left toggles it at any time.

## Known limits

- Counts are detections, not burned area or emissions. Smouldering peat fires can stay below detection, and cloud or thick smoke can hide fires.
- Regions are coarse hand-drawn outlines on a 0.5° grid. Replace with official boundaries for border-level questions.
- The MODIS conversion assumes the sensors related to each other in the past as they do today.
- Before Aqua's data began in mid-2002 only Terra was observing, so 2001 and early 2002 are probably undercounted. Treat them as a lower bound.
- Detection matching covers two sample periods (August to October 2019 and 2023) and NOAA-20 only.
- Suomi NPP stopped producing FIRMS data on 2 November 2026. NOAA-21 and 2026 near-real-time data are not yet in the record.
- Basemap tiles come from Esri's keyless World Dark Gray service and imagery from NASA GIBS. Check the provider terms for your use, or swap the basemap in `web/src/components/MapView.tsx`.
- Moodboard and reference-site images are not used. Imagery is NASA GIBS, and the satellite drawing is original.

## Data and acknowledgment

We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance) and NASA's Earth Science Data and Information System (ESDIS). Globe and true-colour imagery: NASA Global Imagery Browse Services (GIBS).

## AI assistance

This project was built with the help of Claude (Anthropic) for code and analysis. Review the Space Apps rules on disclosing AI use and edit this section to match your team's actual contribution.

## Repository layout

```
pipeline/pull_firms.py          download the FIRMS archive, aggregate to a 0.5° daily grid
pipeline/build_dataset.py       calibrate, validate, flag anomalies, write JSON
pipeline/pull_raw_windows.py    download raw detections for the matching sample periods
pipeline/match_sensors.py       detection-level matching and demo-day extracts
web/                            React + TypeScript + Vite + MapLibre front end
web/public/data/                generated dataset served by the site
```
