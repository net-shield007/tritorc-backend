const knexConfig = require('../knexfile').development;
const knex = require('knex')(knexConfig);
const mobileSheets = require('../utils/mobileSheets');
const { parseLeadSource, parseTrackingParams } = require('../utils/leadSource');

const clean = (value, max) => {
  if (value === undefined || value === null) return undefined;
  const str = String(value).trim();
  return str ? str.slice(0, max) : undefined;
};

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
  }

  try {
    const [id] = await knex('ppc_contact_submissions')
      .insert({ name, email, company, phone, message })
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
    let { page = 1, limit = 10, orderBy = 'created_at', order = 'desc' } = req.query;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    const offset = (page - 1) * limit;

    const submissions = await knex('ppc_contact_submissions')
      .select('*')
      .where({ is_active: true })
      .orderBy(orderBy, order)
      .limit(limit)
      .offset(offset);

    const [{ count }] = await knex('ppc_contact_submissions').where({ is_active: true }).count('* as count');

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

    const allowedStatuses = ["new", "contacted", "qualified", "hot", "closed"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed statuses: ${allowedStatuses.join(", ")}` });
    }

    const updated = await knex('ppc_contact_submissions')
      .where({ id })
      .update({ status, updated_at: knex.fn.now() });

    if (!updated) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    res.status(200).json({ message: 'Status updated successfully', id, status });
  } catch (err) {
    next(err);
  }
};
