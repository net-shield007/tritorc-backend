// Browser location sent with a lead (the visitor allowed it in the browser's permission prompt):
//   { latitude, longitude, location_accuracy, location_status,
//     location_city, location_region, location_country, location_country_code }
// It is saved with no schema change, as a short block at the end of the message:
//
//   GPS Location:
//   Coordinates: 24.7136, 46.6753
//   Accuracy: 35 m
//   City: Riyadh
//   Region: Riyadh Region
//   Country: Saudi Arabia
//   Country code: SA
//
// When the visitor declined (or the browser could not tell), the block holds only "Status: denied".
// Coordinates are rounded to 4 decimals (about 10 m): enough to place a visitor on a map, not to track them.
// The place name comes from a reverse-geocoding lookup the visitor's browser made; it is only kept when
// the coordinates were granted, and cleaned so it can never add lines or markup to the message.

const STATUSES = ['granted', 'denied', 'unavailable'];
const MARKER = /^[ \t]*GPS Location:[ \t]*$/im;
const LINE = /^[ \t]*(Coordinates|Accuracy|Status|City|Region|Country code|Country):[ \t]*(.*)$/i;

function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const validCoords = (lat, lng) => lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

// A place name: one line of plain text, at most 100 characters.
function cleanPlace(value) {
  if (value === null || value === undefined) return undefined;
  const text = String(value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return text || undefined;
}

const cleanCountryCode = (value) => (/^[A-Za-z]{2}$/.test(String(value || '').trim()) ? String(value).trim().toUpperCase() : undefined);

// From the request body: null when nothing usable was sent.
function parseLocation(body) {
  const status = STATUSES.includes(body.location_status) ? body.location_status : null;
  if (!status) return null;

  const lat = toNumber(body.latitude);
  const lng = toNumber(body.longitude);
  // Coordinates only count when access was granted and they are real.
  if (status !== 'granted' || !validCoords(lat, lng)) {
    return { status: status === 'granted' ? 'unavailable' : status };
  }

  const accuracy = toNumber(body.location_accuracy);
  const result = {
    status,
    latitude: Math.round(lat * 1e4) / 1e4,
    longitude: Math.round(lng * 1e4) / 1e4,
    accuracy: accuracy !== null && accuracy >= 0 ? Math.min(Math.round(accuracy), 1000000) : undefined,
    city: cleanPlace(body.location_city),
    region: cleanPlace(body.location_region),
    country: cleanPlace(body.location_country),
    countryCode: cleanCountryCode(body.location_country_code),
  };
  // Only the values that exist.
  return Object.fromEntries(Object.entries(result).filter(([, v]) => v !== undefined));
}

function appendLocation(message, location) {
  const lines = ['GPS Location:'];
  if (location.status === 'granted') {
    lines.push(`Coordinates: ${location.latitude}, ${location.longitude}`);
    if (location.accuracy !== undefined) lines.push(`Accuracy: ${location.accuracy} m`);
    if (location.city) lines.push(`City: ${location.city}`);
    if (location.region) lines.push(`Region: ${location.region}`);
    if (location.country) lines.push(`Country: ${location.country}`);
    if (location.countryCode) lines.push(`Country code: ${location.countryCode}`);
  } else {
    lines.push(`Status: ${location.status}`);
  }
  const base = typeof message === 'string' ? message.trimEnd() : '';
  return base ? `${base}\n\n${lines.join('\n')}` : lines.join('\n');
}

// Takes the block back out of a stored message: { message, location } (location is null when absent).
function splitLocation(message) {
  const text = typeof message === 'string' ? message : '';
  const match = MARKER.exec(text);
  if (!match) return { message: text, location: null };

  const lines = text.slice(match.index + match[0].length).split(/\r?\n/);
  const found = {};
  let i = lines[0] === '' ? 1 : 0;
  for (; i < lines.length; i++) {
    const m = LINE.exec(lines[i]);
    if (!m) break;
    found[m[1].toLowerCase()] = m[2].trim();
  }
  // "GPS Location:" typed by a visitor with none of our lines after it is just text.
  if (!found.coordinates && !found.status) return { message: text, location: null };

  const location = { status: found.status || 'granted' };
  if (found.coordinates) {
    const [lat, lng] = found.coordinates.split(',').map((p) => toNumber(p.trim()));
    if (validCoords(lat, lng)) {
      location.latitude = lat;
      location.longitude = lng;
    } else {
      location.status = 'unavailable';
    }
  }
  const accuracy = toNumber(String(found.accuracy || '').replace(/\s*m$/i, ''));
  if (accuracy !== null) location.accuracy = accuracy;
  if (location.latitude !== undefined) {
    if (cleanPlace(found.city)) location.city = cleanPlace(found.city);
    if (cleanPlace(found.region)) location.region = cleanPlace(found.region);
    if (cleanPlace(found.country)) location.country = cleanPlace(found.country);
    if (cleanCountryCode(found['country code'])) location.countryCode = cleanCountryCode(found['country code']);
  }

  return {
    message: `${text.slice(0, match.index)}${lines.slice(i).join('\n')}`.trim(),
    location,
  };
}

module.exports = { parseLocation, appendLocation, splitLocation };
