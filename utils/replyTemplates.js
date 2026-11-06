// Canned replies the admin can send to a lead. Each template is a subject and a plain-text body.
// The defaults below can be replaced from the dashboard settings (see utils/templateStore.js);
// a blank line starts a new paragraph, and these placeholders are filled in for every lead:
//   {{greeting}}  "Dear <name>," (or "Hello," when the lead gave no name)
//   {{name}}      the lead's name
//   {{company}}   the lead's company
//   {{quote}}     what the lead wrote, quoted under "Your message:" (nothing when they wrote nothing)

const SIGNATURE = 'Team Tritorc';

const PLACEHOLDERS = ['greeting', 'name', 'company', 'quote'];

const FOOTER = `{{quote}}\n\nKind regards,\n${SIGNATURE}`;

const DEFAULTS = {
  generic: {
    label: 'Generic reply',
    description: 'Thanks them and says the team will reply shortly.',
    subject: "We've received your enquiry – Tritorc",
    body: `{{greeting}}\n\nThank you for contacting Tritorc. We have received your request and our team will reply to you shortly.\n\n${FOOTER}`,
  },
  will_help: {
    label: 'We will help you',
    description: 'Says we can help. Also marks a new lead as Contacted.',
    subject: 'Your enquiry – Tritorc',
    body: `{{greeting}}\n\nThank you for your enquiry. We would be glad to help with your requirement, and a member of our team will contact you shortly with the details.\n\n${FOOTER}`,
  },
  regret: {
    label: "Regret, can't help",
    description: 'Politely says we are unable to help with this request.',
    subject: 'Your enquiry – Tritorc',
    body: `{{greeting}}\n\nThank you for your interest in Tritorc. Unfortunately we are unable to help with this request. We appreciate you getting in touch and wish you every success.\n\n${FOOTER}`,
  },
  job_seeker: {
    label: 'Job seeker email',
    description: 'For people asking about a job. Points them to hr@tritorc.com.',
    subject: 'Your application – Tritorc',
    body: `{{greeting}}\n\nThank you for your interest in working with Tritorc. This channel is for product and service enquiries, so we cannot review job applications here. Please contact our HR team at hr@tritorc.com.\n\n${FOOTER}`,
  },
  supplier: {
    label: 'Supplier email',
    description: 'For companies offering to supply to Tritorc.',
    subject: 'Your proposal – Tritorc',
    body: `{{greeting}}\n\nThank you for reaching out to Tritorc. This channel is for customer enquiries. If your company would like to be considered as a supplier, please share your company profile and product details with our procurement team.\n\n${FOOTER}`,
  },
};

const TEMPLATES = Object.keys(DEFAULTS);

const SUBJECT_MAX = 200;
const BODY_MAX = 5000;

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Makes addresses in (already escaped) template text clickable.
function linkEmails(escaped) {
  return escaped.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (e) => `<a href="mailto:${e}">${e}</a>`);
}

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z_]+)\s*\}\}/g;

// Checks a subject / body before it is saved. Returns an error message, or null when it is fine.
function validateTemplate(subject, body) {
  if (typeof subject !== 'string' || !subject.trim()) return 'Subject is required';
  if (/[\r\n]/.test(subject)) return 'Subject must be a single line';
  if (subject.length > SUBJECT_MAX) return `Subject can be at most ${SUBJECT_MAX} characters`;
  if (typeof body !== 'string' || !body.trim()) return 'Message is required';
  if (body.length > BODY_MAX) return `Message can be at most ${BODY_MAX} characters`;
  for (const text of [subject, body]) {
    for (const m of text.matchAll(PLACEHOLDER_RE)) {
      if (!PLACEHOLDERS.includes(m[1])) {
        return `Unknown placeholder {{${m[1]}}}. Allowed: ${PLACEHOLDERS.map((p) => `{{${p}}}`).join(', ')}`;
      }
    }
  }
  return null;
}

// template: a key from TEMPLATES. custom: { subject, body } saved from the dashboard (optional).
// lead: { name, company, message } where message has the "Lead Source:" block already removed.
function renderReply(template, lead, custom) {
  const base = DEFAULTS[template];
  if (!base) throw new Error(`Unknown reply template: ${template}`);
  const subjectSource = (custom && custom.subject) || base.subject;
  const bodySource = (custom && custom.body) || base.body;

  const name = (lead.name || '').trim();
  const company = (lead.company || '').trim();
  const greeting = name ? `Dear ${name},` : 'Hello,';
  const quoted = (lead.message || '').trim();
  const values = { greeting, name, company };

  const fill = (text, escape) =>
    text.replace(PLACEHOLDER_RE, (whole, key) => (key in values ? (escape ? escapeHtml(values[key]) : values[key]) : whole));

  const quoteText = quoted ? `Your message:\n${quoted.split(/\r?\n/).map((l) => `> ${l}`).join('\n')}` : '';
  const quoteHtml = quoted
    ? '<p style="margin-bottom:4px;color:#555;">Your message:</p>\n' +
      `<blockquote style="margin:0;padding:8px 12px;border-left:3px solid #ccc;color:#555;white-space:pre-wrap;">${escapeHtml(quoted)}</blockquote>`
    : '';

  const normalized = bodySource.replace(/\r\n/g, '\n').trim();

  const text = fill(normalized.replace(/\{\{\s*quote\s*\}\}/g, quoteText), false)
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const html = normalized
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (/^\{\{\s*quote\s*\}\}$/.test(trimmed)) return quoteHtml;
      const withQuote = trimmed.replace(/\{\{\s*quote\s*\}\}/g, '');
      // fill() escapes the lead's values; everything else is escaped first so the template cannot inject markup
      const escaped = escapeHtml(withQuote).replace(PLACEHOLDER_RE, (whole, key) =>
        key in values ? escapeHtml(values[key]) : whole
      );
      return `<p>${linkEmails(escaped).replace(/\n/g, '<br>')}</p>`;
    })
    .filter(Boolean)
    .join('\n');

  return { subject: fill(subjectSource, false).replace(/[\r\n]+/g, ' ').trim(), text, html };
}

module.exports = { TEMPLATES, DEFAULTS, PLACEHOLDERS, SUBJECT_MAX, BODY_MAX, renderReply, validateTemplate, escapeHtml };
