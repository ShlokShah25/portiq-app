/**
 * Checks for server/utils/quizBuilder.js. No dependencies, no network:
 *   node server/scripts/test-quiz-builder.js
 */
const assert = require('assert');
const {
  normalizeQuestion,
  normalizeQuiz,
  shuffleQuestionOptions,
  balanceAnswerPositions,
  buildQuizUserPrompt,
  stripOptionLabel,
} = require('../utils/quizBuilder');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok  ${name}`);
}

const good = {
  question: 'What does high variance mean for a model?',
  options: ['It memorises noise in the training data', 'It is too simple', 'It has no parameters', 'It ignores the labels'],
  correctIndex: 0,
  explanation: 'High variance means the model follows noise.',
  topic: 'Bias vs variance',
  difficulty: 'Easy',
};

test('a well-formed question passes through, trimmed', () => {
  const q = normalizeQuestion({ ...good, question: '  What does high variance   mean for a model? ' });
  assert.strictEqual(q.question, 'What does high variance mean for a model?');
  assert.strictEqual(q.correctIndex, 0);
  assert.strictEqual(q.difficulty, 'easy');
});

test('letter labels are stripped from options', () => {
  assert.strictEqual(stripOptionLabel('A) Paris'), 'Paris');
  assert.strictEqual(stripOptionLabel('(b) Paris'), 'Paris');
  assert.strictEqual(stripOptionLabel('c. Paris'), 'Paris');
  assert.strictEqual(stripOptionLabel('A model that overfits'), 'A model that overfits');
  const q = normalizeQuestion({ ...good, options: ['A) one thing', 'B) another thing', 'C) a third thing', 'D) a fourth thing'] });
  assert.deepStrictEqual(q.options, ['one thing', 'another thing', 'a third thing', 'a fourth thing']);
});

test('questions without exactly four distinct options are rejected', () => {
  assert.strictEqual(normalizeQuestion({ ...good, options: good.options.slice(0, 3) }), null);
  assert.strictEqual(normalizeQuestion({ ...good, options: [...good.options, 'extra'] }), null);
  assert.strictEqual(normalizeQuestion({ ...good, options: ['Same', 'same.', 'Other', 'Another'] }), null);
});

test('"all of the above" style options are rejected', () => {
  assert.strictEqual(normalizeQuestion({ ...good, options: ['X happens', 'Y happens', 'Z happens', 'All of the above'] }), null);
  assert.strictEqual(normalizeQuestion({ ...good, options: ['X happens', 'Y happens', 'Z happens', 'None of these'] }), null);
  assert.strictEqual(normalizeQuestion({ ...good, options: ['X happens', 'Y happens', 'Z happens', 'Both A and B'] }), null);
  assert.ok(normalizeQuestion({ ...good, options: ['Both bias and variance rise', 'A and B testing', 'All data is used once', 'None of the weights change'] }));
});

test('a missing or out-of-range answer key is rejected', () => {
  assert.strictEqual(normalizeQuestion({ ...good, correctIndex: 4 }), null);
  assert.strictEqual(normalizeQuestion({ ...good, correctIndex: -1 }), null);
  assert.strictEqual(normalizeQuestion({ ...good, correctIndex: undefined }), null);
});

test('the answer may be given as text, a letter or a numeric string', () => {
  assert.strictEqual(normalizeQuestion({ ...good, correctIndex: undefined, answer: 'It is too simple' }).correctIndex, 1);
  assert.strictEqual(normalizeQuestion({ ...good, correctIndex: undefined, answer: 'C' }).correctIndex, 2);
  assert.strictEqual(normalizeQuestion({ ...good, correctIndex: '3' }).correctIndex, 3);
});

test('shuffling keeps the same correct option', () => {
  for (let seed = 0; seed < 200; seed += 1) {
    let x = seed + 1;
    const random = () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; };
    const s = shuffleQuestionOptions(normalizeQuestion(good), random);
    assert.strictEqual(s.options[s.correctIndex], good.options[0]);
    assert.strictEqual(new Set(s.options).size, 4);
  }
});

test('answer positions are spread across a five-question quiz', () => {
  const five = Array.from({ length: 5 }, (_, i) => normalizeQuestion({ ...good, question: `Question number ${i + 1} about variance?` }));
  for (let run = 0; run < 100; run += 1) {
    const out = balanceAnswerPositions(five);
    const counts = [0, 0, 0, 0];
    out.forEach((q) => {
      counts[q.correctIndex] += 1;
      assert.strictEqual(q.options[q.correctIndex], good.options[0]);
      assert.strictEqual(new Set(q.options).size, 4);
    });
    assert.ok(Math.max(...counts) <= 2, `one position used ${Math.max(...counts)} times`);
    assert.ok(counts.filter((c) => c > 0).length === 4, 'every position should be used');
  }
});

test('normalizeQuiz drops bad and duplicate questions and respects the limit', () => {
  const parsed = {
    questions: [
      good,
      { ...good },
      { ...good, question: 'Second question about cross-validation?', correctIndex: 9 },
      { ...good, question: 'Third question about cross-validation?' },
    ],
  };
  const out = normalizeQuiz(parsed, { limit: 5 });
  assert.strictEqual(out.length, 2);
  assert.strictEqual(normalizeQuiz(parsed, { limit: 1 }).length, 1);
  assert.strictEqual(normalizeQuiz(parsed, { limit: 5, existing: [good] }).length, 1);
  assert.deepStrictEqual(normalizeQuiz(null), []);
  assert.deepStrictEqual(normalizeQuiz({ questions: 'nope' }), []);
});

test('the prompt carries the notes, the transcript and the questions to avoid', () => {
  const p = buildQuizUserPrompt({ title: 'L8', subject: 'ML', summary: 'NOTES', keyPoints: ['a = b'], transcript: 'SPOKEN', count: 2, avoid: [good] });
  assert.ok(p.includes('Write 2 questions'));
  assert.ok(p.includes('NOTES') && p.includes('SPOKEN') && p.includes('a = b'));
  assert.ok(p.includes(good.question));
});

console.log(`\n${passed} checks passed`);
