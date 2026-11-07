// Visitor map data: who is looking at the site and from where (consented visitors only; the front end
// sends nothing unless analytics cookies were accepted). No IP address is read or stored.
const knexConfig = require('../knexfile').development;
const knex = require('knex')(knexConfig);
const { schemaCheck } = require('../utils/schemaCheck');
const { ipCountryCode } = require('../utils/ipCountry');

const hasVisits = schemaCheck(() => knex.schema.hasTable('visits'));

const clean = (value, max) => {
  if (value === undefined || value === null) return undefined;
  const str = String(value).trim();
  return str ? str.slice(0, max) : undefined;
};

// A session may ping at most 120 times an hour (page changes); the table is swept so it stays small.
const pings = new Map();
function allowed(sessionId) {
  const now = Date.now();
  if (pings.size > 20000) {
    for (const [k, v] of pings) if (now - v.start > 3600000) pings.delete(k);
  }
  const entry = pings.get(sessionId);
  if (!entry || now - entry.start > 3600000) {
    pings.set(sessionId, { start: now, n: 1 });
    return true;
  }
  entry.n += 1;
  return entry.n <= 120;
}

const num = (v, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
};

// POST /api/visit : create or update the row for this browser session.
exports.recordVisit = async (req, res, next) => {
  try {
    const sessionId = clean(req.body.session_id, 64);
    if (!sessionId || !/^[A-Za-z0-9_-]{8,64}$/.test(sessionId)) return res.status(400).json({ error: 'Invalid session' });
    if (!allowed(sessionId)) return res.status(429).json({ error: 'Too many requests' });
    if (!(await hasVisits())) return res.status(204).end();

    const status = ['granted', 'denied', 'unavailable'].includes(req.body.location_status) ? req.body.location_status : undefined;
    const lat = status === 'granted' ? num(req.body.latitude, -90, 90) : undefined;
    const lng = status === 'granted' ? num(req.body.longitude, -180, 180) : undefined;
    const hasCoords = lat !== undefined && lng !== undefined;

    const fields = {
      ip_country_code: ipCountryCode(req),
      location_status: status,
      latitude: hasCoords ? Number(lat.toFixed(4)) : undefined,
      longitude: hasCoords ? Number(lng.toFixed(4)) : undefined,
      accuracy: hasCoords ? num(req.body.location_accuracy, 0, 1e7) : undefined,
      location_country: hasCoords ? clean(req.body.location_country, 100) : undefined,
    };
    Object.keys(fields).forEach((k) => fields[k] === undefined && delete fields[k]);

    const existing = await knex('visits').where({ session_id: sessionId }).first('id');
    if (existing) {
      await knex('visits')
        .where({ id: existing.id })
        .update({ ...fields, pages: knex.raw('pages + 1'), last_seen: knex.fn.now() });
    } else {
      await knex('visits')
        .insert({
          session_id: sessionId,
          landing_page: clean(req.body.landing_page, 500),
          referrer: clean(req.body.referrer, 500),
          ...fields,
        })
        .onConflict('session_id')
        .ignore();
    }
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

const MAP_LIMIT = 5000;

// GET /api/visit/map?from=&to= : visitors for the dashboard map (exact points, plus counts per country).
exports.getVisitMap = async (req, res, next) => {
  try {
    if (!(await hasVisits())) return res.json({ points: [], countries: [], total: 0 });
    const q = knex('visits').select('id', 'ip_country_code', 'latitude', 'longitude', 'accuracy', 'location_country', 'landing_page', 'first_seen');
    const from = req.query.from && new Date(req.query.from);
    const to = req.query.to && new Date(req.query.to);
    if (from && !isNaN(from)) q.where('first_seen', '>=', from);
    if (to && !isNaN(to)) q.where('first_seen', '<', to);
    const rows = await q.orderBy('first_seen', 'desc').limit(MAP_LIMIT);

    const points = [];
    const byCountry = new Map();
    for (const r of rows) {
      if (r.latitude !== null && r.longitude !== null) {
        points.push({
          id: r.id,
          latitude: Number(r.latitude),
          longitude: Number(r.longitude),
          country: r.location_country || r.ip_country_code || null,
          landing_page: r.landing_page,
          first_seen: r.first_seen,
        });
      } else if (r.ip_country_code) {
        byCountry.set(r.ip_country_code, (byCountry.get(r.ip_country_code) || 0) + 1);
      }
    }
    const countries = [...byCountry].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count);
    res.json({ points, countries, total: rows.length, truncated: rows.length === MAP_LIMIT });
  } catch (err) {
    next(err);
  }
};
