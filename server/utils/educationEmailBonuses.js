/**
 * Optional extras for education lecture digest emails (English-only send path).
 */

const DEFAULT_FACTS = [
  'Spaced review — revisiting material over several days — is one of the most reliable ways to make learning stick.',
  'Explaining a concept in your own words (even briefly) deepens understanding more than re-reading alone.',
  'Sleep consolidates memory: a short review before bed can help tomorrow’s recall.',
  'Questions you almost get right are often more valuable for growth than questions you already know cold.',
  'PortIQ tip: keep one running list of “ideas to revisit” from each class — small notes compound into strong revision.',
];

const SUBJECT_KEYWORDS = [
  {
    match: ['math', 'algebra', 'geometry', 'calculus', 'statistics', 'arith'],
    facts: [
      'Many breakthroughs in math came from playing with patterns — curiosity often precedes proof.',
      'Estimation before exact calculation catches mistakes and builds number sense.',
      'The equals sign balances two views of the same idea — symmetry is a powerful problem-solving lens.',
    ],
  },
  {
    match: ['science', 'physics', 'chemistry', 'biology', 'lab', 'stem'],
    facts: [
      'Science advances when hypotheses meet careful measurement — documenting “what changed” matters as much as the answer.',
      'Many everyday materials behave differently at tiny scales — scale is a core scientific idea.',
      'Peer review exists because even careful observers benefit from a second look at evidence.',
    ],
  },
  {
    match: ['english', 'literature', 'writing', 'language', 'reading'],
    facts: [
      'Reading aloud engages different brain circuits than silent reading — both have a place in mastery.',
      'Strong writers revise: first drafts clarify thinking; editing clarifies communication.',
      'Context changes meaning — the same sentence can shift tone dramatically with a different audience.',
    ],
  },
  {
    match: ['history', 'social studies', 'civics', 'geography'],
    facts: [
      'Historians weigh multiple sources because every account has a viewpoint.',
      'Understanding “why then?” is often harder — and more enlightening — than memorizing dates alone.',
      'Maps are arguments: what is centered, labeled, or omitted shapes the story they tell.',
    ],
  },
  {
    match: ['computer', 'coding', 'programming', 'software', 'cs'],
    facts: [
      'Small, frequent tests of code beat rare big rewrites — tight feedback loops are a professional habit.',
      'Naming things well is a form of documentation your future self will thank you for.',
      'Most production bugs are logic errors, not syntax — reading code slowly is a legitimate technique.',
    ],
  },
  {
    match: ['art', 'music', 'drama', 'design', 'creative'],
    facts: [
      'Constraints often boost creativity — limits force choices that define style.',
      'Deliberate practice beats endless repetition: focus on one skill at a time.',
      'Sharing work early catches misunderstandings before they become expensive.',
    ],
  },
];

function poolForSubject(subjectRaw) {
  const s = String(subjectRaw || '').toLowerCase();
  if (!s.trim()) return DEFAULT_FACTS;
  for (const { match, facts } of SUBJECT_KEYWORDS) {
    if (match.some((k) => s.includes(k))) return facts;
  }
  return DEFAULT_FACTS;
}

function pickEducationThoughtOfTheDay(subjectRaw) {
  const pool = poolForSubject(subjectRaw);
  return pool[Math.floor(Math.random() * pool.length)] || DEFAULT_FACTS[0];
}

function formatEducationProfessorRider(teacherName) {
  const n = String(teacherName || '').trim();
  const display = n || 'your instructor';
  return `Summary reviewed and edited by Professor ${display}`;
}

module.exports = {
  pickEducationThoughtOfTheDay,
  formatEducationProfessorRider,
};
