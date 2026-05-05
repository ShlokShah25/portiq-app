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
      revisionQuestions: '',
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
  const revisionQuestions =
    meeting.pendingRevisionQuestions != null && String(meeting.pendingRevisionQuestions).trim()
      ? String(meeting.pendingRevisionQuestions)
      : meeting.revisionQuestions || '';
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
  return { summary, revisionQuestions, keyPoints, actionItems, decisions, nextSteps, importantNotes };
}

function formatDueForPdf(dueDate) {
  if (dueDate == null || dueDate === '') return '';
  const d = dueDate instanceof Date ? dueDate : new Date(dueDate);
  if (Number.isNaN(d.getTime())) return String(dueDate);
  return d.toLocaleDateString();
}

function stripInlineMarkdown(text) {
  return String(text || '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
    .trim();
}

function looksLikeTableLine(line) {
  return line.includes('|') && line.split('|').length >= 3;
}

function isTableSeparatorLine(line) {
  return /^\s*\|?[\s:-]+\|[\s|:-]*\|?\s*$/.test(line);
}

function renderTableBlock(doc, lines) {
  if (!lines.length) return;
  const rows = lines
    .map((line) =>
      line
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => stripInlineMarkdown(cell))
    )
    .filter((cells) => cells.some((c) => c));
  if (!rows.length) return;

  const header = rows[0] || [];
  const dataRows = rows.slice(1).filter((cells) => !isTableSeparatorLine(cells.join(' | ')));

  doc.font('Helvetica-Oblique').text('Comparison table:', { indent: 10 });
  doc.font('Helvetica');

  dataRows.forEach((cells) => {
    const pairs = cells
      .map((value, idx) => {
        const key = header[idx] || `Column ${idx + 1}`;
        return `${key}: ${value || '-'}`;
      })
      .filter(Boolean);
    doc.text(`- ${pairs.join(' | ')}`, { indent: 22 });
  });
  doc.moveDown(0.3);
}

function renderMarkdownToPdf(doc, markdownText) {
  const rawLines = String(markdownText || '').replace(/\r/g, '').split('\n');
  let idx = 0;
  while (idx < rawLines.length) {
    const raw = rawLines[idx];
    const line = raw.trim();
    if (!line) {
      doc.moveDown(0.35);
      idx += 1;
      continue;
    }

    if (looksLikeTableLine(line)) {
      const tableLines = [];
      while (idx < rawLines.length && looksLikeTableLine(rawLines[idx].trim())) {
        tableLines.push(rawLines[idx].trim());
        idx += 1;
      }
      renderTableBlock(doc, tableLines);
      continue;
    }

    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      doc.font('Helvetica-Bold').text(stripInlineMarkdown(headingMatch[1]));
      doc.font('Helvetica');
      idx += 1;
      continue;
    }

    const bulletMatch = line.match(/^-\s+(.+)$/);
    if (bulletMatch) {
      doc.text(`• ${stripInlineMarkdown(bulletMatch[1])}`, { indent: 8 });
      idx += 1;
      continue;
    }

    const numberMatch = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (numberMatch) {
      doc.text(`${numberMatch[1]}. ${stripInlineMarkdown(numberMatch[2])}`, { indent: 8 });
      idx += 1;
      continue;
    }

    doc.text(stripInlineMarkdown(line));
    idx += 1;
  }
}

function ensureVerticalRoom(doc, minHeight = 72) {
  const bottomY = doc.page.height - doc.page.margins.bottom;
  if (doc.y + minHeight > bottomY) doc.addPage();
}

