const cron = require('node-cron');
const Meeting = require('../models/Meeting');
const Admin = require('../models/Admin');
const Config = require('../models/Config');
const { sendEmail, isEmailConfigured, getDefaultFrom } = require('./emailService');
const { formatMeetingSubjectDate } = require('./meetingMailSubject');
const { getPlanConstraints } = require('./planConstraints');

/**
 * Determine if an organizer string looks like an email address.
 */
function looksLikeEmail(value) {
  return typeof value === 'string' && /\S+@\S+\.\S+/.test(value);
}

/**
 * Start cron job that sends action-item reminders.
 * For each completed meeting:
 * - Day-before reminder for open items (actionItem.reviewReminderSent)
 * - Overdue reminder the day after the due date (actionItem.overdueReminderSent)
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

function getLocalHHMM(date) {
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function getReminderCopyForProduct(productType, overdue = false) {
  const isEducation = String(productType || '').toLowerCase() === 'education';
  if (isEducation) {
    return {
      subjectPrefix: overdue ? 'Overdue: Assignment' : 'Reminder: Assignment due soon',
      itemLabel: 'Assignment',
      sessionLabel: 'lecture',
      summaryLabel: 'lecture notes',
      assistantLabel: 'PortIQ Education Assistant',
      intro: overdue
        ? 'This is a follow-up reminder for an assignment from'
        : 'This is a gentle reminder about an assignment identified in the AI-generated notes for',
      caution:
        'This reminder is based on AI-generated lecture notes and may not be 100% accurate. Please review before taking action.',
    };
  }
  return {
    subjectPrefix: overdue ? 'Overdue: Action item' : 'Reminder: Action item due soon',
    itemLabel: 'Action item',
    sessionLabel: 'meeting',
    summaryLabel: 'AI summary',
    assistantLabel: 'PortIQ Meeting Assistant',
    intro: overdue
      ? 'This is a follow-up reminder for an action item from'
      : 'This is a gentle reminder about an action item identified in the AI-generated summary for',
    caution:
      'This reminder is based on the AI meeting summary and may not be 100% accurate. Please review the summary and action items before taking any decisions.',
  };
}

async function startActionItemReminderCron() {
  if (!isEmailConfigured()) {
    console.warn('⚠️  Email not configured. Action-item reminder cron will not send emails.');
  }

  // Run every minute, and only send when the current local time matches the configured HH:MM.
  // This eliminates the need to restart the server when an admin changes reminder time.
  console.log('⏰ Scheduling action-item reminder cron (checks every minute)');
  cron.schedule('* * * * *', async () => {
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
    const configuredTime = (runtimeConfig && runtimeConfig.actionItemReminderTime) || '11:00';
    if (getLocalHHMM(now) !== configuredTime) {
      return;
    }
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

    console.log('⏰ Running action-item reminder cron job...');

    try {
      const meetings = await Meeting.find({
        status: 'Completed',
        transcriptionStatus: 'Completed',
        actionItems: { $exists: true, $ne: [] }
      }).select(
        'adminId title organizer participants endTime startTime scheduledTime createdAt actionItems'
      );

      const adminIds = [
        ...new Set(
          meetings
            .map((m) => m.adminId)
            .filter(Boolean)
            .map((id) => String(id))
        ),
      ];
      const admins =
        adminIds.length > 0
          ? await Admin.find({ _id: { $in: adminIds } }).lean()
          : [];
      const reminderAllowedByAdminId = new Map();
      const productTypeByAdminId = new Map();
      for (const a of admins) {
        productTypeByAdminId.set(String(a._id), String(a.productType || '').toLowerCase());
        reminderAllowedByAdminId.set(
          String(a._id),
          !!getPlanConstraints(a).allowsActionItemReminders
        );
      }

      let remindersSent = 0;

      for (const meeting of meetings) {
        if (!meeting.endTime) continue;
        if (
          meeting.adminId &&
          reminderAllowedByAdminId.get(String(meeting.adminId)) !== true
        ) {
          continue;
        }
        const meetingProductType = productTypeByAdminId.get(String(meeting.adminId || '')) || 'workplace';
        const reminderCopy = getReminderCopyForProduct(meetingProductType, false);
        const overdueReminderCopy = getReminderCopyForProduct(meetingProductType, true);
        const isEducation = meetingProductType === 'education';

        for (const actionItem of meeting.actionItems || []) {
          if (!actionItem || !actionItem.dueDate) continue;
          if (actionItem.status === 'done') continue;

          const dueDate = new Date(actionItem.dueDate);
          if (Number.isNaN(dueDate.getTime())) continue;

          // Day-before reminder (works with AI-inferred due dates from key points/summary)
          const reminderDate = new Date(dueDate.getTime() - 24 * 60 * 60 * 1000);
          const shouldSendReviewReminder =
            reminderDate >= startOfToday &&
            reminderDate < endOfToday &&
            !actionItem.reviewReminderSent;

          if (shouldSendReviewReminder) {
            if (!isEmailConfigured()) {
              console.warn('⚠️  Skipping reminder email; email transport not configured.');
            } else {
              const recipientEmails = new Set();
              (meeting.participants || [])
                .filter(p => p && p.email && /\S+@\S+\.\S+/.test(p.email))
                .forEach(p => recipientEmails.add(p.email.trim()));

              if (looksLikeEmail(meeting.organizer)) {
                recipientEmails.add(meeting.organizer.trim());
              }

              const to = Array.from(recipientEmails);
              if (to.length > 0) {
                const humanDueDate = dueDate.toLocaleString();
                const subject = `${reminderCopy.subjectPrefix} – ${meeting.title} – ${formatMeetingSubjectDate(meeting)}`;
                const summaryUrl = getSummaryUrl(meeting._id);
                const html = `
                  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #111827; line-height: 1.6;">
                    <p>Hello,</p>
                    <p>
                      ${reminderCopy.intro}
                      the ${reminderCopy.sessionLabel} <strong>${meeting.title}</strong>.
                    </p>
                    <p>
                      <strong>${reminderCopy.itemLabel}:</strong><br/>
                      ${actionItem.task || 'No description provided.'}
                    </p>
                    ${actionItem.assignee ? `<p><strong>Assignee:</strong> ${actionItem.assignee}</p>` : ''}
                    <p><strong>Due date:</strong> ${humanDueDate}</p>
                    <p>
                      You can review the full ${reminderCopy.summaryLabel} here:<br/>
                      <a href="${summaryUrl}" target="_blank" rel="noopener noreferrer">${summaryUrl}</a>
                    </p>
                    <p style="margin-top: 16px; font-size: 12px; color: #6b7280;">
                      ${reminderCopy.caution}
                    </p>
                    <p style="margin-top: 16px; font-size: 12px; color: #6b7280;">
                      – ${reminderCopy.assistantLabel}
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
          }

          // Overdue reminder: workplace only.
          // Education mode should send only day-before reminders (no overdue nudges).
          const shouldSendOverdueReminder =
            !isEducation &&
            actionItem.status !== 'done' &&
            dueDate < new Date(now.getFullYear(), now.getMonth(), now.getDate()) &&
            !actionItem.overdueReminderSent;

          if (shouldSendOverdueReminder) {
            const now2 = new Date();
            if (!isEmailConfigured()) continue;

            if (!isEducation && actionItem.reviewReminderSent && actionItem.overdueReminderSent) {
              continue;
            }

            // Only send overdue reminders for items already past due (workplace only).
            const recipientEmails2 = new Set();
            (meeting.participants || [])
              .filter(p => p && p.email && /\S+@\S+\.\S+/.test(p.email))
              .forEach(p => recipientEmails2.add(p.email.trim()));

            if (looksLikeEmail(meeting.organizer)) {
              recipientEmails2.add(meeting.organizer.trim());
            }

            const to2 = Array.from(recipientEmails2);
            if (to2.length > 0) {
              const subject2 = `${overdueReminderCopy.subjectPrefix} – ${meeting.title} – ${formatMeetingSubjectDate(meeting)}`;
              const overdueHtml = `
                  <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 14px; color: #111827; line-height: 1.6;">
                    <p>Hello,</p>
                    <p>
                      ${overdueReminderCopy.intro}
                      <strong>${meeting.title}</strong> that is now overdue.
                    </p>
                    <p><strong>${overdueReminderCopy.itemLabel}:</strong><br/>${actionItem.task || 'No description provided.'}</p>
                    ${
                      actionItem.assignee
                        ? `<p><strong>Assignee:</strong> ${actionItem.assignee}</p>`
                        : ''
                    }
                    <p><strong>Due date:</strong> ${dueDate.toLocaleString()}</p>
                    <p>
                      Review the full ${overdueReminderCopy.summaryLabel} here:<br/>
                      <a href="${getSummaryUrl(meeting._id)}" target="_blank" rel="noopener noreferrer">${getSummaryUrl(meeting._id)}</a>
                    </p>
                    <p style="margin-top: 16px; font-size: 12px; color: #6b7280;">
                      ${overdueReminderCopy.caution}
                    </p>
                    <p style="margin-top: 16px; font-size: 12px; color: #6b7280;">
                      – ${overdueReminderCopy.assistantLabel}
                    </p>
                  </div>
                `;

                try {
                  const result2 = await sendEmail({
                    from: getDefaultFrom(),
                    to: to2,
                    subject: subject2,
                    html: overdueHtml,
                  });

                  if (result2 && result2.success) {
                    actionItem.overdueReminderSent = true;
                    actionItem.overdueReminderSentAt = new Date();
                    meeting.markModified('actionItems');
                    await meeting.save();
                    remindersSent += 1;
                    console.log(`✅ Sent overdue reminder for ${isEducation ? 'assignment' : 'action item'} in "${meeting.title}"`);
                  }
                } catch (err2) {
                  console.error(
                    `❌ Error sending overdue reminder for "${meeting.title}":`,
                    err2.message
                  );
                }
              }
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

