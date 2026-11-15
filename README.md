# Mission Ignis

**NASA MODIS × VIIRS hotspot harmonization, as a scroll-through mission from orbit to insight.**
Built for the 2026 NASA Space Apps Challenge, challenge *Harmonization of MODIS and VIIRS Hot Spots*, with a study area covering Sumatra, Kalimantan, Sarawak, Sabah, Brunei and Peninsular Malaysia.

MODIS (1 km) and VIIRS (375 m) have watched Earth's fires for two decades, but they never count the same way. Ignis shows why, measures how often the sensors actually agree, and builds one consistent record with its uncertainty shown.

## The experience

Ignis is a single-screen mission console, not a scrolling page. A rail on the left switches between seven views, and the motion lives in the transitions: a short power-on sequence, a scan line that sweeps the stage on every switch, a fly-in from orbit, and panels that slide into place.

| View | What it shows |
|---|---|
| **Globe** | The main screen. An interactive 3D globe (NASA Blue Marble) with a live Fire Wire news strip and a Live Earth mode (see below), and the week's fire activity as 3D columns (height and colour follow each cell's detections; switch to a heat glow or a flat grid), the selected region highlighted, and numbered pulsing markers on the three hottest areas. Floating panels show detections per day, how far above normal, the percentile, where it is burning, the year so far and the biggest episodes. A timeline of the whole record scrubs and plays through time. |
| **Live** | The last seven days of NOAA-20 and NOAA-21 detections from FIRMS near-real-time data, ranked against every comparable week in the record since 2001. Each region gets an early-warning level, the newest fires glow brightest on the globe, and markers flag the busiest areas of the last 48 hours. |
| **Record** | The burning calendar (one row per year), the fire clock and the per-sensor year chart, with the uncertainty band where values are estimated. |
| **Orbit** | A 3D Earth with the five satellites on their inclined orbits and a readout for each. Period and speed are computed from altitude with Kepler's third law. Day and night follow the real sun at the current UTC time, the selected satellite's imaging swath is drawn on the ground at its true width (2,330 km for MODIS, about 3,000 km for VIIRS), and a beacon on each sector opens it. |
| **Pixels** (step 1) | One real day over the true satellite photograph, each hotspot drawn at its sensor's true pixel size, plus a pixel lab: one 1 km MODIS pixel split into 375 m VIIRS pixels, with scenarios (two fires in one pixel, a small fire, a large fire front) and a free mode showing why VIIRS reports more hotspots. |
| **Verify** (step 2) | Live detection matching with adjustable distance and time tolerances, and three charts that explain the result. |
| **Forecast** | A 26-week fire outlook for each region: expected weekly detections with an 80% range, the chance each week is above normal or critical, this month against the historical median, the El Niño index, a replay of past years and the model's skill on held-out years. Downloadable as CSV. |
| **Method** | Held-out validation, the method, its limits and credits, plus downloads: the harmonized fire record for any date range, daily or as monthly totals with each month's rank (CSV that opens in Excel), the calibration and the matching (JSON). |

The selected date, region and area are shared by every view, so jumping to an episode on the globe moves the calendar too. Each view has its own address (for example `#record`), so the browser's back button and shared links work.

The record runs from 2001 to the latest complete day: 2026 comes from NOAA-20 alone (standard data to July, near-real-time after). Live and Fire Wire show the last days as they happen, and the Forecast looks ahead.

### The Live view

A small server function (`web/api/firms.ts`, shared logic in `web/api/_live.ts`) fetches the last seven complete UTC days plus today from the FIRMS area API, keeps nominal and high confidence detections, and aggregates them to a 0.1° grid. The browser then ranks this week's NOAA-20 total for each region against every 7-day window ending within ten days of the same date in each year of the record. NOAA-20 is used because it is the record's reference scale; NOAA-21 is shown for comparison.

Limits: near-real-time data is preliminary; static heat sources such as gas flares are not filtered out, so quiet-season counts can read a little high; and a day with no NOAA-20 detections at all is flagged as a probable data gap. Responses are cached for 15 minutes on the server and 30 minutes at the CDN to protect the key's request quota.

### Countries and provinces

On the Globe view, the **Borders** row draws country or province (state) outlines from Natural Earth 1:10m admin-1 data. Hovering names an outline and a click selects it: every view then shows that country or province, from its burning calendar to the CSV download, and the selection appears as a region button in the top bar. Click again or ✕ to clear. `pipeline/build_boundaries.py` simplifies the outlines, dissolves provinces into countries, and lists the grid cells whose centre falls inside each outline; an outline too small to hold a cell centre takes the cells it overlaps most and is flagged as approximate. Like a drawn area, a selected province uses the weekly harmonized grid and has no uncertainty range, and the forecast stays at region level.

