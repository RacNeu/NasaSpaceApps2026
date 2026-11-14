/**
 * Builds public/data/countrygrid.json: which country each 0.5 degree cell of the world belongs to,
 * so a live hotspot can be named ("Brazil", "Sudan") without any lookup service.
 *
 * Country shapes come from Natural Earth via the world-atlas package (1:50m). Each cell takes the
 * country under its centre; coastal cells whose centre falls in the sea take the nearest land
 * country within two cells, so fires on coasts and small islands still get a name.
 *
 * Run from web/:  node scripts/build_countrygrid.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { feature } from "topojson-client";
import { geoContains, geoBounds } from "d3-geo";

const require = createRequire(import.meta.url);
const topo = JSON.parse(readFileSync(require.resolve("world-atlas/countries-50m.json"), "utf8"));
const countries = feature(topo, topo.objects.countries).features.filter((f) => f.geometry);

const CELL = 0.5;
const W = 360 / CELL;
const H = 180 / CELL;
// Natural Earth's short labels, written out for headlines
const FULL = {
  "United States of America": "United States",
  "S. Sudan": "South Sudan",
  "Dem. Rep. Congo": "DR Congo",
  "Central African Rep.": "Central African Republic",
  "Eq. Guinea": "Equatorial Guinea",
  "Dominican Rep.": "Dominican Republic",
  "W. Sahara": "Western Sahara",
  "Bosnia and Herz.": "Bosnia and Herzegovina",
  "Solomon Is.": "Solomon Islands",
  "Marshall Is.": "Marshall Islands",
  "Falkland Is.": "Falkland Islands",
  "Fr. Polynesia": "French Polynesia",
  "N. Cyprus": "Northern Cyprus",
  "St. Vin. and Gren.": "St Vincent and the Grenadines",
  "Antigua and Barb.": "Antigua and Barbuda",
  "N. Mariana Is.": "Northern Mariana Islands",
  "Fr. S. Antarctic Lands": "French Southern Lands",
};
const names = countries.map((f) => FULL[f.properties.name] ?? f.properties.name.replace(/ Is\.$/, " Islands"));
const bounds = countries.map((f) => geoBounds(f));
const grid = new Int16Array(W * H).fill(-1);

for (let y = 0; y < H; y++) {
  const lat = -90 + (y + 0.5) * CELL;
  for (let x = 0; x < W; x++) {
    const lon = -180 + (x + 0.5) * CELL;
    for (let i = 0; i < countries.length; i++) {
      const [[w, s], [e, n]] = bounds[i];
      if (lat < s || lat > n) continue;
      // bounds that cross the antimeridian have w > e
      if (w <= e ? lon < w || lon > e : lon < w && lon > e) continue;
      if (geoContains(countries[i], [lon, lat])) {
        grid[y * W + x] = i;
        break;
      }
    }
  }
  if (y % 60 === 0) console.log(`row ${y}/${H}`);
}

// give sea cells next to land the neighbouring country (two passes = up to about 110 km)
for (let pass = 0; pass < 2; pass++) {
  const prev = grid.slice();
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (prev[y * W + x] >= 0) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        const v = prev[yy * W + ((x + dx + W) % W)];
        if (v >= 0) {
          grid[y * W + x] = v;
          break;
        }
      }
    }
}

// run-length encode each row as [country, run, country, run, ...]
const rows = [];
for (let y = 0; y < H; y++) {
  const r = [];
  let cur = grid[y * W];
  let run = 0;
  for (let x = 0; x < W; x++) {
    const v = grid[y * W + x];
    if (v === cur) run++;
    else {
      r.push(cur, run);
      cur = v;
      run = 1;
    }
  }
  r.push(cur, run);
  rows.push(r);
}

const out = { source: "Natural Earth 1:50m via world-atlas", cell: CELL, width: W, height: H, names, rows };
writeFileSync(new URL("../public/data/countrygrid.json", import.meta.url), JSON.stringify(out));
console.log(`${names.length} countries, ${JSON.stringify(out).length} bytes`);
