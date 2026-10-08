/**
 * Lecture quiz helpers for server/routes/smartboard.js: the prompt, and the checks every
 * model-written question has to pass before a student sees it.
 *
 * Kept free of Express / Mongoose / OpenAI imports so it can be unit-tested on its own
 * (server/scripts/test-quiz-builder.js).
 */

const QUIZ_SIZE = 5;
const OPTIONS_PER_QUESTION = 4;

/** Options a model reaches for when it runs out of real distractors. They make a question guessable. */
const LAZY_OPTION_RE =
  /^(all|none|both|neither)\b.*\b(above|below|these|options?|them)\b|^(both\s+|only\s+)?\(?[a-d]\)?\s*(and|&|,|or)\s*\(?[a-d]\)?(\s+only)?$/i;

function cleanText(value) {
  return String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
}

/** "A) Paris", "b. Paris", "(C) Paris", "1) Paris" → "Paris". Models add labels even when told not to. */
function stripOptionLabel(option) {
  return cleanText(option).replace(/^\(?([A-Da-d]|[1-4])[).:\-]\s+/, '').trim();
}

function normalizeForCompare(text) {
  return cleanText(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const DIFFICULTIES = ['easy', 'medium', 'hard'];

/**
 * Turn one raw model question into a clean one, or return null if it is not usable.
 * The correct answer may be given as an index (correctIndex) or as the option's text (answer).
 */
function normalizeQuestion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const question = cleanText(raw.question);
  if (question.length < 8) return null;

  const rawOptions = Array.isArray(raw.options) ? raw.options : [];
  const options = rawOptions.map(stripOptionLabel).filter(Boolean);
  if (options.length !== OPTIONS_PER_QUESTION) return null;

  const seen = new Set(options.map(normalizeForCompare));
  if (seen.size !== OPTIONS_PER_QUESTION) return null; // two options say the same thing
  if (options.some((o) => LAZY_OPTION_RE.test(o))) return null;

  let correctIndex = -1;
  if (Number.isInteger(raw.correctIndex)) {
    correctIndex = raw.correctIndex;
  } else if (typeof raw.correctIndex === 'string' && /^\d+$/.test(raw.correctIndex.trim())) {
    correctIndex = parseInt(raw.correctIndex.trim(), 10);
  } else if (typeof raw.answer === 'string' && raw.answer.trim()) {
    const wanted = normalizeForCompare(stripOptionLabel(raw.answer));
    correctIndex = options.findIndex((o) => normalizeForCompare(o) === wanted);
    if (correctIndex < 0 && /^[A-Da-d]$/.test(raw.answer.trim())) {
      correctIndex = raw.answer.trim().toUpperCase().charCodeAt(0) - 65;
    }
  }
  if (!(correctIndex >= 0 && correctIndex < OPTIONS_PER_QUESTION)) return null;

  const difficulty = cleanText(raw.difficulty).toLowerCase();
  return {
    question,
    options,
    correctIndex,
    explanation: cleanText(raw.explanation).slice(0, 600),
    topic: cleanText(raw.topic).slice(0, 60),
    difficulty: DIFFICULTIES.includes(difficulty) ? difficulty : '',
  };
}

/**
 * Shuffle a question's options and keep track of where the right answer went.
 * Models put the correct answer in the same slot far more often than chance; a student who
 * notices "it's usually B" should not be able to score on that.
 * @param {function(): number} [random] - injectable for tests
 */
function shuffleQuestionOptions(q, random = Math.random) {
  const order = q.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return {
    ...q,
    options: order.map((i) => q.options[i]),
    correctIndex: order.indexOf(q.correctIndex),
  };
}

/**
 * Spread the correct answers across positions as evenly as a 5-question quiz allows, so the
 * key never reads A-A-A-B-A. Each question's options are rotated until its answer lands on the
 * least-used slot so far.
 */
function balanceAnswerPositions(questions, random = Math.random) {
  const used = new Array(OPTIONS_PER_QUESTION).fill(0);
  return questions.map((q) => {
    const shuffled = shuffleQuestionOptions(q, random);
    const least = Math.min(...used);
    const candidates = used.map((n, i) => (n === least ? i : -1)).filter((i) => i >= 0);
    const target = candidates[Math.floor(random() * candidates.length)];
    const options = shuffled.options.slice();
    if (shuffled.correctIndex !== target) {
      [options[shuffled.correctIndex], options[target]] = [options[target], options[shuffled.correctIndex]];
    }
    used[target] += 1;
    return { ...shuffled, options, correctIndex: target };
  });
}

/** Clean a model response: valid questions only, no near-duplicate stems, at most `limit`. */
function normalizeQuiz(parsed, { limit = QUIZ_SIZE, existing = [] } = {}) {
  const rawList = Array.isArray(parsed?.questions) ? parsed.questions : Array.isArray(parsed) ? parsed : [];
  const stems = new Set(existing.map((q) => normalizeForCompare(q.question)));
  const out = [];
  for (const raw of rawList) {
    const q = normalizeQuestion(raw);
    if (!q) continue;
    const stem = normalizeForCompare(q.question);
    if (stems.has(stem)) continue;
    stems.add(stem);
    out.push(q);
    if (out.length >= limit) break;
  }
  return out;
}

const QUIZ_SYSTEM_PROMPT =
  'You are an experienced university examiner writing a short multiple-choice quiz for the students who attended ONE specific lecture. ' +
  'The quiz has two jobs: let a student find out what they did not understand, and let the teacher see which ideas the class missed.\n\n' +
  'Respond with JSON only, in this exact shape:\n' +
  '{"questions":[{"question":"...","options":["...","...","...","..."],"correctIndex":0,"explanation":"...","topic":"...","difficulty":"easy|medium|hard"}]}\n\n' +
  'Rules for the set:\n' +
  '- Write exactly the number of questions asked for. Each one tests a DIFFERENT idea, and together they cover the lecture from start to finish, not just the opening.\n' +
  '- Mix the levels: about two that check a key definition or fact was understood (easy), two that make the student APPLY an idea to a small new situation or a worked example from the lecture (medium), and one that asks WHY something is true or how two ideas differ (hard).\n' +
  '- Everything must be answerable from the lecture material given. Do not test outside knowledge, and do not ask about logistics (dates, deadlines, attendance) or about the lecture itself ("what did the teacher discuss first").\n\n' +
  'Rules for each question:\n' +
  '- The question must stand on its own. Never write "according to the lecture", "as discussed in class" or "in the slide".\n' +
  '- Exactly 4 options, exactly one correct. correctIndex is the 0-based position of the correct option.\n' +
  '- Wrong options must be plausible to a student who half-understood: use the usual confusions and mix-ups for that idea. No joke options.\n' +
  '- All four options the same kind of thing, similar in length and grammar, so the right one does not stand out. Keep each to a short phrase or one short sentence.\n' +
  '- Never use "All of the above", "None of the above", "Both A and B", or letter labels inside the options.\n' +
  '- Avoid negative questions ("Which is NOT..."). No trick wording.\n' +
  '- If a formula or number is tested, use the values and notation from the lecture.\n' +
  '- explanation: one or two sentences shown after the student answers. Say why the right option is right and, where it helps, why the most tempting wrong one is wrong. Teach, do not just restate the answer.\n' +
  '- topic: a 2-4 word label for the idea tested (for example "Bias vs variance"). Questions on the same idea share the same label.\n' +
  '- Write in clear, plain English.';

/**
 * Build the user message. The summary is the cleaned-up structure of the lecture; the transcript
 * excerpt carries the worked examples and exact numbers that make application questions possible.
 */
function buildQuizUserPrompt({ title, subject, summary, keyPoints, transcript, revisionQuestions, count = QUIZ_SIZE, avoid = [] }) {
  const parts = [];
  parts.push(`Write ${count} question${count === 1 ? '' : 's'}.`);
  if (subject || title) {
    parts.push(`Subject: ${cleanText(subject) || 'not given'}\nLecture title (may be generic): ${cleanText(title) || 'not given'}`);
  }
  const kp = Array.isArray(keyPoints) ? keyPoints.map(cleanText).filter(Boolean) : [];
  if (kp.length) parts.push(`Key points:\n${kp.map((k) => `- ${k}`).join('\n')}`);
  if (cleanText(summary)) parts.push(`Lecture notes:\n${String(summary).trim().slice(0, 14000)}`);
  if (cleanText(transcript)) {
    parts.push(
      `Transcript excerpt (speech-to-text, may contain mis-heard words; use it for examples and exact figures):\n${String(transcript).trim().slice(0, 12000)}`
    );
  }
  if (cleanText(revisionQuestions)) {
    parts.push(`Open-ended revision questions already given to students (cover the same ideas, but do not copy them):\n${String(revisionQuestions).trim().slice(0, 2000)}`);
  }
  if (avoid.length) {
    parts.push(`Already written — do NOT repeat these or test the same idea again:\n${avoid.map((q) => `- ${q.question}`).join('\n')}`);
  }
  return parts.join('\n\n');
}

module.exports = {
  QUIZ_SIZE,
  OPTIONS_PER_QUESTION,
  QUIZ_SYSTEM_PROMPT,
  buildQuizUserPrompt,
  normalizeQuestion,
  normalizeQuiz,
  shuffleQuestionOptions,
  balanceAnswerPositions,
  stripOptionLabel,
  cleanText,
};