### The forecast

`pipeline/build_forecast.py` writes `forecast.json` next to each sector's data. It works on weekly totals on a log scale. The normal for each week of the year is the median of that week across the other years of the harmonized record. For each region and each lead time from 1 to 26 weeks, a ridge regression predicts how far above or below normal the week will be, from how unusual the last 4 and 12 weeks were and from NOAA's Oceanic Niño Index. The index's effect is allowed to change through the year, and only values already published on the issue date are used. Every year is forecast by a model fitted without it; those held-out errors set the 80% range, the chances of an above-normal or critical week (above the 90th percentile for that week of the year), and the skill scores shown on the site, including the same model without the El Niño input.

Held-out results: four weeks ahead, the error is 6 to 20% smaller than simply expecting a normal year in most sectors, and the El Niño input adds several points at longer leads in Southeast Asia and Brazil. Canada, where lightning starts most large fires, gains almost nothing beyond two weeks. The model knows past fire activity and El Niño, not this season's rainfall, wind or fuel.

**Drought input.** `pipeline/pull_weather.py` downloads daily rainfall and 50 m wind from NASA POWER (MERRA-2 and GEOS) at the four cells in each region that burn most, weighted by how much each burns. The forecast adds how unusual the last 30 and 90 days of rain were for the time of year (a standardized anomaly, using rain available two days before each issue date) and lets that effect change through the year. The Forecast view shows the last 30 and 90 days of rain as a percentage of normal, the last year of dryness, and the accuracy with and without rainfall. The gain is modest (about 1 to 2 points eight weeks ahead), because past rain cannot foresee the rain still to come.

**Season timing.** A region's fire season is the run of weeks when burning (3-week average) is above its average week across the record. The view shows every past season's start and end around the usual peak, the usual season, and the forecast's start or end date with a range from its low and high paths, plus whether that is earlier or later than usual.

**Haze outlook (Southeast Asia).** Haze potential for Peninsular Malaysia and Singapore is the expected fire activity in Sumatra and Kalimantan, each weighted by the share of days the 50 m wind blows towards the Peninsula (from about 200° for Sumatra and 120° for Kalimantan, ±45°). Past weeks use the wind that blew, coming weeks the usual wind for the time of year, and levels rank each week against all weeks since 2001 (moderate top 30%, high top 10%, very high top 3%). Checked against the record, the highest weeks fall in 2002, 2019, 2006, 2026, 2015 and 2009, the years of major haze. It is a potential for smoke to be produced and carried towards the Peninsula, not an air-quality forecast.

**Burn-window planner.** For land managers and farmers who burn on purpose, the Forecast view rates every coming week: lower risk (under a 10% chance of a critical week and under 50% of an above-normal week), caution, or avoid (25% or more chance of a critical week, or 70% of an above-normal one). For a chosen length of 1, 2 or 4 weeks it finds the lowest-risk windows with no week to avoid, lists the periods to avoid, and exports the best window as a calendar event (.ics). Weeks beyond the range where the forecast beats a typical year are shaded. It is a planning aid only: it knows the regional fire outlook, not the weather on the day, smoke dispersal or local burn rules.

**Predicted burning.** The Forecast view also draws the outlook on a globe as 3D columns for the next 4 weeks, weeks 5 to 8 or weeks 9 to 13. Column height is the expected weekly detections in each grid cell; colour compares that with the cell's normal for the time of year. The cell values share out each region's validated forecast by where that region usually burns at that time of year (75%) and where it has burned in the last 8 weeks (25%), so the map shows where to look rather than making a separate prediction for every cell. A panel lists the places to watch and flies the camera to each.

### Fire Wire and Live Earth

The Globe view carries a breaking-news strip, the **Fire Wire**, fed by the same function with `?sector=world`: the last two days of NOAA-20 and NOAA-21 detections for the whole planet (about 150,000 detections, 13 MB of CSV from FIRMS), aggregated on the server to a 0.5° grid of about 8,500 cells and a 190 KB response. The browser names each cell's country from a precomputed lookup grid (`web/public/data/countrygrid.json`, built from Natural Earth 1:50m by `web/scripts/build_countrygrid.mjs`) and writes the headlines: the planet total, the most active countries, the most intense cluster by fire radiative power, and each archive sector's count. Headlines rotate on their own; clicking one, or turning on **Auto tour**, switches the globe to **Live Earth**, where every cell on the planet is a 3D column, and flies the camera there. Headlines inside an archive sector offer a jump into that sector's 25-year record. The world response is cached for 30 minutes on the server and at the CDN.

