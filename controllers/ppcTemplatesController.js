const knexConfig = require('../knexfile').development;
const knex = require('knex')(knexConfig);
const { splitMessage } = require('../utils/messageParts');
const { TEMPLATES, DEFAULTS, PLACEHOLDERS, renderReply, validateTemplate } = require('../utils/replyTemplates');
const { TABLE, hasTemplateTable, getCustom, listCustom } = require('../utils/templateStore');

const SAMPLE_LEAD = {
  name: 'Alex Morgan',
  company: 'Example Industries',
  message: 'Hello, please send a quote for a 3000 Nm hydraulic torque wrench.',
};

const fromAddress = () => process.env.MAIL_FROM || 'Tritorc <response@tritorc.com>';

function describe(template, custom) {
  const base = DEFAULTS[template];
  return {
    template,
    label: base.label,
    description: base.description,
    subject: custom ? custom.subject : base.subject,
    body: custom ? custom.body : base.body,
    is_custom: !!custom,
    updated_at: custom ? custom.updated_at : null,
    updated_by: custom ? custom.updated_by : null,
    default_subject: base.subject,
    default_body: base.body,
  };
}

// GET /api/ppc/templates: every template with its current wording, plus what the editor needs.
exports.listTemplates = async (req, res, next) => {
  try {
    const saved = new Map((await listCustom()).map((r) => [r.template, r]));
    res.json({
      from: fromAddress(),
      placeholders: PLACEHOLDERS,
      editable: await hasTemplateTable(),
      data: TEMPLATES.map((t) => describe(t, saved.get(t))),
    });
  } catch (err) {
    next(err);
  }
};

// PUT /api/ppc/templates/:template  { subject, body }
exports.saveTemplate = async (req, res, next) => {
  try {
    const { template } = req.params;
    if (!TEMPLATES.includes(template)) return res.status(404).json({ error: 'Unknown template' });
    const { subject, body } = req.body || {};
    const problem = validateTemplate(subject, body);
    if (problem) return res.status(400).json({ error: problem });
    if (!(await hasTemplateTable())) {
      return res.status(503).json({ error: 'Template table is missing. Run the latest migration first.' });
    }

    const row = {
      template,
      subject: subject.trim(),
      body: body.replace(/\r\n/g, '\n').trim(),
      updated_by: req.user && req.user.email,
      updated_at: knex.fn.now(),
    };
    await knex(TABLE).insert(row).onConflict('template').merge();
    res.json(describe(template, await getCustom(template)));
  } catch (err) {
    next(err);
  }
};

// DELETE /api/ppc/templates/:template: go back to the default wording.
exports.resetTemplate = async (req, res, next) => {
  try {
    const { template } = req.params;
    if (!TEMPLATES.includes(template)) return res.status(404).json({ error: 'Unknown template' });
    if (await hasTemplateTable()) await knex(TABLE).where({ template }).del();
    res.json(describe(template, null));
  } catch (err) {
    next(err);
  }
};

// POST /api/ppc/templates/preview  { template, subject?, body?, lead_id? }
// Renders the mail as it would be sent. Unsaved subject / body from the editor are used when given;
// otherwise the saved wording. With lead_id it uses that lead, otherwise a sample lead.
exports.previewTemplate = async (req, res, next) => {
  try {
    const { template, subject, body, lead_id: leadId } = req.body || {};
    if (!TEMPLATES.includes(template)) return res.status(400).json({ error: 'Unknown template' });

    let custom = null;
    if (subject !== undefined || body !== undefined) {
      const saved = (await getCustom(template)) || DEFAULTS[template];
      const draft = { subject: subject !== undefined ? subject : saved.subject, body: body !== undefined ? body : saved.body };
      const problem = validateTemplate(draft.subject, draft.body);
      if (problem) return res.status(400).json({ error: problem });
      custom = draft;
    } else {
      custom = await getCustom(template);
    }

    let lead = SAMPLE_LEAD;
    let to = null;
    if (leadId !== undefined && leadId !== null) {
      const id = Number(leadId);
      if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'Invalid lead_id' });
      const row = await knex('ppc_contact_submissions').where({ id, is_active: true }).first();
      if (!row) return res.status(404).json({ error: 'Submission not found' });
      lead = { name: row.name, company: row.company, message: splitMessage(row.message).message };
      to = row.email;
    }

    const rendered = renderReply(template, lead, custom);
    res.json({ from: fromAddress(), to, sample: to === null, ...rendered });
  } catch (err) {
    next(err);
  }
};
