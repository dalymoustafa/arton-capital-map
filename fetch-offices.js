const https = require("https");
const fs = require("fs");

const BASE_ID  = process.env.AIRTABLE_BASE_ID;
const TABLE_ID = process.env.AIRTABLE_TABLE_ID;
const API_KEY  = process.env.AIRTABLE_API_KEY;

if (!BASE_ID || !TABLE_ID || !API_KEY) {
  console.error("Missing environment variables. Check your GitHub Secrets.");
  process.exit(1);
}

// Known coordinates for each city - no geocoding needed, 100% reliable
const KNOWN_COORDS = {
  "montreal": { lat: 45.4832, lng: -73.5975 },
  "beijing": { lat: 39.9042, lng: 116.4074 },
  "shanghai": { lat: 31.2304, lng: 121.4737 },
  "singapore": { lat: 1.2792, lng: 103.8531 },
  "dubai": { lat: 25.1972, lng: 55.2744 },
  "beirut": { lat: 33.8988, lng: 35.5016 },
  "sofia": { lat: 42.6977, lng: 23.3219 },
  "podgorica": { lat: 42.4304, lng: 19.2594 },
  "budapest": { lat: 47.5008, lng: 19.0559 },
  "brussels": { lat: 50.8388, lng: 4.3647 },
  "basseterre": { lat: 17.2948, lng: -62.7261 },
  "roseau": { lat: 15.3009, lng: -61.3881 },
  "saint john's": { lat: 17.1274, lng: -61.8468 },
  "st. john's": { lat: 17.1274, lng: -61.8468 },
  "antigua": { lat: 17.1274, lng: -61.8468 }
};

function extractCity(address) {
  const parts = address.split(",").map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] || "Office";
}

function getCoordsForAddress(address) {
  const lower = address.toLowerCase();
  for (const [city, coords] of Object.entries(KNOWN_COORDS)) {
    if (lower.includes(city)) return { city: city.charAt(0).toUpperCase() + city.slice(1), ...coords };
  }
  // fallback: use extracted city name
  return null;
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

  const rawLocations = artonRecord.fields["Office Location(s)"];
  if (!rawLocations) {
    console.error("Office Location(s) field is empty!");
    process.exit(1);
  }

  const addresses = rawLocations.split("\n").map(a => a.trim()).filter(Boolean);
  console.log(`Found ${addresses.length} addresses`);

  const offices = [];
  for (const rawAddress of addresses) {
    const isHq = rawAddress.toUpperCase().startsWith("HQ");
    const cleanAddress = rawAddress.replace(/^HQ\s*/i, "").trim();
    const coords = getCoordsForAddress(cleanAddress);
    const city = coords ? coords.city : extractCity(cleanAddress);
    const lat = coords ? coords.lat : null;
    const lng = coords ? coords.lng : null;

    if (!lat) {
      console.warn(`No coordinates found for: ${cleanAddress}`);
      continue;
    }

    offices.push({ city, address: cleanAddress, lat, lng, hq: isHq });
    console.log(`✓ ${city}`);
  }

  // Build the full index.html with offices baked in
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
    .imi-map-widget { width: 100%; max-width: 960px; margin: 0 auto; border: 1px solid #e4e4e4; overflow: hidden; }
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

  const map = L.map("imi-map", { zoomControl: true, attributionControl: false });

  fetch("https://raw.githubusercontent.com/holtzy/D3-graph-gallery/master/DATA/world.geojson")
    .then(r => r.json())
    .then(geojson => {
      L.geoJSON(geojson, { style: { fillColor: "#ededed", fillOpacity: 1, color: "#cccccc", weight: 0.5 } }).addTo(map);
      OFFICES.forEach(o => {
        L.marker([o.lat, o.lng], { icon: makeIcon(o.hq) }).addTo(map)
          .bindPopup(\`\${o.hq ? '<span class="popup-hq">Headquarters</span>' : ''}<div class="popup-city">\${o.city}</div><div class="popup-addr">\${o.address}</div>\`);
      });
      map.fitBounds(OFFICES.map(o => [o.lat, o.lng]), { padding: [60, 60], maxZoom: 8 });
    });
  map.setView([30, 20], 2);
<\/script>
</body>
</html>`;

  fs.writeFileSync("index.html", html);
  console.log(`\nSuccessfully wrote index.html with ${offices.length} offices!`);
}

main().catch(e => { console.error(e); process.exit(1); });