The MAP_KEY stays on the server. It is never sent to the browser or committed.

### Sectors

A **Sector** box in the top bar switches the whole console between places. Every sector runs through the same harmonization, validation and anomaly code, so they are directly comparable.

| Sector | Regions | Grid |
|---|---|---|
| **Southeast Asia** (default, detailed) | Peninsular Malaysia, Sumatra, Kalimantan, Sarawak/Sabah/Brunei | 0.5° |
| **Mainland Southeast Asia** | Thailand, Myanmar, Laos, Cambodia, Vietnam | 0.5° |
| **Australia**, **Brazil**, **United States**, **Canada** | the country | 1° |

The detailed sector alone has detection-level matching, the pixel-scale demo days and hand-drawn sub-regions. The others are built from the FIRMS yearly country files, so each detection's country is FIRMS's own attribution, and static heat sources are filtered with the same `type` rule. Each sector is loaded only when someone picks it, and the address keeps it (`?sector=australia`). The Live view works for every sector, and Method compares how large the MODIS-to-VIIRS gap is in each one.

### Selecting your own area

A custom area is the sum of its 0.5° grid cells, which are already on the harmonized scale. Its values are weekly, its anomaly ranking uses the same leave-the-year-out rule as the fixed regions, and it has no uncertainty range, because the cross-validation was run per region and not per cell. The selection snaps outward to whole grid cells.

### Built to survive a demo

- Only the active view is mounted, so at most two WebGL maps are alive at once.
- The globe textures are bundled in `web/public/textures/` (NASA Blue Marble and VIIRS Black Marble, from NASA GIBS), and a bundled world image sits under the live tiles of the intro globe.
- Maps show a loading chip, and say so if the basemap or the day's imagery cannot be reached. The fire data is bundled with the site and still draws.

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
# for the Live view locally, give the dev server your key (it stays on your machine):
#   PowerShell:  $env:FIRMS_MAP_KEY = "your_key"; npm run dev
#   or put FIRMS_MAP_KEY=your_key in web/.env.local, which git ignores
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

# the other sectors (public bulk files, no key needed; keep the cache outside the repo)
python pipeline/pull_countries.py --cache ../NasaSpaceApps/pipeline/cache_sectors
python pipeline/build_sector.py --cache ../NasaSpaceApps/pipeline/cache_sectors

# bring every sector up to yesterday with NOAA-20 (needs the key), then rebuild and forecast
FIRMS_MAP_KEY=... python pipeline/pull_recent.py --sea-cache ../NasaSpaceApps/pipeline/cache --sector-cache ../NasaSpaceApps/pipeline/cache_sectors --force
IGNIS_CACHE=../NasaSpaceApps/pipeline/cache python pipeline/build_dataset.py
python pipeline/build_sector.py --cache ../NasaSpaceApps/pipeline/cache_sectors
python pipeline/pull_weather.py --cache ../NasaSpaceApps/pipeline/cache_weather
python pipeline/build_forecast.py --weather ../NasaSpaceApps/pipeline/cache_weather

# country and province outlines for the globe (Natural Earth 1:10m admin-1, from naturalearthdata.com)
python pipeline/build_boundaries.py --ne <path to ne_10m_admin_1_states_provinces.geojson>

# the country lookup grid used to name live hotspots (run from web/, takes about two minutes)
node scripts/build_countrygrid.mjs
```

The full record takes a few hours to download because FIRMS counts each request as several transactions.

## Deploy to Vercel

1. Push this repository to GitHub.
2. In Vercel choose **Add New → Project**, import the repo and set **Root Directory** to `web`. The Vite preset is detected automatically.
3. For the Live view, add an environment variable in **Settings → Environment Variables**: name `FIRMS_MAP_KEY`, value your FIRMS MAP_KEY. Everything else is static and needs no variables. Without the key the Live view says it is not switched on and the rest of the console works as normal. Never put the key in front-end code or in the repository.

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
pipeline/sectors.py             the other sectors: boxes, grid sizes and countries
pipeline/pull_countries.py      download FIRMS yearly country files and aggregate them
pipeline/build_sector.py        harmonize each sector with the same code, write data/sectors/
web/                            React + TypeScript + Vite + MapLibre front end
web/public/data/                generated dataset served by the site
```
