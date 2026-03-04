const https = require("https");
const fs = require("fs");

const BASE_ID  = process.env.AIRTABLE_BASE_ID;
const TABLE_ID = process.env.AIRTABLE_TABLE_ID;
const API_KEY  = process.env.AIRTABLE_API_KEY;

if (!BASE_ID || !TABLE_ID || !API_KEY) {
  console.error("Missing environment variables. Check your GitHub Secrets.");
  process.exit(1);
}

function geocode(query) {
  return new Promise((resolve) => {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const req = https.get(url, { headers: { "User-Agent": "IMI-OfficeMaps/1.0" } }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.length > 0) {
            resolve({ lat: parseFloat(parsed[0].lat), lng: parseFloat(parsed[0].lon) });
          } else { resolve(null); }
        } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractCityCountry(address) {
  const parts = address.split(",").map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join(", ");
  return address;
}

function extractCity(address) {
  const parts = address.split(",").map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] || "Office";
}

async function main() {
  const url = `https://api.airtable.com/v0/${BASE_ID}/${TABLE_ID}`;
  const records = await new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { Authorization: `Bearer ${API_KEY}` }
    }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try { resolve(JSON.parse(data).records || []); }
        catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
  });

  console.log(`Found ${records.length} records in Airtable`);

  const artonRecord = records.find(r =>
    r.fields["Name"] && r.fields["Name"].toLowerCase().includes("arton capital")
  );

  if (!artonRecord) {
    console.error("Could not find Arton Capital!");
    process.exit(1);
  }

  console.log("Found Arton Capital! Fields:", JSON.stringify(Object.keys(artonRecord.fields)));

  const rawLocations = artonRecord.fields["Office Locations"] || artonRecord.fields["Office Location(s)"];

  if (!rawLocations) {
    console.error("Could not find office locations field! Available fields:", JSON.stringify(Object.keys(artonRecord.fields)));
    process.exit(1);
  }

  console.log("Raw locations data:", rawLocations);

  const addresses = rawLocations.split("\n").map(a => a.trim()).filter(Boolean);
  console.log(`Found ${addresses.length} addresses`);

  const offices = [];

  for (const rawAddress of addresses) {
    const isHq = rawAddress.toUpperCase().startsWith("HQ");
    const cleanAddress = rawAddress.replace(/^HQ\s*/i, "").trim();
    const city = extractCity(cleanAddress);
    const cityCountry = extractCityCountry(cleanAddress);

    console.log(`Geocoding: ${cityCountry}`);
    await sleep(1100);

    const coords = await geocode(cityCountry);

    if (!coords) {
      console.warn(`Could not geocode: ${cityCountry}`);
      continue;
    }

    offices.push({ city, address: cleanAddress, lat: coords.lat, lng: coords.lng, hq: isHq });
    console.log(`  ✓ ${city}: ${coords.lat}, ${coords.lng}`);
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Arton Capital — Office Locations</title>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"/>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"><\/script>
  <link href="https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@400;700&family=Libre+Baskerville&display=swap" rel="stylesheet"/>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { background: #fff; font-family: 'Libre Baskerville', serif; }
    .imi-map-widget { width: 100%; max-width: 960px; margin: 0 auto; }
    .map-label { font-family: 'Roboto Condensed', sans-serif; font-size: 12px; color: #888; margin-bottom: 6px; letter-spacing: 0.03em; }
    #imi-map { width: 100%; height: 380px; background: #ffffff; }
    .leaflet-control-attribution { display: none !important; }
    .leaflet-popup-content-wrapper { border-radius: 0 !important; border: 1px solid #e4e4e4 !important; box-shadow: 0 4px 16px rgba(0,0,0,0.10) !important; }
    .leaflet-popup-content { margin: 12px 16px !important; }
    .popup-city { font-family: 'Roboto Condensed', sans-serif; font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #111; margin-bottom: 4px; }
    .popup-addr { font-family: 'Libre Baskerville', serif; font-size: 11px; color: #777; line-height: 1.5; }
    .popup-hq { font-family: 'Roboto Condensed', sans-serif; font-size: 9px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #c71e1d; display: block; margin-bottom: 3px; }
  </style>
</head>
<body>
<div class="imi-map-widget">
  <p class="map-label">Headquarters' location in red</p>
  <div id="imi-map"></div>
</div>
<script>
  const OFFICES = ${JSON.stringify(offices, null, 2)};

  function makeIcon(isHq) {
    const fill = isHq ? "#c71e1d" : "#1d81a2";
    const size = isHq ? 20 : 13;
    return L.divIcon({
      className: "",
      html: \`<svg width="\${size}" height="\${size}" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
               <rect x="2" y="2" width="16" height="16" rx="1" transform="rotate(45 10 10)"
                 fill="\${fill}" fill-opacity="0.85" stroke="rgba(0,0,0,0.5)" stroke-width="1.2"/>
             </svg>\`,
      iconSize: [size, size], iconAnchor: [size/2, size/2], popupAnchor: [0, -(size/2+4)]
    });
  }


  const southWest = L.latLng(-60, -180);
  const northEast = L.latLng(85, 180);
  const maxBounds = L.latLngBounds(southWest, northEast);

  const map = L.map("imi-map", {
    zoomControl: true,
    attributionControl: false,
    dragging: false,
    scrollWheelZoom: false,
    doubleClickZoom: false,
    boxZoom: false,
    keyboard: false,
    touchZoom: false,
    maxBounds: maxBounds,
    maxBoundsViscosity: 1.0
  });

  fetch("https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson")
    .then(r => r.json())
    .then(geojson => {
      // Filter out Antarctica
      geojson.features = geojson.features.filter(f => f.properties.name !== "Antarctica");

      L.geoJSON(geojson, {
        style: { fillColor: "#ededed", fillOpacity: 1, color: "#cccccc", weight: 0.5 }
      }).addTo(map);

      OFFICES.forEach(o => {
        L.marker([o.lat, o.lng], { icon: makeIcon(o.hq) })
          .addTo(map)
          .bindPopup(\`\${o.hq ? '<span class="popup-hq">Headquarters</span>' : ''}<div class="popup-city">\${o.city}</div><div class="popup-addr">\${o.address}</div>\`, {
            autoPanPadding: [20, 20],
            keepInView: true
          });
      });

      if (OFFICES.length > 0) {
        map.fitBounds(OFFICES.map(o => [o.lat, o.lng]), { padding: [60, 60], maxZoom: 8 });
      } else {
        map.setView([30, 20], 2);
      }
    });

  map.setView([30, 20], 2);
<\/script>
</body>
</html>`;

  fs.writeFileSync("index.html", html);
  console.log(`Done! Wrote index.html with ${offices.length} offices.`);
}

main().catch(e => { console.error(e); process.exit(1); });
