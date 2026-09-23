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
const jwt = require('jsonwebtoken');

const Meeting = require('../models/Meeting');
const Admin = require('../models/Admin');
const { sendEmail, isEmailConfigured } = require('../utils/emailService');

let openai = null;
if (process.env.OPENAI_API_KEY) {
  const OpenAI = require('openai');
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 120000 });
}

const teacherRouter = express.Router();
const publicRouter = express.Router();

// ---------------------------------------------------------------------------
// Shared helpers (small local copies of routes/meetings.js's — not exported
// there, and duplicating a 15-line auth check is cheaper than coupling files).
// ---------------------------------------------------------------------------

async function getAdminFromRequest(req) {
  try {
    const header = req.header('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.replace('Bearer ', '') : null;
    if (!token) return null;
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your_secret_key');
    if (!decoded.id) return null;
    return await Admin.findById(decoded.id).select('-password');
  } catch {
    return null;
  }
}

function canAccessMeeting(meeting, admin) {
  if (!meeting) return false;
  if (!admin || admin.username === 'admin') return true;
  if (!meeting.adminId) return true;
  return String(meeting.adminId) === String(admin._id);
}

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
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });

    const idx = parseInt(req.params.index, 10);
    const slide = (meeting.slideDeck?.slides || []).find((s) => s.index === idx);
    if (!slide) return res.status(404).json({ error: 'Slide not found' });
    if (!slide.shownAt) slide.shownAt = new Date();
    await meeting.save();
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking slide shown:', error);
    res.status(500).json({ error: 'Failed to update slide' });
  }
});

teacherRouter.put('/:id/slides/:index/annotations', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });

    const idx = parseInt(req.params.index, 10);
    const slide = (meeting.slideDeck?.slides || []).find((s) => s.index === idx);
    if (!slide) return res.status(404).json({ error: 'Slide not found' });

    slide.annotations = req.body?.annotations ?? null;
    slide.annotatedAt = new Date();
    // Drawing on a slide implies the teacher is showing it right now.
    if (!slide.shownAt) slide.shownAt = new Date();
    await meeting.save();
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving slide annotations:', error);
    res.status(500).json({ error: 'Failed to save annotations' });
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
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });

    if (!meeting.whiteboard) meeting.whiteboard = { pages: [] };
    const pages = meeting.whiteboard.pages || [];
    if (pages.length >= MAX_WHITEBOARD_PAGES) {
      return res.status(400).json({ error: `Whiteboard page limit reached (${MAX_WHITEBOARD_PAGES}).` });
    }
    const nextIndex = pages.length ? Math.max(...pages.map((p) => p.index)) + 1 : 0;
    pages.push({ index: nextIndex, annotations: null, touchedAt: null, updatedAt: null });
    meeting.whiteboard.pages = pages;
    await meeting.save();
    res.json({ success: true, pages: meeting.whiteboard.pages });
  } catch (error) {
    console.error('Error adding whiteboard page:', error);
    res.status(500).json({ error: 'Failed to add whiteboard page' });
  }
});

/** Mark a whiteboard page as shown (navigated to), even before anything is drawn on it. */
teacherRouter.post('/:id/whiteboard/pages/:index/shown', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });

    const idx = parseInt(req.params.index, 10);
    const page = (meeting.whiteboard?.pages || []).find((p) => p.index === idx);
    if (!page) return res.status(404).json({ error: 'Whiteboard page not found' });
    if (!page.touchedAt) page.touchedAt = new Date();
    await meeting.save();
    res.json({ success: true });
  } catch (error) {
    console.error('Error marking whiteboard page shown:', error);
    res.status(500).json({ error: 'Failed to update whiteboard page' });
  }
});

teacherRouter.put('/:id/whiteboard/pages/:index/annotations', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });

    const idx = parseInt(req.params.index, 10);
    const page = (meeting.whiteboard?.pages || []).find((p) => p.index === idx);
    if (!page) return res.status(404).json({ error: 'Whiteboard page not found' });

    page.annotations = req.body?.annotations ?? null;
    page.updatedAt = new Date();
    if (!page.touchedAt) page.touchedAt = new Date();
    await meeting.save();
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving whiteboard annotations:', error);
    res.status(500).json({ error: 'Failed to save whiteboard annotations' });
  }
});

// ---------------------------------------------------------------------------
// Quiz generation — one GPT call over the (already-generated) lecture summary.
// Deliberately separate from the main summary pipeline in meetingTranscription.js:
// if this call fails, the lecture summary/email flow is completely unaffected.
// ---------------------------------------------------------------------------

