// Numbers, filter lists, new-lead check and CSV export for the PPC admin dashboard.
const knexConfig = require('../knexfile').development;
const knex = require('knex')(knexConfig);
const { schemaCheck } = require('../utils/schemaCheck');
const { parseListQuery, applyFilters, sortColumn, parseDate } = require('../utils/ppcQuery');
const { parseLeadSource } = require('../utils/leadSource');
const { splitLocation } = require('../utils/location');
const { splitMessage } = require('../utils/messageParts');

const TABLE = 'ppc_contact_submissions';
const DAY = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;
const MAX_STATS_ROWS = 100000;
const MAX_EXPORT_ROWS = 50000;
const COUNTED_STATUSES = ['new', 'contacted', 'qualified', 'hot', 'closed'];

const hasLeadColumns = schemaCheck(() => knex.schema.hasColumn(TABLE, 'campaign_id'));
const hasEmailLog = schemaCheck(() => knex.schema.hasTable('ppc_email_log'));
const hasFirstContacted = schemaCheck(() => knex.schema.hasColumn(TABLE, 'first_contacted_at'));
const hasIpCountry = schemaCheck(() => knex.schema.hasColumn(TABLE, 'ip_country_code'));

// created_at is a timestamp without time zone stored in UTC, so compare using UTC text.
const iso = (d) => d.toISOString();

function validTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return tz;
  } catch (e) {
    return 'UTC';
  }
}

const dayKey = (date, tz) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

// Every calendar day (in the viewer's time zone) between from and to, in order.
function listDays(from, to, tz) {
  const keys = [];
  const seen = new Set();
  const add = (d) => {
    const k = dayKey(d, tz);
    if (!seen.has(k)) {
      seen.add(k);
      keys.push(k);
    }
  };
  for (let t = from.getTime(); t < to.getTime(); t += 6 * 60 * 60 * 1000) add(new Date(t)); // 6 h steps survive DST changes
  add(new Date(to.getTime() - 1));
  return keys;
}

function median(sorted) {
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function topList(map, n = 10) {
  return [...map.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.total - a.total || String(a.key).localeCompare(String(b.key)))
    .slice(0, n);
}

function bump(map, key, status) {
  const row = map.get(key) || { total: 0, qualified: 0, hot: 0 };
  row.total += 1;
  if (status === 'qualified') row.qualified += 1;
  if (status === 'hot') row.hot += 1;
  map.set(key, row);
}

// GET /stats?from&to&tz
exports.getStats = async (req, res, next) => {
  try {
    const tz = validTimeZone(req.query.tz || 'UTC');
    const to = parseDate(req.query.to, { endOfDay: true }) || new Date();
    const from = parseDate(req.query.from) || new Date(to.getTime() - 30 * DAY);
    if ((req.query.from && !parseDate(req.query.from)) || (req.query.to && !parseDate(req.query.to))) {
      return res.status(400).json({ error: 'Invalid date. Use YYYY-MM-DD or an ISO date-time' });
    }
    if (from >= to) return res.status(400).json({ error: '"from" must be before "to"' });
    if (to - from > MAX_RANGE_DAYS * DAY) return res.status(400).json({ error: `Range is limited to ${MAX_RANGE_DAYS} days` });

    const span = to - from;
    const previousFrom = new Date(from.getTime() - span);

    const leadCols = await hasLeadColumns();
    const contacted = await hasFirstContacted();
    const columns = ['id', 'status', 'created_at'];
    if (leadCols) columns.push('country_name', 'campaign_id', 'page_name');
    if (contacted) columns.push('first_contacted_at');

    const rows = await knex(TABLE)
      .select(columns)
      .where({ is_active: true })
      .where('created_at', '>=', iso(previousFrom))
      .where('created_at', '<', iso(to))
      .limit(MAX_STATS_ROWS);

    const byStatus = Object.fromEntries(COUNTED_STATUSES.map((s) => [s, 0]));
    const previousByStatus = { ...byStatus };
    const dailyCounts = new Map();
    const campaigns = new Map();
    const countries = new Map();
    const pages = new Map();
    const minutes = [];
    let total = 0;
    let previousTotal = 0;
    let spam = 0;

    for (const r of rows) {
      const created = new Date(r.created_at);
      const current = created >= from;
      if (r.status === 'spam') {
        if (current) spam += 1;
        continue;
      }
      if (!current) {
        previousTotal += 1;
        if (r.status in previousByStatus) previousByStatus[r.status] += 1;
        continue;
      }
      total += 1;
      if (r.status in byStatus) byStatus[r.status] += 1;
      const day = dayKey(created, tz);
      dailyCounts.set(day, (dailyCounts.get(day) || 0) + 1);
      bump(campaigns, r.campaign_id || '(none)', r.status);
      bump(countries, r.country_name || 'Unknown', r.status);
      bump(pages, r.page_name || 'Unknown', r.status);
      if (r.first_contacted_at) {
        const ms = new Date(r.first_contacted_at) - created;
        if (ms >= 0) minutes.push(Math.round(ms / 60000));
      }
    }
    minutes.sort((a, b) => a - b);

    // Leads still waiting for a first touch, whatever the date range: the "needs attention" list.
    const waitingCols = ['id', 'name', 'email', 'created_at'];
    if (leadCols) waitingCols.push('country_name', 'campaign_id');
    const waiting = () => knex(TABLE).where({ is_active: true, status: 'new' });
    const [{ count: newTotal }] = await waiting().count('* as count');
    const oldest = await waiting().select(waitingCols).orderBy('created_at', 'asc').limit(10);

    res.json({
      range: { from: from.toISOString(), to: to.toISOString(), previousFrom: previousFrom.toISOString(), tz },
      totals: { total, previousTotal, byStatus, previousByStatus, spam },
      daily: listDays(from, to, tz).map((date) => ({ date, count: dailyCounts.get(date) || 0 })),
      byCampaign: topList(campaigns),
      byCountry: topList(countries),
      byPage: topList(pages),
      response: contacted
        ? {
            measured: minutes.length,
            medianMinutes: median(minutes),
            averageMinutes: minutes.length ? Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length) : null,
          }
        : null,
      attention: { newTotal: parseInt(newTotal, 10), oldest },
    });
  } catch (err) {
    next(err);
  }
};

