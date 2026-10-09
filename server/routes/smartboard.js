/**
 * Smartboard: teacher-facing slide deck + live annotation, and the student-facing
 * no-login lecture recap (covered slides with annotations, the existing lecture
 * summary, and an auto-generated 5-question quiz).
 *
 * Deliberately a separate router from routes/meetings.js — that file's summary
 * pipeline is large and carefully tuned; this feature only *reads* a finished
 * meeting's summary/transcript, it never touches that pipeline.
 *
 * Two routers are exported:
 *   - teacherRouter — mounted at /api/meetings, requires admin auth (matches
 *     the rest of the meeting endpoints).
 *   - publicRouter  — mounted at /api/public/lectures, no auth: reached via the
 *     opaque `recapToken` emailed to students.
 */

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const express = require('express');
const multer = require('multer');

const Meeting = require('../models/Meeting');
const { sendEmail, isEmailConfigured } = require('../utils/emailService');

let openai = null;
if (process.env.OPENAI_API_KEY) {
  const OpenAI = require('openai');
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 120000 });
}

const { getAdminFromRequest, canAccessMeeting, requireAdmin } = require('../utils/meetingAccess');
const {
  QUIZ_SIZE,
  QUIZ_SYSTEM_PROMPT,
  buildQuizUserPrompt,
  normalizeQuiz,
  balanceAnswerPositions,
} = require('../utils/quizBuilder');

/** Quiz / Q&A model. Falls back to DEFAULT_CHAT_MODEL if the preferred one is refused. */
const DEFAULT_CHAT_MODEL = 'gpt-4o-mini';
function preferredQuizModel() {
  return (
    String(process.env.OPENAI_QUIZ_MODEL || '').trim() ||
    String(process.env.OPENAI_EDUCATION_SUMMARY_MODEL || '').trim() ||
    DEFAULT_CHAT_MODEL
  );
}

/** True when OpenAI refused the model itself (unknown name, no access) rather than the request. */
function isModelUnavailableError(err) {
  const status = err?.status;
  const code = String(err?.code || err?.error?.code || '');
  const msg = String(err?.message || '');
  return (
    code === 'model_not_found' ||
    status === 404 ||
    (status === 403 && /model/i.test(msg)) ||
    (status === 400 && /model/i.test(msg) && /(not exist|not found|unsupported|invalid|access)/i.test(msg))
  );
}

/** chat.completions.create with one automatic retry on DEFAULT_CHAT_MODEL if the chosen model is unavailable. */
async function createChatCompletion(params) {
  try {
    return await openai.chat.completions.create(params);
  } catch (err) {
    if (params.model !== DEFAULT_CHAT_MODEL && isModelUnavailableError(err)) {
      console.warn(`⚠️  Model "${params.model}" unavailable (${err.status || err.code}); retrying with ${DEFAULT_CHAT_MODEL}.`);
      return openai.chat.completions.create({ ...params, model: DEFAULT_CHAT_MODEL });
    }
    throw err;
  }
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Run a load-change-save step, repeating it if Mongoose reports a VersionError.
 * During a live lecture several things write to the same meeting (annotation autosaves, new
 * whiteboard pages, live transcript chunks). When two overlap, the later save is refused
 * rather than risk writing to the wrong array slot; reloading and reapplying is always safe
 * here because each step only sets its own fields.
 */
async function withVersionRetry(step, attempts = 4) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await step();
    } catch (err) {
      if (err?.name !== 'VersionError') throw err;
      lastErr = err;
    }
  }
  throw lastErr;
}

/** Thrown inside a withVersionRetry step to send a specific HTTP status back. */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Load a meeting the signed-in teacher may use, or throw a 404 HttpError. */
async function loadOwnedMeeting(req) {
  const meeting = await Meeting.findById(req.params.id);
  if (!meeting) throw new HttpError(404, 'Meeting not found');
  const admin = await getAdminFromRequest(req);
  if (!canAccessMeeting(meeting, admin)) throw new HttpError(404, 'Meeting not found');
  return meeting;
}

function sendRouteError(res, error, fallbackMessage) {
  if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
  return res.status(500).json({ error: fallbackMessage });
}

const teacherRouter = express.Router();
const publicRouter = express.Router();

// Teacher endpoints require a signed-in account; the public recap uses its own recap token.
teacherRouter.use(requireAdmin);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function ensureRecapToken(meeting) {
  if (!meeting.recapToken) {
    meeting.recapToken = crypto.randomBytes(16).toString('hex');
  }
  return meeting.recapToken;
}