function drawPremiumHeader(doc, labels, meeting, durationMinutes, companyName, logoPath) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const top = doc.y;
  const bandHeight = 108;

  doc.save();
  doc.roundedRect(left, top, width, bandHeight, 10).fill('#F6F8FC');
  doc.restore();

  let textLeft = left + 16;
  if (logoPath && fs.existsSync(logoPath)) {
    try {
      doc.image(logoPath, left + 16, top + 14, { fit: [78, 34], align: 'left' });
      textLeft = left + 106;
    } catch (e) {
      console.warn('⚠️  Failed to load company logo for PDF:', e.message);
    }
  }

  doc
    .fillColor('#0F172A')
    .font('Helvetica-Bold')
    .fontSize(14)
    .text(companyName, textLeft, top + 12, { width: width - (textLeft - left) - 16 });

  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(labels.documentTitle, textLeft, top + 34, { width: width - (textLeft - left) - 16 });

  const meetingDate = meeting.startTime ? new Date(meeting.startTime) : new Date();
  const metaLines = [
    `${labels.classTopic}: ${meeting.title || '-'}`,
    `${labels.location}: ${meeting.meetingRoom || '-'}`,
    `${labels.teacher}: ${meeting.organizer || '-'}`,
    `${labels.when}: ${meetingDate.toLocaleString()}`,
  ];
  if (durationMinutes != null) metaLines.push(`${labels.sessionLength}: ${durationMinutes} minutes`);

  doc
    .fillColor('#334155')
    .font('Helvetica')
    .fontSize(10.5)
    .text(metaLines.join('   |   '), left + 16, top + 72, {
      width: width - 32,
      lineBreak: true,
    });

  doc.y = top + bandHeight + 14;
  doc.fillColor('#111827');
}

function drawSectionHeading(doc, heading) {
  ensureVerticalRoom(doc, 40);
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const y = doc.y;

  doc.save();
  doc.roundedRect(left, y, width, 24, 6).fill('#EEF2FF');
  doc.restore();
  doc
    .fillColor('#1E293B')
    .font('Helvetica-Bold')
    .fontSize(11.5)
    .text(heading, left + 10, y + 7, { width: width - 20, lineBreak: false });
  doc.y = y + 30;
  doc.fillColor('#111827').font('Helvetica').fontSize(11.5);
}

function drawBulletList(doc, items) {
  (items || []).forEach((item) => {
    ensureVerticalRoom(doc, 24);
    doc.text(`• ${stripInlineMarkdown(item)}`);
  });
  doc.moveDown(0.35);
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
        revisionQuestions: 'Revision questions',
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
  drawPremiumHeader(doc, labels, meeting, durationMinutes, companyName, logoPath);

  if (isEducation) {
    if ((summaryData.keyPoints || []).length) {
      drawSectionHeading(doc, labels.keyPoints);
      drawBulletList(doc, summaryData.keyPoints || []);
    }
    drawSectionHeading(doc, labels.summary);
    if (summaryData.summary) {
      renderMarkdownToPdf(doc, summaryData.summary);
    } else {
      doc.text(labels.summaryEmpty);
    }
    doc.moveDown();

    if (String(summaryData.revisionQuestions || '').trim()) {
      drawSectionHeading(doc, labels.revisionQuestions);
      renderMarkdownToPdf(doc, summaryData.revisionQuestions);
      doc.moveDown();
    }
  } else {
    drawSectionHeading(doc, labels.summary);
    doc.text(summaryData.summary || labels.summaryEmpty).moveDown();

    if ((summaryData.keyPoints || []).length) {
      drawSectionHeading(doc, labels.keyPoints);
      drawBulletList(doc, summaryData.keyPoints || []);
    }
  }

  if ((summaryData.actionItems || []).length) {
    drawSectionHeading(doc, labels.tasks);
    (summaryData.actionItems || []).forEach((a) => {
      ensureVerticalRoom(doc, 50);
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
    drawSectionHeading(doc, labels.decisions);
    drawBulletList(doc, summaryData.decisions || []);
  }

  if ((summaryData.importantNotes || []).length) {
    drawSectionHeading(doc, labels.importantNotes);
    drawBulletList(doc, summaryData.importantNotes || []);
  }

  if ((summaryData.nextSteps || []).length) {
    drawSectionHeading(doc, labels.nextSteps);
    drawBulletList(doc, summaryData.nextSteps || []);
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