// GET /facets : the values the filter dropdowns offer
exports.getFacets = async (req, res, next) => {
  try {
    if (!(await hasLeadColumns())) return res.json({ countries: [], campaigns: [], pages: [] });
    const facet = (column) =>
      knex(TABLE)
        .select(`${column} as value`)
        .count('* as count')
        .where({ is_active: true })
        .whereNot('status', 'spam')
        .whereNotNull(column)
        .whereNot(column, '')
        .groupBy(column)
        .orderBy('count', 'desc')
        .limit(100);
    const [countries, campaigns, pages] = await Promise.all([facet('country_name'), facet('campaign_id'), facet('page_name')]);
    const clean = (list) => list.map((r) => ({ value: r.value, count: parseInt(r.count, 10) }));
    res.json({ countries: clean(countries), campaigns: clean(campaigns), pages: clean(pages) });
  } catch (err) {
    next(err);
  }
};

// GET /new-count?since=<iso> : how many leads arrived after "since", and the newest one
exports.getNewCount = async (req, res, next) => {
  try {
    const since = req.query.since ? parseDate(req.query.since) : null;
    if (req.query.since && !since) return res.status(400).json({ error: 'Invalid since. Use an ISO date-time' });

    const leadCols = await hasLeadColumns();
    const visible = () => knex(TABLE).where({ is_active: true }).whereNot('status', 'spam');

    let count = 0;
    if (since) {
      const [row] = await visible().where('created_at', '>', iso(since)).count('* as count');
      count = parseInt(row.count, 10);
    }
    const latest = await visible()
      .select(['id', 'name', 'created_at', ...(leadCols ? ['country_name'] : [])])
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .first();

    res.json({ count, latest: latest || null });
  } catch (err) {
    next(err);
  }
};

/* ---------------- CSV export ---------------- */

const PHONE_LIKE = /^\+[0-9][0-9 ()\-.]*$/;
const NUMBER_LIKE = /^-?\d+(\.\d+)?$/;