teacherRouter.post('/:id/quiz/generate', async (req, res) => {
  try {
    const meeting = await Meeting.findById(req.params.id);
    if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
    const admin = await getAdminFromRequest(req);
    if (!canAccessMeeting(meeting, admin)) return res.status(404).json({ error: 'Meeting not found' });
    if (!openai) return res.status(503).json({ error: 'AI quiz generation is not configured (missing OPENAI_API_KEY).' });

    const summarySource =
      String(meeting.summary || '').trim() ||
      String(meeting.pendingSummary || '').trim() ||
      String(meeting.transcription || '').trim();
    if (!summarySource) {
      return res.status(400).json({ error: 'This lecture has no summary or transcript yet to quiz on.' });
    }
    const revisionQuestions = String(meeting.revisionQuestions || meeting.pendingRevisionQuestions || '').trim();

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You write short multiple-choice quizzes that check whether a student was paying attention in class ' +
            'and understood the material. Respond with JSON only: {"questions":[{"question":"...", ' +
            '"options":["...","...","...","..."], "correctIndex":0, "explanation":"...", "topic":"..."}, ...]}. ' +
            'Produce exactly 5 questions. Each question needs exactly 4 options and exactly one correct answer ' +
            '(correctIndex is 0-based). Questions must be answerable only from the lecture content given — no ' +
            'outside knowledge, no trick questions. Vary question type: recall, application, and one "why/because" ' +
            'reasoning question. Keep each option short (a phrase, not a paragraph). explanation is one sentence ' +
            'on why the correct answer is right, shown to the student after they answer. topic is a short (2-4 word) ' +
            'label for the specific concept this question tests (e.g. "Supervised Learning"), used to group results.',
        },
        {
          role: 'user',
          content:
            `Lecture summary:\n${summarySource.slice(0, 12000)}` +
            (revisionQuestions ? `\n\nRevision questions already written for this lecture (for context, do not repeat verbatim):\n${revisionQuestions}` : ''),
        },
      ],
    });

    let parsed;
    try {
      parsed = JSON.parse(completion.choices[0].message.content);
    } catch {
      throw new Error('AI response was not valid JSON');
    }
    const questions = Array.isArray(parsed?.questions) ? parsed.questions.slice(0, 5) : [];
    const cleanQuestions = questions
      .map((q) => ({
        question: String(q?.question || '').trim(),
        options: Array.isArray(q?.options) ? q.options.slice(0, 4).map((o) => String(o || '').trim()) : [],
        correctIndex: Number.isInteger(q?.correctIndex) ? q.correctIndex : -1,
        explanation: String(q?.explanation || '').trim(),
        topic: String(q?.topic || '').trim().slice(0, 60),
      }))
      .filter((q) => q.question && q.options.length === 4 && q.correctIndex >= 0 && q.correctIndex < 4);

    if (cleanQuestions.length === 0) {
      return res.status(502).json({ error: 'AI did not return a usable quiz. Try again.' });
    }

    // Regenerating a quiz replaces its questions but keeps the teacher's mandatory
    // setting and any attempts already recorded against the old question set.
    meeting.quiz = {
      generatedAt: new Date(),
      questions: cleanQuestions,
      mandatory: Boolean(meeting.quiz?.mandatory),
      attempts: meeting.quiz?.attempts || [],
    };
    ensureRecapToken(meeting);
    await meeting.save();

    res.json({ success: true, quiz: meeting.quiz, recapUrl: recapUrl(meeting) });
  } catch (error) {
    console.error('Error generating quiz:', error);
    res.status(500).json({ error: 'Failed to generate quiz', details: error.message });
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
      .select('title educationSubject educationTeacherName startTime createdAt quiz')
      .sort({ createdAt: -1 })
      .limit(300);

    const lectures = meetings.map((m) => ({
      id: m._id,
      title: m.title,
      subject: m.educationSubject || '',
      teacherName: m.educationTeacherName || '',
      lectureDate: m.startTime || m.createdAt,
      mandatory: Boolean(m.quiz?.mandatory),
      questionCount: m.quiz?.questions?.length || 0,
      attempts: [...(m.quiz?.attempts || [])]
        .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))
        .map((a) => ({
          studentName: a.studentName || '',
          studentEmail: a.studentEmail || '',
          score: a.score,
          total: a.total,
          submittedAt: a.submittedAt,
        })),
    }));

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
    const emails = (meeting.participants || []).map((p) => p.email).filter(Boolean);
    if (emails.length === 0) return res.status(400).json({ error: 'This lecture has no participant emails to send to.' });

    await sendEmail({
      to: emails,
      subject: `Interactive Lecture Recap – ${meeting.title} | PortIQ Education`,
      html:
        `<p>Hi,</p>` +
        `<p>Here's the interactive recap for <strong>${meeting.title}</strong> — the slides covered in class ` +
        `with your teacher's notes on them, the lecture summary, and a 5-question quiz to check your understanding.</p>` +
        `<p><a href="${url}" style="display:inline-block;padding:10px 18px;background:#4f46e5;color:#fff;` +
        `border-radius:8px;text-decoration:none;font-weight:600;">Open lecture recap</a></p>` +
        `<p style="color:#666;font-size:13px;">Or copy this link: ${url}</p>`,
      text: `Interactive recap for "${meeting.title}": ${url}`,
    });

    res.json({ success: true, recapUrl: url });
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
    }));

    res.json({
      title: meeting.title,
      subject: meeting.educationSubject || '',
      teacherName: meeting.educationTeacherName || meeting.organizer || '',
      teacherContactAvailable: Boolean(String(meeting.educationTeacherEmail || '').trim()),
      lectureDate: meeting.startTime || meeting.createdAt,
      summary: meeting.summary || '',
      keyPoints: meeting.keyPoints || [],
      revisionQuestions: meeting.revisionQuestions || '',
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
    const meeting = await Meeting.findOne({ recapToken: req.params.token });
    if (!meeting) return res.status(404).json({ error: 'This lecture recap link is invalid or has expired.' });

    const studentName = String(req.body?.studentName || '').trim().slice(0, 200);
    const studentEmail = String(req.body?.studentEmail || '').trim().toLowerCase().slice(0, 200);
    if (meeting.quiz?.mandatory && (!studentName || !studentEmail)) {
      return res.status(400).json({ error: 'This quiz is mandatory — enter your name and email before submitting.' });
    }

    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const questions = meeting.quiz?.questions || [];
    let score = 0;
    const results = questions.map((q, i) => {
      const chosen = Number.isInteger(answers[i]) ? answers[i] : -1;
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

    // Record the attempt (so the teacher can see who took it) whenever the
    // student gave a name/email — best-effort, never blocks the score response.
    if (studentName || studentEmail) {
      try {
        if (!meeting.quiz.attempts) meeting.quiz.attempts = [];
        meeting.quiz.attempts.push({ studentName, studentEmail, score, total: questions.length, submittedAt: new Date() });
        await meeting.save();
      } catch (saveErr) {
        console.error('Error saving quiz attempt (non-fatal):', saveErr);
      }
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

    const context =
      String(meeting.summary || '').trim() ||
      String(meeting.transcription || '').trim();
    if (!context) {
      return res.status(400).json({ error: 'This lecture has no summary or transcript yet to answer questions from.' });
    }

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.3,
      messages: [
        {
          role: 'system',
          content:
            'You answer a student\'s question about one specific class lecture, using only the lecture summary/' +
            'transcript given to you. Be concise and direct — a few sentences, not an essay. If the material given ' +
            'does not actually cover what they are asking, say so plainly rather than guessing or using outside ' +
            'knowledge — the student can then ask their teacher instead.',
        },
        {
          role: 'user',
          content:
            `Lecture: ${meeting.title || 'Untitled lecture'}${meeting.educationSubject ? ` (${meeting.educationSubject})` : ''}\n\n` +
            `Lecture content:\n${context.slice(0, 12000)}\n\nStudent question: ${question}`,
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

    if (isEmailConfigured()) {
      try {
        await sendEmail({
          to: teacherEmail,
          replyTo: studentEmail || undefined,
          subject: `Student question on "${meeting.title}" — AI answer wasn't enough`,
          html:
            `<p>A student asked a question on the recap page for <strong>${meeting.title}</strong> and didn't find ` +
            `the AI's answer sufficient:</p>` +
            `<p style="padding:12px;background:#f4f4f5;border-radius:8px;"><strong>Question:</strong> ${question}</p>` +
            (aiAnswer
              ? `<p style="padding:12px;background:#f4f4f5;border-radius:8px;"><strong>AI's answer:</strong> ${aiAnswer}</p>`
              : '') +
            (studentEmail ? `<p style="color:#666;font-size:13px;">Student's email (for reply): ${studentEmail}</p>` : ''),
          text:
            `Question: ${question}\n\n` +
            (aiAnswer ? `AI's answer: ${aiAnswer}\n\n` : '') +
            (studentEmail ? `Student's email: ${studentEmail}` : ''),
        });
      } catch (emailErr) {
        console.error('Error emailing teacher for escalation:', emailErr);
        return res.status(502).json({ error: "Saved your question, but couldn't email your teacher right now." });
      }
    } else {
      return res.status(503).json({ error: 'Saved your question, but email is not configured on this server.' });
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
