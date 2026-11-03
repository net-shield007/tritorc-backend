// Mirrors leads from the /m/ mobile landing pages into their own Google Sheets.
//
// Only requests whose `source` is listed in SOURCES are mirrored; every other
// lead (all original pages) never reaches this module. Sheet IDs, tab names and
// credentials come from environment variables, and nothing is sent until
// MOBILE_SHEETS_ENABLED=true.

const crypto = require('crypto');
const { JWT } = require('google-auth-library');

const SOURCES = {
  'htw-in-mobile': {
    label: 'Hydraulic Torque Wrench - India Mobile Leads',
    sheetIdEnv: 'INDIA_MOBILE_SHEET_ID',
    tabEnv: 'INDIA_MOBILE_SHEET_TAB',
    defaultTab: 'India Mobile Leads',
  },
  'htw-gcc-mobile': {
    label: 'Hydraulic Torque Wrench - GCC Mobile Leads',
    sheetIdEnv: 'GCC_MOBILE_SHEET_ID',
    tabEnv: 'GCC_MOBILE_SHEET_TAB',
    defaultTab: 'GCC Mobile Leads',
  },
};

const HEADERS = [
  'Submitted At', 'Submission ID', 'DB ID', 'Source', 'Name', 'Email', 'Company', 'Phone',
  'Message', 'Country Code', 'Country', 'Page Name', 'Page URL', 'Referrer',
  'Campaign ID', 'GCLID', 'GBRAID', 'GAD Source',
];

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

let authClient = null;
const headerReady = new Set();
const recent = new Map(); // dedupe key -> { at, id }

const isEnabled = () => String(process.env.MOBILE_SHEETS_ENABLED).toLowerCase() === 'true';
const getSource = (source) => (typeof source === 'string' && SOURCES[source] ? source : null);

function getTarget(source) {
  const cfg = SOURCES[source];
  const sheetId = process.env[cfg.sheetIdEnv];
  if (!sheetId || /^(INDIA|GCC)_MOBILE_SHEET_ID$/.test(sheetId)) return null; // unset or still the placeholder
  return { sheetId, tab: process.env[cfg.tabEnv] || cfg.defaultTab, label: cfg.label };
}

// The service account comes either from GOOGLE_SERVICE_ACCOUNT_JSON (the whole key file,
// as injected from AWS Secrets Manager) or from GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY.
function readServiceAccount() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json);
      return { email: parsed.client_email, key: parsed.private_key };
    } catch (err) {
      // Never include the value in the message: it holds the private key.
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
  }
  // Env vars usually carry the key with literal \n sequences.
  return {
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  };
}

function getAuth() {
  if (!authClient) {
    const { email, key } = readServiceAccount();
    if (!email || !key) {
      const err = new Error('Google service account is not configured');
      err.code = 'SHEETS_NOT_CONFIGURED';
      throw err;
    }
    authClient = new JWT({ email, key, scopes: ['https://www.googleapis.com/auth/spreadsheets'] });
  }
  return authClient;
}

// Lets tests swap in a fake client with a request({ url, method, data }) method.
function setAuthClient(client) {
  authClient = client;
}

const range = (tab, a1) => encodeURIComponent(`'${tab.replace(/'/g, "''")}'!${a1}`);

async function ensureHeader(client, { sheetId, tab }) {
  const k = `${sheetId}:${tab}`;
  if (headerReady.has(k)) return;
  const { data } = await client.request({ url: `${SHEETS_API}/${sheetId}/values/${range(tab, 'A1:A1')}` });
  if (!data.values || !data.values.length) {
    await client.request({
      url: `${SHEETS_API}/${sheetId}/values/${range(tab, 'A1')}?valueInputOption=RAW`,
      method: 'PUT',
      data: { values: [HEADERS] },
    });
  }
  headerReady.add(k);
}

// valueInputOption=RAW stores everything as plain text, so =, + or @ in user input is never run as a formula.
const cell = (v) => (v === undefined || v === null ? '' : String(v));

function buildRow({ source, submissionId, dbId, row }) {
  return [
    new Date().toISOString(), submissionId || '', dbId || '', source,
    row.name, row.email, row.company, row.phone, row.message,
    row.country_code, row.country_name, row.page_name, row.page_url, row.referrer,
    row.campaign_id, row.gclid, row.gbraid, row.gad_source,
  ].map(cell);
}

async function appendRow(target, values) {
  const client = getAuth();
  await ensureHeader(client, target);
  await client.request({
    url: `${SHEETS_API}/${target.sheetId}/values/${range(target.tab, 'A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    method: 'POST',
    data: { values: [values] },
  });
}

// The fingerprint includes the message, so a datasheet request followed by a quote
// request from the same person is not mistaken for a repeat, but a double click is.
function dedupeKeys({ source, submissionId, row }) {
  const keys = [];
  if (submissionId) keys.push(`id:${source}:${submissionId}`);
  const who = [row.email, String(row.phone || '').replace(/\D/g, ''), row.message]
    .map((v) => String(v || '').trim().toLowerCase())
    .join('|');
  keys.push(`fp:${source}:${crypto.createHash('sha1').update(who).digest('hex')}`);
  return keys;
}

function prune(now) {
  for (const [k, v] of recent) if (now - v.at > DEDUPE_WINDOW_MS) recent.delete(k);
}

// Returns the earlier submission's id if the same submission ID, or the same
// email + phone + source, was already accepted within the last 10 minutes.
function findDuplicate(input) {
  const now = Date.now();
  prune(now);
  for (const k of dedupeKeys(input)) {
    const hit = recent.get(k);
    if (hit) return { id: hit.id };
  }
  return null;
}

// Reserves the submission before the DB insert so concurrent double clicks collide.
function claim(input) {
  const entry = { at: Date.now(), id: null };
  for (const k of dedupeKeys(input)) recent.set(k, entry);
  return entry;
}

function release(input) {
  for (const k of dedupeKeys(input)) recent.delete(k);
}

// Appends the lead to its sheet. Never throws: a Sheets problem must not fail the
// visitor's submission, so failures are logged with the row for manual recovery.
async function mirrorLead(input) {
  const { source } = input;
  try {
    if (!isEnabled()) return { skipped: 'disabled' };
    const target = getTarget(source);
    if (!target) {
      console.error('Mobile sheet not configured', { source });
      return { skipped: 'not_configured' };
    }
    const values = buildRow(input);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        await appendRow(target, values);
        return { appended: true };
      } catch (err) {
        if (attempt === 2) {
          // No lead details here: the row is in the database under dbId.
          console.error('Mobile sheet append failed', { source, dbId: input.dbId, error: err.message });
          return { error: err.message };
        }
      }
    }
  } catch (err) {
    // Nothing here may reject: the caller does not await this.
    console.error('Mobile sheet mirror error', { source, dbId: input.dbId, error: err.message });
    return { error: err.message };
  }
}

// Used by the reconcile and smoke-test scripts.
async function readColumn(target, column) {
  const { data } = await getAuth().request({ url: `${SHEETS_API}/${target.sheetId}/values/${range(target.tab, `${column}:${column}`)}` });
  return (data.values || []).map((r) => r[0]);
}

module.exports = {
  SOURCES, HEADERS, getSource, getTarget, buildRow, appendRow, readColumn,
  findDuplicate, claim, release, mirrorLead, setAuthClient,
};
