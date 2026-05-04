const fs = require('fs');
const PDFDocument = require('pdfkit');

function durationMinutesFromMeeting(meeting) {
  if (!meeting?.startTime || !meeting?.endTime) return null;
  const start = new Date(meeting.startTime);
  const end = new Date(meeting.endTime);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return null;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
}

/**
 * Same resolution as client / approve flow: prefer pending arrays when populated during review.
 */
function effectiveSummaryDataForExport(meeting) {
  if (!meeting) {
    return {
      summary: '',
      keyPoints: [],
      actionItems: [],
      decisions: [],
      nextSteps: [],
      importantNotes: [],
    };
  }
  const summary = meeting.pendingSummary || meeting.summary || '';
  const keyPoints =
    meeting.pendingKeyPoints?.length > 0 ? meeting.pendingKeyPoints : meeting.keyPoints || [];
  const actionItems =
    meeting.pendingActionItems?.length > 0
      ? meeting.pendingActionItems
      : meeting.actionItems || [];
  const decisions =
    meeting.pendingDecisions?.length > 0 ? meeting.pendingDecisions : meeting.decisions || [];
  const nextSteps =
    meeting.pendingNextSteps?.length > 0 ? meeting.pendingNextSteps : meeting.nextSteps || [];
  const importantNotes =
    meeting.pendingImportantNotes?.length > 0
      ? meeting.pendingImportantNotes
      : meeting.importantNotes || [];
  return { summary, keyPoints, actionItems, decisions, nextSteps, importantNotes };
}

function formatDueForPdf(dueDate) {
  if (dueDate == null || dueDate === '') return '';
  const d = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(d.getTime())) return String(dueDate);
  return d.toLocaleDateString();
}

/**
 * Writes minutes body onto a PDFKit doc (header through next steps).
 * @param {{ isEducation?: boolean }} [options]
 */