function recapUrl(meeting) {
  const baseUrl =
    process.env.MEETING_SUMMARY_BASE_URL ||
    process.env.CLIENT_BASE_URL ||
    'https://meetingassistant.portiqtechnologies.com';
  return `${String(baseUrl).replace(/\/+$/, '')}/recap/${meeting.recapToken}`;
}

// ---------------------------------------------------------------------------
// Slide upload (PDF -> one PNG per page via poppler's pdftoppm)
// ---------------------------------------------------------------------------

const SLIDE_UPLOAD_DIR = path.join(__dirname, '../../uploads/meetings/slides');

const slideUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 40 * 1024 * 1024 }, // 40MB — a slide-heavy PDF still fits comfortably
  fileFilter: (req, file, cb) => {
    const ok =
      file.mimetype === 'application/pdf' ||
      path.extname(file.originalname || '').toLowerCase() === '.pdf';
    if (!ok) return cb(new Error('Only PDF slide decks are supported. Export your PPT to PDF and upload that.'), false);
    cb(null, true);
  },
});

/** Rasterize a PDF buffer to one PNG per page using pdftoppm. Returns absolute PNG paths, in page order. */
function rasterizePdfToPngs(pdfBuffer, outDir, prefix) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(outDir, { recursive: true });
    const tmpPdfPath = path.join(outDir, `${prefix}-source.pdf`);
    fs.writeFileSync(tmpPdfPath, pdfBuffer);
    const outPrefix = path.join(outDir, prefix);
    // -r 150: 150dpi is sharp enough to read on a projector/screen without huge file sizes.
    execFile('pdftoppm', ['-png', '-r', '150', tmpPdfPath, outPrefix], (err) => {
      // Clean up the source PDF either way — only the rasterized pages are kept.
      fs.unlink(tmpPdfPath, () => {});
      if (err) return reject(new Error(`Slide rendering failed: ${err.message}`));
      const files = fs
        .readdirSync(outDir)
        .filter((f) => f.startsWith(`${prefix}-`) && f.endsWith('.png'))
        // pdftoppm names pages prefix-1.png, prefix-2.png, ... prefix-10.png — sort numerically, not lexically.
        .sort((a, b) => {
          const na = parseInt(a.match(/-(\d+)\.png$/)?.[1] || '0', 10);
          const nb = parseInt(b.match(/-(\d+)\.png$/)?.[1] || '0', 10);
          return na - nb;
        })
        .map((f) => path.join(outDir, f));
      if (files.length === 0) return reject(new Error('No pages found in the uploaded PDF.'));
      resolve(files);
    });
  });
}

teacherRouter.post('/:id/slides', slideUpload.single('deck'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded (field name: deck).' });
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });

    const outDir = path.join(SLIDE_UPLOAD_DIR, String(meeting._id));
    // Wipe any previous deck for this lecture before rasterizing the new one.
    if (fs.existsSync(outDir)) fs.rmSync(outDir, { recursive: true, force: true });
    const prefix = `slide-${Date.now()}`;
    const pngPaths = await rasterizePdfToPngs(req.file.buffer, outDir, prefix);

    const slides = pngPaths.map((absPath, i) => ({
      index: i,
      imageUrl: `/uploads/meetings/slides/${meeting._id}/${path.basename(absPath)}`,
      shownAt: null,
      annotations: null,
      annotatedAt: null,
    }));

    meeting.slideDeck = {
      fileName: req.file.originalname || 'slides.pdf',
      pageCount: slides.length,
      uploadedAt: new Date(),
      slides,
    };
    ensureRecapToken(meeting);
    await meeting.save();

    res.json({ success: true, slideDeck: meeting.slideDeck, recapUrl: recapUrl(meeting) });
  } catch (error) {
    console.error('Error uploading slide deck:', error);
    res.status(500).json({ error: 'Failed to process slide deck', details: error.message });
  }
});

// ---------------------------------------------------------------------------
// Live lecture: mark a slide as shown, save annotations drawn on it
// ---------------------------------------------------------------------------

teacherRouter.post('/:id/slides/:index/shown', async (req, res) => {
  try {
    const idx = parseInt(req.params.index, 10);
    await withVersionRetry(async () => {
      const meeting = await loadOwnedMeeting(req);
      const slide = (meeting.slideDeck?.slides || []).find((s) => s.index === idx);
      if (!slide) throw new HttpError(404, 'Slide not found');
      if (slide.shownAt) return;
      slide.shownAt = new Date();
      await meeting.save();
    });
    res.json({ success: true });
  } catch (error) {
    if (!(error instanceof HttpError)) console.error('Error marking slide shown:', error);
    sendRouteError(res, error, 'Failed to update slide');
  }
});