// Quotes every cell. A cell that starts with = + - @ could run as a formula when the file is opened
// in a spreadsheet, so it gets a leading apostrophe (phone numbers and plain numbers are left alone).
function cell(value) {
  let s = value === null || value === undefined ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !PHONE_LIKE.test(s) && !NUMBER_LIKE.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const CSV_COLUMNS = [
  'id', 'received_at', 'name', 'email', 'phone', 'country_code', 'country', 'company', 'status',
  'campaign_id', 'page_name', 'page_url', 'referrer', 'gclid', 'gbraid', 'gad_source',
  'replies_sent', 'latitude', 'longitude', 'location_accuracy_m', 'location_status',
  'location_city', 'location_region', 'location_country',
  'device', 'browser_language', 'time_zone', 'first_seen_at', 'pages_viewed', 'seconds_to_submit', 'message',
];

// GET /export : same filters as the list, no paging
exports.exportCsv = async (req, res, next) => {
  try {
    const parsed = parseListQuery(req.query);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const f = parsed.filters;
    const has = { leadColumns: await hasLeadColumns(), emailLog: await hasEmailLog() };

    const rows = await applyFilters(knex(TABLE).select(`${TABLE}.*`), f, has)
      .orderBy(sortColumn(f, has), f.order)
      .orderBy(`${TABLE}.id`, 'desc')
      .limit(MAX_EXPORT_ROWS);

    const replies = new Map();
    if (has.emailLog && rows.length) {
      const sent = await knex('ppc_email_log').select('submission_id', 'template').where({ status: 'sent' }).orderBy('created_at', 'asc');
      for (const r of sent) replies.set(r.submission_id, [...(replies.get(r.submission_id) || []), r.template]);
    }

    const lines = [CSV_COLUMNS.map(cell).join(',')];
    for (const r of rows) {
      const { message: text, location, visitor } = splitMessage(r.message);
      const seconds =
        visitor && visitor.firstSeen ? Math.max(0, Math.round((new Date(r.created_at) - new Date(visitor.firstSeen)) / 1000)) : '';
      lines.push(
        [
          r.id, r.created_at, r.name, r.email, r.phone, r.country_code, r.country_name, r.company, r.status,
          r.campaign_id, r.page_name, r.page_url, r.referrer, r.gclid, r.gbraid, r.gad_source,
          (replies.get(r.id) || []).join(' '),
          location && location.latitude, location && location.longitude, location && location.accuracy, location && location.status,
          location && location.city, location && location.region, location && location.country,
          visitor && visitor.device, visitor && visitor.language, visitor && visitor.timeZone, visitor && visitor.firstSeen, visitor && visitor.pages, seconds,
          text,
        ].map(cell).join(',')
      );
    }

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ppc-leads-${new Date().toISOString().slice(0, 10)}.csv"`);
    // The byte-order mark makes Excel read the file as UTF-8 (Arabic names, accents).
    res.send(`﻿${lines.join('\r\n')}\r\n`);
  } catch (err) {
    next(err);
  }
};

/* ---------------- Map ---------------- */

const MAP_SCAN_LIMIT = 5000;

// GET /map : leads that have a browser location, for the dashboard map. Same filters as the list.
// The location lives in the message text, so rows are read and parsed here (newest first, at most
// MAP_SCAN_LIMIT leads are looked at).
exports.getMapPoints = async (req, res, next) => {
  try {
    const parsed = parseListQuery(req.query);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const f = parsed.filters;
    const has = { leadColumns: await hasLeadColumns(), emailLog: await hasEmailLog() };

    const columns = [`${TABLE}.id`, 'name', 'email', 'company', 'status', `${TABLE}.created_at`, 'message'];
    if (has.leadColumns) columns.push('country_name', 'country_code');
    const ipColumn = await hasIpCountry();
    if (ipColumn) columns.push('ip_country_code');

    const rows = await applyFilters(knex(TABLE).select(columns), f, has)
      .orderBy(`${TABLE}.created_at`, 'desc')
      .orderBy(`${TABLE}.id`, 'desc')
      .limit(MAP_SCAN_LIMIT);

    const points = [];
    // Leads with no GPS fall back to a country: where the request came from, else the phone's country.
    const byCountry = new Map();
    for (const r of rows) {
      const { location } = splitLocation(r.message);
      if (!location || location.latitude === undefined) {
        const code = String(r.ip_country_code || r.country_code || '').toUpperCase();
        if (/^[A-Z]{2}$/.test(code)) {
          const entry = byCountry.get(code) || { code, name: null, count: 0, leads: [] };
          entry.count += 1;
          if (!entry.name && r.country_name) entry.name = r.country_name;
          if (entry.leads.length < 20) {
            entry.leads.push({ id: r.id, name: r.name, email: r.email, status: r.status, created_at: r.created_at });
          }
          byCountry.set(code, entry);
        }
        continue;
      }
      points.push({
        id: r.id,
        name: r.name,
        email: r.email,
        company: r.company,
        status: r.status,
        created_at: r.created_at,
        country: r.country_name || null,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy === undefined ? null : location.accuracy,
        city: location.city || null,
        region: location.region || null,
        place_country: location.country || null,
      });
    }

    const countries = [...byCountry.values()].sort((a, b) => b.count - a.count);
    res.json({
      points,
      countries,
      scanned: rows.length,
      withLocation: points.length,
      countryOnly: countries.reduce((n, c) => n + c.count, 0),
      truncated: rows.length === MAP_SCAN_LIMIT,
    });
  } catch (err) {
    next(err);
  }
};
