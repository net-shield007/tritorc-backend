const nodemailer = require('nodemailer');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let transporter = null;

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email.trim());
}

function isConfigured() {
  return !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function getTransporter() {
  if (!transporter) {
    const port = parseInt(process.env.SMTP_PORT, 10) || 587;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465, // 587 upgrades with STARTTLS
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

// Lets tests swap in a fake transport.
function setTransport(t) {
  transporter = t;
}

// Sends one mail from MAIL_FROM. Rejects if SMTP is not configured or the send fails.
async function sendMail({ to, subject, text, html }) {
  if (!transporter && !isConfigured()) {
    const err = new Error('Mail is not configured');
    err.code = 'MAIL_NOT_CONFIGURED';
    throw err;
  }
  const info = await getTransporter().sendMail({
    from: process.env.MAIL_FROM || 'Tritorc <response@tritorc.com>',
    replyTo: process.env.MAIL_REPLY_TO || 'response@tritorc.com',
    to,
    subject,
    text,
    html,
  });
  return info;
}

module.exports = { sendMail, isValidEmail, isConfigured, setTransport };