teacherRouter.put('/:id/slides/:index/annotations', async (req, res) => {
  try {
    const idx = parseInt(req.params.index, 10);
    const annotations = req.body?.annotations ?? null;
    await withVersionRetry(async () => {
      const meeting = await loadOwnedMeeting(req);
      const slide = (meeting.slideDeck?.slides || []).find((s) => s.index === idx);
      if (!slide) throw new HttpError(404, 'Slide not found');
      slide.annotations = annotations;
      slide.annotatedAt = new Date();
      // Drawing on a slide implies the teacher is showing it right now.
      if (!slide.shownAt) slide.shownAt = new Date();
      await meeting.save();
    });
    res.json({ success: true });
  } catch (error) {
    if (!(error instanceof HttpError)) console.error('Error saving slide annotations:', error);
    sendRouteError(res, error, 'Failed to save annotations');
  }
});

// ---------------------------------------------------------------------------
// Live lecture: whiteboard pages (blank canvas, alternative to slides).
// Mirrors the slide endpoints above — same "touched implies shown" rule, same
// Fabric.js JSON blob shape — so the client can treat both page types almost
// identically once fetched.
// ---------------------------------------------------------------------------

const MAX_WHITEBOARD_PAGES = 30; // generous for a single lecture; guards against runaway growth

/** Add a new blank whiteboard page and return the full updated page list. */
teacherRouter.post('/:id/whiteboard/pages', async (req, res) => {
  try {
    const pages = await withVersionRetry(async () => {
      const meeting = await loadOwnedMeeting(req);
      if (!meeting.whiteboard) meeting.whiteboard = { pages: [] };
      const current = meeting.whiteboard.pages || [];
      if (current.length >= MAX_WHITEBOARD_PAGES) {
        throw new HttpError(400, `Whiteboard page limit reached (${MAX_WHITEBOARD_PAGES}).`);
      }
      const nextIndex = current.length ? Math.max(...current.map((p) => p.index)) + 1 : 0;
      current.push({ index: nextIndex, annotations: null, touchedAt: null, updatedAt: null });
      meeting.whiteboard.pages = current;
      ensureRecapToken(meeting);
      await meeting.save();
      return meeting.whiteboard.pages;
    });
    res.json({ success: true, pages });
  } catch (error) {
    if (!(error instanceof HttpError)) console.error('Error adding whiteboard page:', error);
    sendRouteError(res, error, 'Failed to add whiteboard page');
  }
});

/** Mark a whiteboard page as shown (navigated to), even before anything is drawn on it. */
teacherRouter.post('/:id/whiteboard/pages/:index/shown', async (req, res) => {
  try {
    const idx = parseInt(req.params.index, 10);
    await withVersionRetry(async () => {
      const meeting = await loadOwnedMeeting(req);
      const page = (meeting.whiteboard?.pages || []).find((p) => p.index === idx);
      if (!page) throw new HttpError(404, 'Whiteboard page not found');
      if (page.touchedAt) return;
      page.touchedAt = new Date();
      await meeting.save();
    });
    res.json({ success: true });
  } catch (error) {
    if (!(error instanceof HttpError)) console.error('Error marking whiteboard page shown:', error);
    sendRouteError(res, error, 'Failed to update whiteboard page');
  }
});

teacherRouter.put('/:id/whiteboard/pages/:index/annotations', async (req, res) => {
  try {
    const idx = parseInt(req.params.index, 10);
    const annotations = req.body?.annotations ?? null;
    await withVersionRetry(async () => {
      const meeting = await loadOwnedMeeting(req);
      const page = (meeting.whiteboard?.pages || []).find((p) => p.index === idx);
      if (!page) throw new HttpError(404, 'Whiteboard page not found');
      page.annotations = annotations;
      page.updatedAt = new Date();
      if (!page.touchedAt) page.touchedAt = new Date();
      await meeting.save();
    });
    res.json({ success: true });
  } catch (error) {
    if (!(error instanceof HttpError)) console.error('Error saving whiteboard annotations:', error);
    sendRouteError(res, error, 'Failed to save whiteboard annotations');
  }
});

// ---------------------------------------------------------------------------
// Quiz generation — one GPT call over the (already-generated) lecture summary.
// Deliberately separate from the main summary pipeline in meetingTranscription.js:
// if this call fails, the lecture summary/email flow is completely unaffected.
// ---------------------------------------------------------------------------

