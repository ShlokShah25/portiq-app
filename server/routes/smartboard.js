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
            '"options":["...","...","...","..."], "correctIndex":0, "explanation":"..."}, ...]}. ' +
            'Produce exactly 5 questions. Each question needs exactly 4 options and exactly one correct answer ' +
            '(correctIndex is 0-based). Questions must be answerable only from the lecture content given — no ' +
            'outside knowledge, no trick questions. Vary question type: recall, application, and one "why/because" ' +
            'reasoning question. Keep each option short (a phrase, not a paragraph). explanation is one sentence ' +
            'on why the correct answer is right, shown to the student after they answer.',
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
      }))
      .filter((q) => q.question && q.options.length === 4 && q.correctIndex >= 0 && q.correctIndex < 4);

    if (cleanQuestions.length === 0) {
      return res.status(502).json({ error: 'AI did not return a usable quiz. Try again.' });
    }

    meeting.quiz = { generatedAt: new Date(), questions: cleanQuestions };
    ensureRecapToken(meeting);
    await meeting.save();

    res.json({ success: true, quiz: meeting.quiz, recapUrl: recapUrl(meeting) });
  } catch (error) {
    console.error('Error generating quiz:', error);
    res.status(500).json({ error: 'Failed to generate quiz', details: error.message });
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
    }));

    res.json({
      title: meeting.title,
      subject: meeting.educationSubject || '',
      teacherName: meeting.educationTeacherName || meeting.organizer || '',
      lectureDate: meeting.startTime || meeting.createdAt,
      summary: meeting.summary || '',
      keyPoints: meeting.keyPoints || [],
      revisionQuestions: meeting.revisionQuestions || '',
      pages,
      // Back-compat alias: older recap clients (or anyone hitting this API directly)
      // read `slides`. Kept as slide-only entries in slide order.
      slides: shownSlides.map(({ type, at, ...rest }) => rest).sort((a, b) => a.index - b.index),
      quiz: quizQuestions,
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

    const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
    const questions = meeting.quiz?.questions || [];
    let score = 0;
    const results = questions.map((q, i) => {
      const chosen = Number.isInteger(answers[i]) ? answers[i] : -1;
      const correct = chosen === q.correctIndex;
      if (correct) score += 1;
      return { index: i, correct, chosenIndex: chosen, correctIndex: q.correctIndex, explanation: q.explanation };
    });

    res.json({ score, total: questions.length, results });
  } catch (error) {
    console.error('Error scoring quiz attempt:', error);
    res.status(500).json({ error: 'Failed to score quiz' });
  }
});

module.exports = { teacherRouter, publicRouter };
