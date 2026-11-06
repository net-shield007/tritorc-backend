// Visitor details sent with a lead (what kind of device and browser, and how the visit went):
//   { device_type, browser_language, time_zone, visit_started_at, pages_viewed }
// Saved with no schema change, as a short block at the end of the message:
//
//   Visitor:
//   Device: mobile
//   Language: ar-SA
//   Time zone: Asia/Riyadh
//   First seen: 2026-11-04T09:12:33.000Z
//   Pages: 3
//
// Every value is checked before it is stored, so the block can only ever hold these five plain lines.

const DEVICES = ['mobile', 'tablet', 'desktop'];
const MARKER = /^[ \t]*Visitor:[ \t]*$/im;
const LINE = /^[ \t]*(Device|Language|Time zone|First seen|Pages):[ \t]*(.*)$/i;
const MAX_VISIT_AGE_MS = 30 * 24 * 60 * 60 * 1000; // a visit that started more than 30 days ago is not believable
const CLOCK_SKEW_MS = 5 * 60 * 1000;

const LANGUAGE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;
const TIME_ZONE = /^[A-Za-z0-9_+\-/]{1,64}$/;

function cleanFirstSeen(value, now) {
  const t = Date.parse(value);
  if (!Number.isFinite(t) || t > now + CLOCK_SKEW_MS || t < now - MAX_VISIT_AGE_MS) return undefined;
  return new Date(t).toISOString();
}

// From the request body: null when nothing usable was sent.
function parseVisitor(body, now = Date.now()) {
  const visitor = {};
  if (DEVICES.includes(body.device_type)) visitor.device = body.device_type;

  const language = String(body.browser_language || '').trim();
  if (LANGUAGE.test(language)) visitor.language = language;

  const timeZone = String(body.time_zone || '').trim();
  if (TIME_ZONE.test(timeZone)) visitor.timeZone = timeZone;

  const firstSeen = body.visit_started_at ? cleanFirstSeen(body.visit_started_at, now) : undefined;
  if (firstSeen) visitor.firstSeen = firstSeen;

  const pages = Number(body.pages_viewed);
  if (Number.isInteger(pages) && pages >= 1 && pages <= 999) visitor.pages = pages;

  return Object.keys(visitor).length ? visitor : null;
}

function appendVisitor(message, visitor) {
  const lines = ['Visitor:'];
  if (visitor.device) lines.push(`Device: ${visitor.device}`);
  if (visitor.language) lines.push(`Language: ${visitor.language}`);
  if (visitor.timeZone) lines.push(`Time zone: ${visitor.timeZone}`);
  if (visitor.firstSeen) lines.push(`First seen: ${visitor.firstSeen}`);
  if (visitor.pages) lines.push(`Pages: ${visitor.pages}`);
  const base = typeof message === 'string' ? message.trimEnd() : '';
  return base ? `${base}\n\n${lines.join('\n')}` : lines.join('\n');
}

// Takes the block back out of a stored message: { message, visitor } (visitor is null when absent).
function splitVisitor(message) {
  const text = typeof message === 'string' ? message : '';
  const match = MARKER.exec(text);
  if (!match) return { message: text, visitor: null };

  const lines = text.slice(match.index + match[0].length).split(/\r?\n/);
  const found = {};
  let i = lines[0] === '' ? 1 : 0;
  for (; i < lines.length; i++) {
    const m = LINE.exec(lines[i]);
    if (!m) break;
    found[m[1].toLowerCase()] = m[2].trim();
  }
  // "Visitor:" typed by a visitor with none of our lines after it is just text.
  if (!Object.keys(found).length) return { message: text, visitor: null };

  const visitor = {};
  if (DEVICES.includes(found.device)) visitor.device = found.device;
  if (LANGUAGE.test(found.language || '')) visitor.language = found.language;
  if (TIME_ZONE.test(found['time zone'] || '')) visitor.timeZone = found['time zone'];
  if (Number.isFinite(Date.parse(found['first seen']))) visitor.firstSeen = new Date(Date.parse(found['first seen'])).toISOString();
  const pages = Number(found.pages);
  if (Number.isInteger(pages) && pages >= 1 && pages <= 999) visitor.pages = pages;

  return {
    message: `${text.slice(0, match.index)}${lines.slice(i).join('\n')}`.trim(),
    visitor,
  };
}

module.exports = { parseVisitor, appendVisitor, splitVisitor };