/** One model call → cleaned, validated questions (possibly fewer than asked for). */
async function requestQuizQuestions(meeting, { count, avoid }) {
  const summary =
    String(meeting.summary || '').trim() || String(meeting.pendingSummary || '').trim();
  const keyPoints =
    Array.isArray(meeting.keyPoints) && meeting.keyPoints.length ? meeting.keyPoints : meeting.pendingKeyPoints || [];
  const completion = await createChatCompletion({
    model: preferredQuizModel(),
    temperature: 0.5,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: QUIZ_SYSTEM_PROMPT },
      {
        role: 'user',
        content: buildQuizUserPrompt({
          title: meeting.title,
          subject: meeting.educationSubject,
          summary,
          keyPoints,
          transcript: meeting.transcription,
          revisionQuestions: meeting.revisionQuestions || meeting.pendingRevisionQuestions,
          count,
          avoid,
        }),
      },
    ],
  });
  let parsed;
  try {
    parsed = JSON.parse(completion.choices?.[0]?.message?.content || '');
  } catch {
    return [];
  }
  return normalizeQuiz(parsed, { limit: count, existing: avoid });
}

teacherRouter.post('/:id/quiz/generate', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });
    if (!openai) return res.status(503).json({ error: 'AI quiz generation is not configured (missing OPENAI_API_KEY).' });

    const hasSource =
      String(meeting.summary || '').trim() ||
      String(meeting.pendingSummary || '').trim() ||
      String(meeting.transcription || '').trim();
    if (!hasSource) {
      return res.status(400).json({ error: 'The lecture notes are not ready yet. Generate the quiz once the summary appears.' });
    }

    // Ask for the full set; if validation drops any (duplicate options, "all of the above",
    // a missing answer key), ask once more for just the missing ones.
    let questions = await requestQuizQuestions(meeting, { count: QUIZ_SIZE, avoid: [] });
    if (questions.length < QUIZ_SIZE) {
      try {
        const more = await requestQuizQuestions(meeting, { count: QUIZ_SIZE - questions.length, avoid: questions });
        questions = questions.concat(more).slice(0, QUIZ_SIZE);
      } catch (topUpErr) {
        console.warn('Quiz top-up call failed (keeping what we have):', topUpErr.message);
      }
    }
    if (questions.length < 3) {
      return res.status(502).json({ error: 'Could not write a good quiz from this lecture. Try again in a moment.' });
    }

    // Regenerating replaces the questions but keeps the teacher's mandatory setting and the
    // attempts already recorded (their per-question answers are tied to the old set by date).
    const generatedAt = new Date();
    const quiz = await withVersionRetry(async () => {
      const fresh = await Meeting.findById(req.params.id);
      if (!fresh) throw new HttpError(404, 'Meeting not found');
      fresh.quiz = {
        generatedAt,
        questions: balanceAnswerPositions(questions),
        mandatory: Boolean(fresh.quiz?.mandatory),
        attempts: fresh.quiz?.attempts || [],
      };
      ensureRecapToken(fresh);
      await fresh.save();
      meeting.recapToken = fresh.recapToken;
      return fresh.quiz;
    });

    res.json({ success: true, quiz, recapUrl: recapUrl(meeting) });
  } catch (error) {
    console.error('Error generating quiz:', error);
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message });
    res.status(500).json({ error: 'Could not generate the quiz right now. Try again in a moment.', details: error.message });
  }
});

/** Teacher toggles whether every student must attempt this lecture's quiz. */
teacherRouter.put('/:id/quiz/mandatory', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });
    if (!meeting.quiz?.questions?.length) {
      return res.status(400).json({ error: 'Generate a quiz for this lecture first.' });
    }

    meeting.quiz.mandatory = Boolean(req.body?.mandatory);
    await meeting.save();
    res.json({ success: true, mandatory: meeting.quiz.mandatory });
  } catch (error) {
    console.error('Error updating quiz mandatory flag:', error);
    res.status(500).json({ error: 'Failed to update quiz setting' });
  }
});

/**
 * Every quiz attempt across every one of this teacher's lectures, newest first —
 * who took it, their score, and whether it was mandatory when they took it. This
 * is deliberately its own page (reached from the sidebar), not part of the main
 * dashboard, since it's a drill-down a teacher checks on demand rather than a
 * headline number.
 */