function writeMeetingMinutesPdfContent(doc, meeting, summaryData, durationMinutes, options = {}) {
  const isEducation = Boolean(options.isEducation);
  /** Student-facing PDF labels (education) vs workplace minutes. */
  const labels = isEducation
    ? {
        documentTitle: 'Class notes (for students)',
        classTopic: 'Class / topic',
        location: 'Classroom or link',
        teacher: 'Teacher',
        when: 'When',
        sessionLength: 'Session length',
        summary: 'Structured notes & detailed explanation',
        summaryEmpty: 'No class recap has been added yet.',
        keyPoints: 'Quick revision',
        tasks: 'Assignments & follow-ups',
        decisions: 'Takeaways & clarifications',
        importantNotes: 'Extra notes from class',
        nextSteps: 'Homework, prep & next steps',
        defaultTask: 'Follow-up',
        taskBullet: 'Item',
        assignedTo: 'Assigned to',
        due: 'Due',
      }
    : {
        documentTitle: 'Minutes of Meeting',
        classTopic: 'Title',
        location: 'Room',
        teacher: 'Organizer',
        when: 'Date',
        sessionLength: 'Duration',
        summary: 'Summary',
        summaryEmpty: 'No summary provided.',
        keyPoints: 'Key Points',
        tasks: 'Action Items',
        decisions: 'Decisions',
        importantNotes: 'Important Notes',
        nextSteps: 'Next Steps',
        defaultTask: 'Action item',
        taskBullet: 'Task',
        assignedTo: 'Assignee',
        due: 'Deadline',
      };
  const companyName = process.env.COMPANY_NAME || 'Your Company';
  const logoPath = process.env.COMPANY_LOGO_PATH;

  if (logoPath && fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, { fit: [100, 40], align: 'left' });
    } catch (e) {
      console.warn('⚠️  Failed to load company logo for PDF:', e.message);
    }
    doc.moveDown();
  }

  doc.fontSize(18).text(companyName, { align: 'left' }).moveDown(0.5);
  doc.fontSize(16).text(labels.documentTitle, { align: 'left' }).moveDown();

  const meetingDate = meeting.startTime ? new Date(meeting.startTime) : new Date();
  doc
    .fontSize(12)
    .text(`${labels.classTopic}: ${meeting.title || ''}`)
    .text(`${labels.location}: ${meeting.meetingRoom || ''}`)
    .text(`${labels.teacher}: ${meeting.organizer || ''}`)
    .text(`${labels.when}: ${meetingDate.toLocaleString()}`);

  if (durationMinutes != null) {
    doc.text(`${labels.sessionLength}: ${durationMinutes} minutes`);
  }

  doc.moveDown();

  if (isEducation) {
    if ((summaryData.keyPoints || []).length) {
      doc.fontSize(13).text(labels.keyPoints, { underline: true }).moveDown(0.5).fontSize(12);
      (summaryData.keyPoints || []).forEach((p) => {
        doc.text(`• ${p}`);
      });
      doc.moveDown();
    }
    doc
      .fontSize(13)
      .text(labels.summary, { underline: true })
      .moveDown(0.5)
      .fontSize(12)
      .text(summaryData.summary || labels.summaryEmpty, { align: 'left' })
      .moveDown();
  } else {
    doc
      .fontSize(13)
      .text(labels.summary, { underline: true })
      .moveDown(0.5)
      .fontSize(12)
      .text(summaryData.summary || labels.summaryEmpty)
      .moveDown();

    if ((summaryData.keyPoints || []).length) {
      doc.fontSize(13).text(labels.keyPoints, { underline: true }).moveDown(0.5).fontSize(12);
      (summaryData.keyPoints || []).forEach((p) => {
        doc.text(`• ${p}`);
      });
      doc.moveDown();
    }
  }

  if ((summaryData.actionItems || []).length) {
    doc.fontSize(13).text(labels.tasks, { underline: true }).moveDown(0.5).fontSize(12);
    (summaryData.actionItems || []).forEach((a) => {
      const task =
        a.task ||
        (typeof a === 'string' ? a : a?.toString?.() || labels.defaultTask);
      const assignee = a.assignee ? `${labels.assignedTo}: ${a.assignee}` : '';
      const dueRaw = a.dueDate;
      const due = dueRaw ? `${labels.due}: ${formatDueForPdf(dueRaw)}` : '';
      const notes = a.notes ? `Notes: ${a.notes}` : '';
      doc.text(`• ${labels.taskBullet}: ${task}`);
      if (assignee) doc.text(`  ${assignee}`);
      if (due) doc.text(`  ${due}`);
      if (notes) doc.text(`  ${notes}`);
      doc.moveDown(0.3);
    });
    doc.moveDown();
  }

  if ((summaryData.decisions || []).length) {
    doc.fontSize(13).text(labels.decisions, { underline: true }).moveDown(0.5).fontSize(12);
    (summaryData.decisions || []).forEach((d) => {
      doc.text(`• ${d}`);
    });
    doc.moveDown();
  }

  if ((summaryData.importantNotes || []).length) {
    doc.fontSize(13).text(labels.importantNotes, { underline: true }).moveDown(0.5).fontSize(12);
    (summaryData.importantNotes || []).forEach((n) => {
      doc.text(`• ${n}`);
    });
    doc.moveDown();
  }

  if ((summaryData.nextSteps || []).length) {
    doc.fontSize(13).text(labels.nextSteps, { underline: true }).moveDown(0.5).fontSize(12);
    (summaryData.nextSteps || []).forEach((s) => {
      doc.text(`• ${s}`);
    });
  }
}

async function buildMeetingSummaryPdfBuffer(meeting, summaryData, durationMinutes, pdfOptions = {}) {
  const pdfBuffers = [];
  const doc = new PDFDocument({ margin: 50 });
  doc.on('data', (chunk) => pdfBuffers.push(chunk));
  writeMeetingMinutesPdfContent(doc, meeting, summaryData, durationMinutes, pdfOptions);
  doc.end();
  return new Promise((resolve) => {
    doc.on('end', () => resolve(Buffer.concat(pdfBuffers)));
  });
}

module.exports = {
  durationMinutesFromMeeting,
  effectiveSummaryDataForExport,
  writeMeetingMinutesPdfContent,
  buildMeetingSummaryPdfBuffer,
};
