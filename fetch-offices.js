// This script runs inside GitHub Actions (NOT in public)
// It fetches Arton Capital's offices from Airtable and saves offices.json
const https = require("https");
const fs = require("fs");

const BASE_ID  = process.env.AIRTABLE_BASE_ID;
const TABLE_ID = process.env.AIRTABLE_TABLE_ID;
const API_KEY  = process.env.AIRTABLE_API_KEY;

if (!BASE_ID || !TABLE_ID || !API_KEY) {
  console.error("Missing environment variables. Check your GitHub Secrets.");
  process.exit(1);
}

// Geocode an address using free Nominatim API
function geocode(address) {
  return new Promise((resolve) => {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
    const req = https.get(url, { headers: { "User-Agent": "IMI-Officemap/1.0" } }, (res) => {
      let data = "";
      res.on("data", chunk => data += chunk);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.length > 0) {
            resolve({ lat: parseFloat(parsed[0].lat), lng: parseFloat(parsed[0].lon) });
          } else {
            resolve(null);
          }
        } catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractCity(address) {
  const parts = address.split(",").map(p => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 2];
  return parts[0] || "Office";
}

async function main() {
  // Fetch all records from Airtable
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

  // Find the Arton Capital row
  const artonRecord = records.find(r => 
    r.fields["Name"] && r.fields["Name"].toLowerCase().includes("arton capital")
  );

  if (!artonRecord) {
    console.error("Could not find Arton Capital in the table!");
    process.exit(1);
  }

  console.log("Found Arton Capital record!");

  // Get the office locations field
  const rawLocations = artonRecord.fields["Office Location(s)"];
  if (!rawLocations) {
    console.error("Office Location(s) field is empty for Arton Capital!");
    process.exit(1);
  }

  // Split by new line to get individual addresses
  const addresses = rawLocations.split("\n").map(a => a.trim()).filter(Boolean);
  console.log(`Found ${addresses.length} office addresses`);

  const offices = [];

  for (const rawAddress of addresses) {
    const isHq = rawAddress.toUpperCase().startsWith("HQ");
    const cleanAddress = rawAddress.replace(/^HQ\s*/i, "").trim();
    const city = extractCity(cleanAddress);

    console.log(`Geocoding: ${city}...`);
    await sleep(1100); // Respect Nominatim rate limit (1 request/second)

    const coords = await geocode(cleanAddress);
    if (!coords) {
      console.warn(`Could not geocode: ${cleanAddress}`);
      continue;
    }

    offices.push({ city, address: cleanAddress, lat: coords.lat, lng: coords.lng, hq: isHq });
    console.log(`  ✓ ${city}: ${coords.lat}, ${coords.lng}`);
  }

  fs.writeFileSync("offices.json", JSON.stringify(offices, null, 2));
  console.log(`\nSaved ${offices.length} offices to offices.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