teacherRouter.get('/quiz-results/summary', async (req, res) => {
  try {
    const admin = await getAdminFromRequest(req);
    // Include lectures with at least one attempt, and mandatory quizzes with zero
    // attempts so far — a teacher needs to see "no one has done it yet" too.
    const filter = {
      $or: [{ 'quiz.attempts.0': { $exists: true } }, { 'quiz.mandatory': true, 'quiz.questions.0': { $exists: true } }],
    };
    if (admin && admin.username !== 'admin') {
      filter.adminId = admin._id;
    }
    const meetings = await Meeting.find(filter)
      .select('title educationSubject educationTeacherName educationClassroomName startTime createdAt quiz participants')
      .sort({ createdAt: -1 })
      .limit(300);

    const lectures = meetings.map((m) => {
      const questions = m.quiz?.questions || [];
      const attempts = [...(m.quiz?.attempts || [])].sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
      const quizStamp = m.quiz?.generatedAt ? new Date(m.quiz.generatedAt).getTime() : null;

      // Per-question: how many of the attempts on THIS question set got it right.
      const comparable = attempts.filter(
        (a) =>
          Array.isArray(a.answers) &&
          a.answers.length === questions.length &&
          quizStamp !== null &&
          a.quizGeneratedAt &&
          new Date(a.quizGeneratedAt).getTime() === quizStamp
      );
      const questionStats = questions.map((q, i) => ({
        index: i,
        question: q.question,
        topic: q.topic || '',
        answered: comparable.length,
        correct: comparable.filter((a) => a.answers[i] === q.correctIndex).length,
      }));

      // Class list for this lecture, so the page can show who has not attempted yet.
      const seenEmails = new Set();
      const roster = (m.participants || [])
        .map((p) => ({ name: String(p?.name || '').trim(), email: String(p?.email || '').trim().toLowerCase() }))
        .filter((p) => {
          if (!p.email || seenEmails.has(p.email)) return false;
          seenEmails.add(p.email);
          return true;
        });

      return {
        id: m._id,
        title: m.title,
        subject: m.educationSubject || '',
        courseName: m.educationClassroomName || '',
        teacherName: m.educationTeacherName || '',
        lectureDate: m.startTime || m.createdAt,
        mandatory: Boolean(m.quiz?.mandatory),
        questionCount: questions.length,
        questionStats,
        roster,
        attempts: attempts.map((a) => ({
          studentName: a.studentName || '',
          studentEmail: a.studentEmail || '',
          score: a.score,
          total: a.total,
          submittedAt: a.submittedAt,
        })),
      };
    });

    res.json({ lectures });
  } catch (error) {
    console.error('Error fetching quiz results summary:', error);
    res.status(500).json({ error: 'Failed to fetch quiz results' });
  }
});

/** Explicitly fetch/create this lecture's recap link (e.g. to show a "copy link" button before slides/quiz exist). */
teacherRouter.get('/:id/recap-link', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });
    ensureRecapToken(meeting);
    await meeting.save();
    res.json({ recapUrl: recapUrl(meeting) });
  } catch (error) {
    console.error('Error fetching recap link:', error);
    res.status(500).json({ error: 'Failed to get recap link' });
  }
});

/**
 * Email the recap link to every participant. Deliberately a separate, small email
 * (not a change to sendMeetingSummary in meetingTranscription.js) so this feature
 * can never regress the main lecture-summary email.
 */
teacherRouter.post('/:id/recap/send', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });
    if (!isEmailConfigured()) return res.status(503).json({ error: 'Email is not configured on this server.' });

    ensureRecapToken(meeting);
    await meeting.save();
    const url = recapUrl(meeting);
    const emails = Array.from(
      new Set((meeting.participants || []).map((p) => String(p?.email || '').trim().toLowerCase()).filter(Boolean))
    );
    if (emails.length === 0) return res.status(400).json({ error: 'This lecture has no student emails to send to.' });

    const title = escapeHtml(meeting.title || 'your lecture');
    const hasQuiz = (meeting.quiz?.questions || []).length > 0;
    const mandatory = hasQuiz && Boolean(meeting.quiz?.mandatory);
    const teacher = escapeHtml(meeting.educationTeacherName || '');
    const subject = `Lecture recap: ${meeting.title || 'your lecture'}${mandatory ? ' (quiz required)' : ''}`;
    const html =
      `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0b1530;line-height:1.55;font-size:15px;">` +
      `<p>Hi,</p>` +
      `<p>The recap for <strong>${title}</strong>${teacher ? ` with ${teacher}` : ''} is ready. It has what was covered in class with the notes written on it, ` +
      `the lecture notes${hasQuiz ? ', and a short quiz to check your understanding' : ''}. You can also ask questions about the lecture there.</p>` +
      (mandatory ? `<p><strong>The quiz is required.</strong> Enter your name and college email when you take it so your attempt is recorded.</p>` : '') +
      `<p><a href="${url}" style="display:inline-block;padding:11px 20px;background:#1f6bff;color:#fff;` +
      `border-radius:10px;text-decoration:none;font-weight:600;">Open lecture recap</a></p>` +
      `<p style="color:#5b6785;font-size:13px;">Or copy this link: ${url}</p>` +
      `</div>`;
    const text =
      `The recap for "${meeting.title || 'your lecture'}" is ready: ${url}` +
      (mandatory ? `\n\nThe quiz is required. Enter your name and college email when you take it.` : '');

    // Students go in BCC so nobody sees the rest of the class's addresses; the teacher is the
    // visible recipient and so gets a copy as confirmation. Sent in groups because mail
    // providers cap recipients per message (Resend: 50).
    const teacherEmail = String(meeting.educationTeacherEmail || '').trim().toLowerCase();
    const students = emails.filter((e) => e !== teacherEmail);
    const GROUP = 45;
    let sent = 0;
    const failed = [];
    for (let i = 0; i < students.length; i += GROUP) {
      const group = students.slice(i, i + GROUP);
      const message = teacherEmail
        ? { to: teacherEmail, bcc: group, subject, html, text }
        : { to: group, subject, html, text };
      let ok = false;
      try {
        const result = await sendEmail(message);
        ok = Boolean(result && result.success !== false);
      } catch (sendErr) {
        console.error('Recap email group failed:', sendErr.message);
      }
      if (ok) sent += group.length;
      else failed.push(...group);
    }
    if (students.length === 0 && teacherEmail) {
      // Only the teacher is on the list (e.g. a test lecture): send it to them directly.
      const result = await sendEmail({ to: teacherEmail, subject, html, text }).catch(() => null);
      if (result && result.success !== false) sent = 1;
      else failed.push(teacherEmail);
    }

    if (sent === 0) {
      return res.status(502).json({ error: 'The recap email could not be sent. Check the email settings and try again.', recapUrl: url });
    }
    res.json({ success: true, recapUrl: url, sent, total: Math.max(students.length, 1), failed });
  } catch (error) {
    console.error('Error sending recap email:', error);
    res.status(500).json({ error: 'Failed to send recap email', details: error.message });
  }
});

