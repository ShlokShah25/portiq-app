const cron = require('node-cron');
const Meeting = require('../models/Meeting');
const Config = require('../models/Config');
const { sendEmail, isEmailConfigured, getDefaultFrom } = require('./emailService');

/**
 * Determine if an organizer string looks like an email address.
 */
function looksLikeEmail(value) {
  return typeof value === 'string' && /\S+@\S+\.\S+/.test(value);
}

/**
 * Start cron job that sends review reminders for action items.
 * For each completed meeting, if an action item has a due date and that due
 * date is 2 days after the meeting end time, send a reminder 1 day before
 * the due date (i.e., roughly 1 day after the meeting) based on the AI summary.
 */
function getReminderCronExpressionFromConfig(config) {
  const time = (config && config.actionItemReminderTime) || '08:00';
  const match = String(time).match(/^(\d{1,2}):(\d{2})$/);
  let hour = 8;
  let minute = 0;
  if (match) {
    const h = parseInt(match[1], 10);
    const m = parseInt(match[2], 10);
    if (!Number.isNaN(h) && !Number.isNaN(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      hour = h;
      minute = m;
    }
  }
  // Cron format: m h * * * (once per day)
  return `${minute} ${hour} * * *`;
}

function getSummaryUrl(meetingId) {
  const base =
    process.env.MEETING_SUMMARY_BASE_URL ||
    process.env.CLIENT_BASE_URL ||
    'https://meetingassistant.portiqtechnologies.com';
  const trimmedBase = base.replace(/\/+$/, '');
  return `${trimmedBase}/meetings/${meetingId}/summary`;
}

async function startActionItemReminderCron() {
  if (!isEmailConfigured()) {
    console.warn('⚠️  Email not configured. Action-item reminder cron will not send emails.');
  }

  let config;
  try {
    config = await Config.getConfig();
  } catch (err) {
    console.warn('⚠️  Could not load config for reminder cron, using default 08:00:', err.message);
  }

  const expression = getReminderCronExpressionFromConfig(config);
  console.log(`⏰ Scheduling action-item reminder cron with expression "${expression}"`);

  // Run once a day at configured server-local time
  cron.schedule(expression, async () => {
    // Re-read config at runtime so toggles take effect without redeploy
    let runtimeConfig = null;
    try {
      runtimeConfig = await Config.getConfig();
    } catch (err) {
      console.warn('⚠️  Could not load config during reminder run:', err.message);
    }

    if (runtimeConfig && runtimeConfig.actionItemRemindersEnabled === false) {
      console.log('🔕 Action-item reminders are disabled. Skipping reminder run.');
      return;
    }

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    console.log('⏰ Running action-item reminder cron job...');

    try {
      const meetings = await Meeting.find({
        status: 'Completed',
        transcriptionStatus: 'Completed',
        actionItems: { $exists: true, $ne: [] }
      }).select('title organizer participants endTime actionItems');

      let remindersSent = 0;

      for (const meeting of meetings) {
        if (!meeting.endTime) continue;

        for (const actionItem of meeting.actionItems || []) {
          if (!actionItem || !actionItem.dueDate) continue;

          const dueDate = new Date(actionItem.dueDate);
          if (Number.isNaN(dueDate.getTime())) continue;

          const meetingEnd = new Date(meeting.endTime);
          if (Number.isNaN(meetingEnd.getTime())) continue;

          const msDiffFromMeeting = dueDate.getTime() - meetingEnd.getTime();
          const daysFromMeeting = msDiffFromMeeting / (1000 * 60 * 60 * 24);

          // Focus on tasks that are due approximately 2 days after the meeting
          if (daysFromMeeting < 1.5 || daysFromMeeting > 2.5) {
            continue;
          }

          const reminderDate = new Date(dueDate.getTime() - 24 * 60 * 60 * 1000);
          if (reminderDate < startOfToday || reminderDate >= endOfToday) {
            continue;
          }

          if (actionItem.reviewReminderSent) continue;

          if (!isEmailConfigured()) {
            console.warn('⚠️  Skipping reminder email; email transport not configured.');
            continue;
          }

          const recipientEmails = new Set();
          (meeting.participants || [])
            .filter(p => p && p.email && /\S+@\S+\.\S+/.test(p.email))
            .forEach(p => recipientEmails.add(p.email.trim()));

          if (looksLikeEmail(meeting.organizer)) {
            recipientEmails.add(meeting.organizer.trim());
          }

          const to = Array.from(recipientEmails);
          if (to.length === 0) continue;

          const humanDueDate = dueDate.toLocaleString();

          const subject = `Reminder: Action item due soon – ${meeting.title}`;
          const summaryUrl = getSummaryUrl(meeting._id);
          const html = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #111827; line-height: 1.6;">
              <p>Hello,</p>
              <p>
                This is a gentle reminder about an action item identified in the AI-generated
                summary for the meeting <strong>${meeting.title}</strong>.
              </p>
              <p>
                <strong>Action item:</strong><br/>
                ${actionItem.task || 'No description provided.'}
              </p>
              ${actionItem.assignee ? `<p><strong>Assignee:</strong> ${actionItem.assignee}</p>` : ''}
              <p><strong>Due date:</strong> ${humanDueDate}</p>
              <p>
                You can review the full AI summary and all action items here:<br/>
                <a href="${summaryUrl}" target="_blank" rel="noopener noreferrer">${summaryUrl}</a>
              </p>
              <p style="margin-top: 16px; font-size: 12px; color: #6b7280;">
                This reminder is based on the AI meeting summary and may not be 100% accurate.
                Please review the summary and action items before taking any decisions.
              </p>
              <p style="margin-top: 16px; font-size: 12px; color: #6b7280;">
                – PortIQ Meeting Assistant
              </p>
            </div>
          `;

          try {
            const result = await sendEmail({
              from: getDefaultFrom(),
              to,
              subject,
              html
            });

            if (result.success) {
              actionItem.reviewReminderSent = true;
              actionItem.reviewReminderSentAt = new Date();
              meeting.markModified('actionItems');
              await meeting.save();
              remindersSent += 1;
              console.log(`✅ Sent action-item reminder for meeting "${meeting.title}"`);
            } else {
              console.warn(
                `⚠️  Failed to send action-item reminder for meeting "${meeting.title}":`,
                result.error
              );
            }
          } catch (err) {
            console.error(
              `❌ Error sending action-item reminder for meeting "${meeting.title}":`,
              err.message
            );
          }
        }
      }

      console.log(`📬 Action-item reminder cron job completed. Reminders sent: ${remindersSent}`);
    } catch (err) {
      console.error('❌ Error in action-item reminder cron job:', err.message);
    }
  });
}

module.exports = {
  startActionItemReminderCron,
};

