/**
 * Shared email service: Resend (preferred) or Nodemailer SMTP fallback.
 * Set RESEND_API_KEY to use Resend. Set RESEND_FROM (e.g. "Portiq <meetingassistant@portiqtechnologies.com>")
 * or leave unset to use MAIL_FROM. Fallback: MAIL_HOST, MAIL_USER, MAIL_PASS for Nodemailer.
 */

const nodemailer = require('nodemailer');

let resendClient = null;
let nodemailerTransporter = null;

// Prefer Resend when API key is set
if (process.env.RESEND_API_KEY) {
  try {
    const { Resend } = require('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY);
    console.log('✅ Email service: Resend initialized');
  } catch (err) {
    console.warn('⚠️  Resend package not found. Run: npm install resend. Falling back to SMTP.');
  }
}

if (!resendClient && process.env.MAIL_HOST && process.env.MAIL_USER && process.env.MAIL_PASS) {
  try {
    nodemailerTransporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST,
      port: parseInt(process.env.MAIL_PORT || '587', 10),
      secure: process.env.MAIL_SECURE === 'true',
      auth: {
        user: process.env.MAIL_USER,
        pass: process.env.MAIL_PASS,
      },
    });
    console.log('✅ Email service: Nodemailer SMTP initialized');
  } catch (err) {
    console.warn('⚠️  Failed to create Nodemailer transporter:', err.message);
  }
}

if (!resendClient && !nodemailerTransporter) {
  console.warn('⚠️  No email transport. Set RESEND_API_KEY or MAIL_HOST/MAIL_USER/MAIL_PASS.');
}

function getDefaultFrom() {
  /* Prefer same env vars as before: MAIL_FROM, then MAIL_USER */
  if (process.env.MAIL_FROM) return process.env.MAIL_FROM;
  if (process.env.MAIL_USER) return process.env.MAIL_USER;
  if (process.env.RESEND_FROM) return process.env.RESEND_FROM;
  return 'Portiq <meetingassistant@portiqtechnologies.com>';
}

/**
 * Send an email. Uses Resend if available, else Nodemailer.
 * @param {Object} options - { from?, to (string or string[]), subject, html?, text?, attachments? }
 * @param {Buffer} options.attachments - optional array of { filename, content (Buffer), contentType? }
 * @returns {Promise<{ success: boolean, message?: string, error?: string }>}
 */
async function sendEmail(options) {
  const { from = getDefaultFrom(), to, subject, html, text, attachments = [] } = options;

  if (!to || !subject) {
    return { success: false, error: 'Missing to or subject' };
  }

  const toList = Array.isArray(to) ? to : [to].filter(Boolean);
  if (toList.length === 0) {
    return { success: false, error: 'No recipients' };
  }

  if (resendClient) {
    try {
      const payload = {
        from,
        to: toList,
        subject,
        html: html || (text ? `<pre>${text.replace(/</g, '&lt;')}</pre>` : '<p></p>'),
      };
      if (text && !html) payload.text = text;
      if (attachments && attachments.length > 0) {
        payload.attachments = attachments.map((a) => ({
          filename: a.filename,
          content: a.content instanceof Buffer ? a.content : Buffer.from(a.content),
        }));
      }
      const { data, error } = await resendClient.emails.send(payload);
      if (error) {
        console.error('❌ Resend error:', error.message || error);
        return { success: false, error: error.message || String(error) };
      }
      return { success: true, message: 'Sent via Resend', id: data?.id };
    } catch (err) {
      console.error('❌ Resend send failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  if (nodemailerTransporter) {
    try {
      const mailOptions = {
        from,
        to: toList.join(','),
        subject,
        html: html || (text ? `<pre>${text.replace(/</g, '&lt;')}</pre>` : ''),
        text: text || undefined,
        attachments: (attachments || []).map((a) => ({
          filename: a.filename,
          content: a.content,
          contentType: a.contentType,
        })),
      };
      await nodemailerTransporter.sendMail(mailOptions);
      return { success: true, message: 'Sent via SMTP' };
    } catch (err) {
      console.error('❌ SMTP send failed:', err.message);
      return { success: false, error: err.message };
    }
  }

  return { success: false, error: 'No email transport configured' };
}

function isEmailConfigured() {
  return !!(resendClient || nodemailerTransporter);
}

/**
 * Nodemailer-style sendMail for drop-in replacement.
 * mailOptions: { from, to, subject, html?, text?, attachments? }
 */
async function sendMail(mailOptions) {
  const to = mailOptions.to;
  const toList = typeof to === 'string' ? to.split(',').map((e) => e.trim()).filter(Boolean) : Array.isArray(to) ? to : [];
  const result = await sendEmail({
    from: mailOptions.from || getDefaultFrom(),
    to: toList,
    subject: mailOptions.subject,
    html: mailOptions.html,
    text: mailOptions.text,
    attachments: mailOptions.attachments,
  });
  if (!result.success) throw new Error(result.error || 'Send failed');
  return result;
}

/** Returns a transporter-like object { sendMail } for code that expects getMailTransporter().sendMail() */
function getMailTransporter() {
  return isEmailConfigured() ? { sendMail } : null;
}

module.exports = {
  sendEmail,
  sendMail,
  isEmailConfigured,
  getDefaultFrom,
  getMailTransporter,
};