// ---------------------------------------------------------------------------
// Public, no-login student recap
// ---------------------------------------------------------------------------

publicRouter.get('/:token', async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ recapToken: req.params.token });
    if (!meeting) return res.status(404).json({ error: 'This lecture recap link is invalid or has expired.' });

    // Unified chronological timeline: slides and whiteboard pages the teacher
    // actually showed, interleaved in the order they were used during the lecture
    // (not slides-then-whiteboard) — a teacher may hop back and forth between the
    // two, and the recap should replay it the way it happened.
    const shownSlides = (meeting.slideDeck?.slides || [])
      .filter((s) => !!s.shownAt)
      .map((s) => ({
        type: 'slide',
        index: s.index,
        imageUrl: s.imageUrl,
        annotations: s.annotations,
        at: s.shownAt,
      }));
    const shownWhiteboardPages = (meeting.whiteboard?.pages || [])
      .filter((p) => !!p.touchedAt)
      .map((p) => ({
        type: 'whiteboard',
        index: p.index,
        annotations: p.annotations,
        at: p.touchedAt,
      }));
    const pages = [...shownSlides, ...shownWhiteboardPages]
      .sort((a, b) => new Date(a.at) - new Date(b.at))
      .map(({ at, ...rest }) => rest);

    // Strip answers — the public view never reveals correctIndex/explanation up front.
    const quizQuestions = (meeting.quiz?.questions || []).map((q, i) => ({
      index: i,
      question: q.question,
      options: q.options,
      topic: q.topic || '',
      difficulty: q.difficulty || '',
    }));

    // Notes appear here only once the teacher has reviewed and sent the summary (that is
    // when `summary` is filled from `pendingSummary`). `notesPending` lets the page say
    // "notes are on their way" instead of looking as if the lecture had none.
    const published = Boolean(String(meeting.summary || '').trim());
    const notesPending = !published && Boolean(String(meeting.pendingSummary || '').trim());

    res.json({
      title: meeting.title,
      subject: meeting.educationSubject || '',
      courseName: meeting.educationClassroomName || '',
      notesPending,
      teacherName: meeting.educationTeacherName || meeting.organizer || '',
      teacherContactAvailable: Boolean(String(meeting.educationTeacherEmail || '').trim()),
      lectureDate: meeting.startTime || meeting.createdAt,
      summary: meeting.summary || '',
      keyPoints: published ? meeting.keyPoints || [] : [],
      revisionQuestions: published ? meeting.revisionQuestions || '' : '',
      pages,
      // Back-compat alias: older recap clients (or anyone hitting this API directly)
      // read `slides`. Kept as slide-only entries in slide order.
      slides: shownSlides.map(({ type, at, ...rest }) => rest).sort((a, b) => a.index - b.index),
      quiz: quizQuestions,
      quizMandatory: Boolean(meeting.quiz?.mandatory) && quizQuestions.length > 0,
    });
  } catch (error) {
    console.error('Error loading public recap:', error);
    res.status(500).json({ error: 'Failed to load lecture recap' });
  }
});

