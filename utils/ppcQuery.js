// Filtering, sorting and paging for the PPC leads list and the CSV export.
// Query string in, safe knex conditions out: only whitelisted columns are ever used.

const STATUSES = ['new', 'contacted', 'qualified', 'hot', 'closed', 'spam'];
const SORTABLE = ['created_at', 'updated_at', 'name', 'status', 'country_name', 'campaign_id'];
const MAX_LIMIT = 100;

const csv = (value) =>
  String(value === undefined || value === null ? '' : value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

// "2026-11-05" is a whole day (UTC); a full ISO time is taken as given. Returns a Date or null.
function parseDate(value, { endOfDay = false } = {}) {
  if (!value) return null;
  const str = String(value).trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str);
  const d = new Date(dateOnly ? `${str}T00:00:00.000Z` : str);
  if (Number.isNaN(d.getTime())) return null;
  if (dateOnly && endOfDay) d.setUTCDate(d.getUTCDate() + 1); // the "to" day is included
  return d;
}

// Returns { filters } or { error } so the controller can answer 400 instead of 500.
function parseListQuery(query) {
  const q = query || {};

  const status = csv(q.status);
  const badStatus = status.find((s) => !STATUSES.includes(s));
  if (badStatus) return { error: `Invalid status "${badStatus}". Allowed: ${STATUSES.join(', ')}` };

  const sort = q.sort || q.orderBy || 'created_at';
  if (!SORTABLE.includes(sort)) return { error: `Invalid sort. Allowed: ${SORTABLE.join(', ')}` };
  const order = String(q.order || 'desc').toLowerCase();
  if (order !== 'asc' && order !== 'desc') return { error: 'Invalid order. Allowed: asc, desc' };

  const from = q.from ? parseDate(q.from) : null;
  const to = q.to ? parseDate(q.to, { endOfDay: true }) : null;
  if ((q.from && !from) || (q.to && !to)) return { error: 'Invalid date. Use YYYY-MM-DD or an ISO date-time' };

  const replied = q.replied === 'yes' || q.replied === 'no' ? q.replied : undefined;
  if (q.replied && !replied) return { error: 'Invalid replied. Allowed: yes, no' };

  let page = parseInt(q.page, 10);
  let limit = parseInt(q.limit, 10);
  page = Number.isInteger(page) && page > 0 ? page : 1;
  limit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : 10;

  return {
    filters: {
      q: String(q.q || '').trim().slice(0, 100),
      status,
      country: csv(q.country),
      campaign: csv(q.campaign),
      pageName: csv(q.page_name),
      from,
      to,
      replied,
      sort,
      order,
      page,
      limit,
    },
  };
}

const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// has: { leadColumns, emailLog } says which optional parts of the schema exist yet.
function applyFilters(qb, f, has) {
  qb.where('ppc_contact_submissions.is_active', true);

  // Spam stays out of every view unless it is asked for.
  if (f.status.length) qb.whereIn('ppc_contact_submissions.status', f.status);
  else qb.whereNot('ppc_contact_submissions.status', 'spam');

  if (f.q) {
    const like = `%${escapeLike(f.q)}%`;
    qb.where((w) => {
      w.whereILike('name', like)
        .orWhereILike('email', like)
        .orWhereILike('company', like)
        .orWhereILike('phone', like)
        .orWhereILike('message', like);
    });
  }
  if (f.from) qb.where('ppc_contact_submissions.created_at', '>=', f.from.toISOString());
  if (f.to) qb.where('ppc_contact_submissions.created_at', '<', f.to.toISOString());

  if (has.leadColumns) {
    if (f.country.length) qb.whereIn('country_name', f.country);
    if (f.campaign.length) qb.whereIn('campaign_id', f.campaign);
    if (f.pageName.length) qb.whereIn('page_name', f.pageName);
  }

  if (f.replied && has.emailLog) {
    // Leads that have (or have not) had at least one reply sent successfully.
    const sent = (sub) => sub.select('submission_id').from('ppc_email_log').where('status', 'sent');
    if (f.replied === 'yes') qb.whereIn('ppc_contact_submissions.id', sent);
    else qb.whereNotIn('ppc_contact_submissions.id', sent);
  }
  return qb;
}

// Sort column must exist in this database; the lead-capture ones only after that migration.
function sortColumn(f, has) {
  const needsCapture = f.sort === 'country_name' || f.sort === 'campaign_id';
  return needsCapture && !has.leadColumns ? 'created_at' : f.sort;
}

module.exports = { STATUSES, SORTABLE, MAX_LIMIT, parseListQuery, applyFilters, sortColumn, parseDate };
