// Canned replies the admin can send to a lead. Wording is a placeholder until the
// final template is supplied; every reply quotes what the lead originally wrote.

const SIGNATURE = 'Team Tritorc';

const BODIES = {
  generic: {
    subject: "We've received your enquiry – Tritorc",
    paragraphs: [
      'Thank you for contacting Tritorc. We have received your request and our team will reply to you shortly.',
    ],
  },
  will_help: {
    subject: 'Your enquiry – Tritorc',
    paragraphs: [
      'Thank you for your enquiry. We would be glad to help with your requirement, and a member of our team will contact you shortly with the details.',
    ],
  },
  regret: {
    subject: 'Your enquiry – Tritorc',
    paragraphs: [
      'Thank you for your interest in Tritorc. Unfortunately we are unable to help with this request. We appreciate you getting in touch and wish you every success.',
    ],
  },
  job_seeker: {
    subject: 'Your application – Tritorc',
    paragraphs: [
      'Thank you for your interest in working with Tritorc. This channel is for product and service enquiries, so we cannot review applications here. Please check our website for current openings.',
    ],
  },
  supplier: {
    subject: 'Your proposal – Tritorc',
    paragraphs: [
      'Thank you for reaching out to Tritorc. This channel is for customer enquiries. If your company would like to be considered as a supplier, please share your company profile and product details with our procurement team.',
    ],
  },
};

const TEMPLATES = Object.keys(BODIES);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// lead: { name, message } where message has the "Lead Source:" block already removed.
function renderReply(template, lead) {
  const body = BODIES[template];
  if (!body) throw new Error(`Unknown reply template: ${template}`);

  const name = (lead.name || '').trim();
  const greeting = name ? `Dear ${name},` : 'Hello,';
  const quoted = (lead.message || '').trim();

  const text = [
    greeting,
    '',
    ...body.paragraphs.flatMap((p) => [p, '']),
    ...(quoted
      ? ['Your message:', ...quoted.split(/\r?\n/).map((l) => `> ${l}`), '']
      : []),
    'Kind regards,',
    SIGNATURE,
  ].join('\n');

  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    ...body.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`),
    ...(quoted
      ? [
          '<p style="margin-bottom:4px;color:#555;">Your message:</p>',
          `<blockquote style="margin:0;padding:8px 12px;border-left:3px solid #ccc;color:#555;white-space:pre-wrap;">${escapeHtml(
            quoted
          )}</blockquote>`,
        ]
      : []),
    `<p>Kind regards,<br>${escapeHtml(SIGNATURE)}</p>`,
  ].join('\n');

  return { subject: body.subject, text, html };
}

module.exports = { TEMPLATES, renderReply, escapeHtml };