publicRouter.post('/:token/quiz-attempt', async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ recapToken: req.params.token }).select('quiz');
    if (!meeting) return res.status(404).json({ error: 'This lecture recap link is invalid or has expired.' });

    const questions = meeting.quiz?.questions || [];
    if (questions.length === 0) return res.status(400).json({ error: 'This lecture does not have a quiz yet.' });

    const studentName = String(req.body?.studentName || '').trim().slice(0, 200);
    const studentEmail = String(req.body?.studentEmail || '').trim().toLowerCase().slice(0, 200);
    if (meeting.quiz?.mandatory && (!studentName || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(studentEmail))) {
      return res.status(400).json({ error: 'This quiz is required — enter your name and a valid email before submitting.' });
    }

    const rawAnswers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const answers = questions.map((_, i) => (Number.isInteger(rawAnswers[i]) ? rawAnswers[i] : -1));
    let score = 0;
    const results = questions.map((q, i) => {
      const chosen = answers[i];
      const correct = chosen === q.correctIndex;
      if (correct) score += 1;
      return {
        index: i,
        correct,
        chosenIndex: chosen,
        correctIndex: q.correctIndex,
        explanation: q.explanation,
        topic: q.topic || '',
      };
    });

    // Every attempt is recorded, named or not, so the teacher sees how the whole class did
    // whether or not the quiz was required. $push is atomic: a class submitting in the same
    // minute cannot overwrite each other. Best-effort — never blocks the score.
    try {
      await Meeting.updateOne(
        { _id: meeting._id },
        {
          $push: {
            'quiz.attempts': {
              studentName,
              studentEmail,
              score,
              total: questions.length,
              submittedAt: new Date(),
              answers,
              quizGeneratedAt: meeting.quiz?.generatedAt || null,
            },
          },
        }
      );
    } catch (saveErr) {
      console.error('Error saving quiz attempt (non-fatal):', saveErr);
    }

    res.json({ score, total: questions.length, results });
  } catch (error) {
    console.error('Error scoring quiz attempt:', error);
    res.status(500).json({ error: 'Failed to score quiz' });
  }
});

// ---------------------------------------------------------------------------
// Student Q&A: ask the AI a question about this lecture, and escalate to the
// teacher if the answer isn't good enough. No login required (token-scoped,
// same as the rest of the public recap), and every question is saved on the
// meeting so the teacher can see what students were confused about — see
// GET /:id/questions below.
// ---------------------------------------------------------------------------

const MAX_STUDENT_QUESTIONS = 200; // per lecture — generous, just a sanity cap

publicRouter.post('/:token/ask', async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ recapToken: req.params.token });
    if (!meeting) return res.status(404).json({ error: 'This lecture recap link is invalid or has expired.' });
    if (!openai) return res.status(503).json({ error: 'AI Q&A is not configured (missing OPENAI_API_KEY).' });

    const question = String(req.body?.question || '').trim().slice(0, 1000);
    if (!question) return res.status(400).json({ error: 'Enter a question first.' });

    const notes = String(meeting.summary || '').trim();
    const transcript = String(meeting.transcription || '').trim();
    if (!notes && !transcript) {
      return res.status(400).json({ error: 'This lecture has no notes or transcript yet to answer questions from.' });
    }
    // Transcript first: it is what was actually said. The notes help with structure.
    const context =
      (transcript ? `TRANSCRIPT (speech-to-text, may contain mis-heard words; this is what was taught):\n${transcript.slice(0, 14000)}\n\n` : '') +
      (notes ? `Lecture notes (summary of the above; if they differ, the transcript wins):\n${notes.slice(0, 8000)}` : '');

    const completion = await createChatCompletion({
      model: preferredQuizModel(),
      temperature: 0.3,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content:
            'You are a patient teaching assistant answering a student\'s question about ONE specific lecture, using only the lecture ' +
            'material you are given — above all what the teacher actually said in the transcript. Answer the question directly in the first sentence, then explain in two to five short sentences ' +
            'the way a good tutor would, using the examples and numbers from this lecture where they help. Plain text only: no ' +
            'markdown, no headings, no bullet symbols. If the material does not cover what they ask, say so plainly in one sentence ' +
            'and suggest they send the question to their teacher; do not guess or bring in outside facts. If they ask for a quiz ' +
            'answer, explain the idea rather than naming an option.',
        },
        {
          role: 'user',
          content:
            `Lecture: ${meeting.title || 'Untitled lecture'}${meeting.educationSubject ? ` (${meeting.educationSubject})` : ''}\n\n` +
            `${context}\n\nStudent question: ${question}`,
        },
      ],
    });

    const answer = String(completion.choices?.[0]?.message?.content || '').trim() || 'Sorry, I could not generate an answer just now.';

    // Best-effort — a save failure here shouldn't block the student from getting their answer.
    try {
      if (!Array.isArray(meeting.studentQuestions)) meeting.studentQuestions = [];
      meeting.studentQuestions.push({ question, aiAnswer: answer, askedAt: new Date() });
      if (meeting.studentQuestions.length > MAX_STUDENT_QUESTIONS) {
        meeting.studentQuestions = meeting.studentQuestions.slice(-MAX_STUDENT_QUESTIONS);
      }
      await meeting.save();
    } catch (saveErr) {
      console.error('Error saving student question (non-fatal):', saveErr);
    }

    res.json({ answer });
  } catch (error) {
    console.error('Error answering student question:', error);
    res.status(500).json({ error: 'Could not get an answer right now. Try again in a moment.' });
  }
});

