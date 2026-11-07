const knexConfig = require('../knexfile').development;
const knex = require('knex')(knexConfig);
const { parseLeadSource, parseTrackingParams, cleanCampaignId } = require('../utils/leadSource');
const { parseLocation, appendLocation } = require('../utils/location');
const { parseVisitor, appendVisitor } = require('../utils/visitor');
const { splitMessage } = require('../utils/messageParts');
const { parseListQuery, applyFilters, sortColumn } = require('../utils/ppcQuery');
const { sendMail, isValidEmail } = require('../utils/mailer');
const { TEMPLATES, renderReply } = require('../utils/replyTemplates');
const { getCustom } = require('../utils/templateStore');
const { translateToEnglish } = require('../utils/translate');
const mobileSheets = require('../utils/mobileSheets');
const { ipCountryCode } = require('../utils/ipCountry');

// The lead-capture migration may not have been run yet when this code is deployed.
// Remember whether the new columns / log table exist, rechecking a missing one at most once a minute.
function schemaCheck(check) {
  let found = false;
  let checkedAt = 0;
  return async () => {
    if (found) return true;
    if (Date.now() - checkedAt < 60000) return false;
    checkedAt = Date.now();
    try {
      found = await check();
    } catch (err) {
      found = false;
    }
    return found;
  };
}
const hasLeadColumns = schemaCheck(() => knex.schema.hasColumn('ppc_contact_submissions', 'campaign_id'));
const hasEmailLog = schemaCheck(() => knex.schema.hasTable('ppc_email_log'));
const hasIpCountry = schemaCheck(() => knex.schema.hasColumn('ppc_contact_submissions', 'ip_country_code'));
const hasFirstContacted = schemaCheck(() => knex.schema.hasColumn('ppc_contact_submissions', 'first_contacted_at'));

const clean = (value, max) => {
  if (value === undefined || value === null) return undefined;
  const str = String(value).trim();
  return str ? str.slice(0, max) : undefined;
};

// Messages being replied to right now, so a double click cannot send twice.
const replyInFlight = new Set();

exports.createPPCSubmission = async (req, res, next) => {
  const { name, email, company, phone, message } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  // Only the /m/ mobile landing pages send a recognised `source`; every other caller skips all of this.
  const mobile = mobileSheets.getSource(req.body.source);
  let mobileInput = null;
  let claimed = null;
  if (mobile) {
    const parsed = parseLeadSource(message);
    const pageUrl = clean(req.body.page_url, 2000) || parsed.source.page_url;
    mobileInput = {
      source: mobile,
      submissionId: clean(req.body.submission_id, 100),
      row: {
        name, email, company, phone,
        message: parsed.message,
        country_code: clean(req.body.country_code, 10),
        country_name: clean(req.body.country_name, 100),
        page_name: parsed.source.page_name,
        page_url: pageUrl,
        referrer: parsed.source.referrer,
        ...parseTrackingParams(pageUrl),
      },
    };
    const duplicate = mobileSheets.findDuplicate(mobileInput);
    if (duplicate) return res.status(200).json({ id: duplicate.id, duplicate: true });
    claimed = mobileSheets.claim(mobileInput);

    // The in-memory check above resets on restart and is per instance, so also look for the
    // same email + message in the last 10 minutes in the database (the message carries the page URL).
    try {
      const recent = await knex('ppc_contact_submissions')
        .where('email', email)
        .andWhere('message', message || '')
        .andWhere('created_at', '>', new Date(Date.now() - 10 * 60 * 1000))
        .first('id');
      if (recent) {
        claimed.id = recent.id;
        return res.status(200).json({ id: recent.id, duplicate: true });
      }
    } catch (err) {
      // If the lookup fails, accept the lead rather than lose it.
    }
  }

  try {
    const row = { name, email, company, phone, message };

    // Once the lead-capture migration has run, keep the message clean and store the
    // source details in their own columns. Until then, save the message untouched.
    if (await hasLeadColumns()) {
      const parsed = parseLeadSource(message);
      const body = req.body;
      const pageUrl = clean(body.page_url, 2000) || parsed.source.page_url;
      const tracking = parseTrackingParams(pageUrl);

      Object.assign(row, {
        message: parsed.message,
        country_code: clean(body.country_code, 10),
        country_name: clean(body.country_name, 100),
        campaign_id: cleanCampaignId(body.campaign_id) || tracking.campaign_id,
        page_name: clean(body.page_name, 500) || parsed.source.page_name,
        page_url: pageUrl,
        referrer: clean(body.referrer, 2000) || parsed.source.referrer,
        gclid: clean(body.gclid, 500) || tracking.gclid,
        gbraid: clean(body.gbraid, 500) || tracking.gbraid,
        gad_source: clean(body.gad_source, 20) || tracking.gad_source,
      });
    }

    // Browser location (optional, no form field): saved as a block at the end of the message.
    const visitor = parseVisitor(req.body);
    if (visitor) row.message = appendVisitor(row.message, visitor);
    const location = parseLocation(req.body);
    if (location) {
      row.message = appendLocation(row.message, location);
      // Where the visitor is wins over the phone's country; without location the phone's country stays.
      if (location.country && (await hasLeadColumns())) row.country_name = location.country;
    }

    // Country of the request (proxy header, no IP stored): the map's fallback when there is no GPS.
    const ipCountry = ipCountryCode(req);
    if (ipCountry && (await hasIpCountry())) row.ip_country_code = ipCountry;

    const [id] = await knex('ppc_contact_submissions')
      .insert(row)
      .returning('id');

    if (mobileInput) {
      claimed.id = typeof id === 'object' && id !== null ? id.id : id;
      // Not awaited: the sheet is a mirror, the DB row above is the record.
      mobileSheets.mirrorLead({ ...mobileInput, dbId: claimed.id });
    }

    res.status(201).json({ id });
  } catch (err) {
    if (mobileInput) mobileSheets.release(mobileInput);
    next(err);
  }
};