/** Student wasn't satisfied with the AI's answer — email the teacher the question directly. */
publicRouter.post('/:token/escalate', async (req, res) => {
  try {
    const meeting = await Meeting.findOne({ recapToken: req.params.token });
    if (!meeting) return res.status(404).json({ error: 'This lecture recap link is invalid or has expired.' });

    const question = String(req.body?.question || '').trim().slice(0, 1000);
    const aiAnswer = String(req.body?.aiAnswer || '').trim().slice(0, 4000);
    const studentEmail = String(req.body?.studentEmail || '').trim().toLowerCase().slice(0, 200);
    if (!question) return res.status(400).json({ error: 'Missing the question to send.' });

    const teacherEmail = String(meeting.educationTeacherEmail || '').trim();
    if (!teacherEmail) {
      return res.status(400).json({ error: "This lecture doesn't have a teacher email on file to send this to." });
    }

    try {
      if (!Array.isArray(meeting.studentQuestions)) meeting.studentQuestions = [];
      meeting.studentQuestions.push({
        question,
        aiAnswer,
        askedAt: new Date(),
        escalated: true,
        escalatedAt: new Date(),
        studentEmail,
      });
      if (meeting.studentQuestions.length > MAX_STUDENT_QUESTIONS) {
        meeting.studentQuestions = meeting.studentQuestions.slice(-MAX_STUDENT_QUESTIONS);
      }
      await meeting.save();
    } catch (saveErr) {
      console.error('Error saving escalated question (non-fatal):', saveErr);
    }

    if (!isEmailConfigured()) {
      return res.status(503).json({ error: 'Saved your question, but email is not configured on this server.' });
    }
    const safeTitle = escapeHtml(meeting.title || 'your lecture');
    const result = await sendEmail({
      to: teacherEmail,
      subject: `Student question on "${meeting.title || 'your lecture'}"`,
      html:
        `<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0b1530;line-height:1.55;font-size:15px;">` +
        `<p>A student asked a question on the recap page for <strong>${safeTitle}</strong> and wanted your answer ` +
        `rather than the AI's.</p>` +
        `<p style="padding:12px 14px;background:#f1f5ff;border-radius:10px;"><strong>Question:</strong> ${escapeHtml(question)}</p>` +
        (aiAnswer
          ? `<p style="padding:12px 14px;background:#f6f7f9;border-radius:10px;"><strong>What the AI answered:</strong> ${escapeHtml(aiAnswer)}</p>`
          : '') +
        (studentEmail
          ? `<p>Reply to the student at <a href="mailto:${escapeHtml(studentEmail)}">${escapeHtml(studentEmail)}</a>.</p>`
          : `<p style="color:#5b6785;font-size:13px;">The student did not leave an email address.</p>`) +
        `</div>`,
      text:
        `Question: ${question}\n\n` +
        (aiAnswer ? `What the AI answered: ${aiAnswer}\n\n` : '') +
        (studentEmail ? `Student's email: ${studentEmail}` : 'The student did not leave an email address.'),
    }).catch((emailErr) => ({ success: false, error: emailErr.message }));
    if (!result || result.success === false) {
      console.error('Error emailing teacher for escalation:', result?.error);
      return res.status(502).json({ error: "Saved your question, but couldn't email your teacher right now." });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error escalating student question:', error);
    res.status(500).json({ error: 'Could not send this to your teacher right now.' });
  }
});

/** Teacher-facing: see every question students asked on this lecture's recap page. */
teacherRouter.get('/:id/questions', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });
    const questions = [...(meeting.studentQuestions || [])].sort((a, b) => new Date(b.askedAt) - new Date(a.askedAt));
    res.json({ questions });
  } catch (error) {
    console.error('Error fetching student questions:', error);
    res.status(500).json({ error: 'Failed to fetch student questions' });
  }
});

module.exports = { teacherRouter, publicRouter };