exports.getPPCSubmissions = async (req, res, next) => {
  try {
    // Filters, sort and paging come from the query string (see utils/ppcQuery.js); bad values answer 400.
    const parsed = parseListQuery(req.query);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const f = parsed.filters;
    const has = { leadColumns: await hasLeadColumns(), emailLog: await hasEmailLog() };
    const { page, limit } = f;

    const submissions = await applyFilters(knex('ppc_contact_submissions').select('ppc_contact_submissions.*'), f, has)
      .orderBy(sortColumn(f, has), f.order)
      .orderBy('ppc_contact_submissions.id', 'desc')
      .limit(limit)
      .offset((page - 1) * limit);

    const [{ count }] = await applyFilters(knex('ppc_contact_submissions'), f, has).count('* as count');

    // Replies already sent, so the admin can show a "sent" marker next to each button
    if (submissions.length && (await hasEmailLog())) {
      const sent = await knex('ppc_email_log')
        .select('submission_id', 'template', 'created_at')
        .where({ status: 'sent' })
        .whereIn('submission_id', submissions.map((s) => s.id))
        .orderBy('created_at', 'asc');
      for (const s of submissions) {
        s.replies = sent
          .filter((r) => r.submission_id === s.id)
          .map((r) => ({ template: r.template, sent_at: r.created_at }));
      }
    }

    res.status(200).json({
      data: submissions,
      pagination: {
        total: parseInt(count, 10),
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.updatePPCStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = ["new", "contacted", "qualified", "hot", "closed", "spam"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed statuses: ${allowedStatuses.join(", ")}` });
    }

    const changes = { status, updated_at: knex.fn.now() };
    // The first time a lead is worked on, remember when (used for the response-time numbers).
    if (['contacted', 'qualified', 'hot'].includes(status) && (await hasFirstContacted())) {
      changes.first_contacted_at = knex.raw('COALESCE(first_contacted_at, now())');
    }

    const updated = await knex('ppc_contact_submissions').where({ id }).update(changes);

    if (!updated) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    res.status(200).json({ message: 'Status updated successfully', id, status });
  } catch (err) {
    next(err);
  }
};

// POST /:id/reply  { template, force }
exports.sendPPCReply = async (req, res, next) => {
  const id = parseInt(req.params.id, 10);
  const { template, force } = req.body;

  if (!Number.isInteger(id)) {
    return res.status(400).json({ error: 'Invalid id' });
  }
  if (!TEMPLATES.includes(template)) {
    return res.status(400).json({ error: `Invalid template. Allowed templates: ${TEMPLATES.join(', ')}` });
  }

  const key = `${id}:${template}`;
  if (replyInFlight.has(key)) {
    return res.status(409).json({ error: 'This reply is already being sent' });
  }
  replyInFlight.add(key);

  try {
    if (!(await hasEmailLog())) {
      return res.status(503).json({ error: 'Email log table is missing. Run the latest migration first.' });
    }

    const lead = await knex('ppc_contact_submissions').where({ id, is_active: true }).first();
    if (!lead) {
      return res.status(404).json({ error: 'Submission not found' });
    }
    if (!isValidEmail(lead.email)) {
      return res.status(400).json({ error: 'This lead has no valid email address' });
    }

    if (force !== true) {
      const previous = await knex('ppc_email_log')
        .where({ submission_id: id, template, status: 'sent' })
        .orderBy('created_at', 'desc')
        .first();
      if (previous) {
        return res.status(409).json({
          error: 'This reply was already sent to this lead',
          sent_at: previous.created_at,
        });
      }
    }

    // Older rows still carry the "Lead Source:" block in the message.
    const { subject, text, html } = renderReply(
      template,
      { name: lead.name, company: lead.company, message: splitMessage(lead.message).message },
      await getCustom(template) // wording saved in the dashboard settings, if any
    );
    const to = lead.email.trim();
    const log = { submission_id: id, template, to_email: to, sent_by: req.user && req.user.email };

    try {
      const info = await sendMail({ to, subject, text, html });
      await knex('ppc_email_log').insert({ ...log, status: 'sent', message_id: info.messageId });
    } catch (err) {
      console.error('PPC reply failed', { id, template, error: err.message });
      await knex('ppc_email_log')
        .insert({ ...log, status: 'failed', error: String(err.message).slice(0, 1000) })
        .catch((logErr) => console.error('Failed to log reply error', logErr.message));
      if (err.code === 'MAIL_NOT_CONFIGURED') {
        return res.status(503).json({ error: 'Mail is not configured on the server' });
      }
      return res.status(502).json({ error: 'Failed to send the email' });
    }

    // The reply counts as the first contact. The mail is already sent, so a failure here is only logged.
    if (await hasFirstContacted()) {
      await knex('ppc_contact_submissions')
        .where({ id })
        .update({ first_contacted_at: knex.raw('COALESCE(first_contacted_at, now())') })
        .catch((e) => console.error('first_contacted_at update failed', e.message));
    }

    // "We will help you" moves a new lead to contacted; it never downgrades a later stage.
    let status = lead.status;
    if (template === 'will_help' && lead.status === 'new') {
      status = 'contacted';
      await knex('ppc_contact_submissions').where({ id }).update({ status, updated_at: knex.fn.now() });
    }

    res.status(200).json({ sent: true, template, to, status });
  } catch (err) {
    next(err);
  } finally {
    replyInFlight.delete(key);
  }
};

// POST /api/ppc/:id/translate : the lead's message in English, translated by Google when someone asks.
// Only what the visitor wrote is sent (the source, location and visitor blocks are removed first).
const TRANSLATE_ERRORS = {
  TRANSLATE_EMPTY: [400, 'This lead has no message to translate'],
  TRANSLATE_NOT_CONFIGURED: [503, 'Translation is not set up on the server'],
  TRANSLATE_DENIED: [502, 'Google refused the translation. Check that the Cloud Translation API is enabled and the service account has the Cloud Translation API User role'],
  TRANSLATE_QUOTA: [429, 'The translation quota is used up. Try again later'],
  TRANSLATE_TIMEOUT: [504, 'The translation service took too long. Please try again'],
  TRANSLATE_FAILED: [502, 'The translation service failed. Please try again'],
};

exports.translatePPCMessage = async (req, res, next) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid id' });

  try {
    const lead = await knex('ppc_contact_submissions').where({ id, is_active: true }).first();
    if (!lead) return res.status(404).json({ error: 'Submission not found' });

    const text = splitMessage(lead.message).message;
    try {
      const { translated, detectedLanguage, truncated } = await translateToEnglish(text);
      return res.status(200).json({
        translated,
        detected_language: detectedLanguage,
        already_english: translated === null,
        truncated,
      });
    } catch (err) {
      const mapped = TRANSLATE_ERRORS[err.code];
      if (!mapped) throw err;
      if (err.code !== 'TRANSLATE_EMPTY') console.error('PPC translate failed', { id, code: err.code }); // never the message text or the Google reply
      return res.status(mapped[0]).json({ error: mapped[1] });
    }
  } catch (err) {
    next(err);
  }
};
