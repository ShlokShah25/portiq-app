/**
 * Name voices nobody enrolled ("Speaker 2") from what was said — only with hard evidence:
 * the speaker introduces themselves ("Hi, I'm Priya"), or is addressed by name and answers in
 * the very next turn. Every assignment must quote the transcript verbatim; quotes that are not
 * found are discarded, so the model cannot invent a name.
 *
 * VOICE_TEXT_NAMING=false disables it.
 */

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {object[]} turns speaker turns ({ speaker, email, via, text })
 * @param {object[]} participants meeting roster ({ name, email })
 * @param {{ openai: object, model: string }} llm
 * @returns {Promise<object[]>} turns, relabelled where evidence supports it
 */
async function nameUnknownSpeakersFromText(turns, participants, llm) {
  if (String(process.env.VOICE_TEXT_NAMING || 'true').toLowerCase() === 'false') return turns;
  if (!llm || !llm.openai || !Array.isArray(turns) || !turns.length) return turns;

  const unknownLabels = [...new Set(turns.filter((t) => !t.email && /^Speaker \d+$/.test(t.speaker)).map((t) => t.speaker))];
  if (!unknownLabels.length) return turns;
  const namedEmails = new Set(turns.filter((t) => t.email).map((t) => String(t.email).toLowerCase()));
  const candidates = (participants || [])
    .filter((p) => p && p.email && String(p.name || '').trim())
    .filter((p) => !namedEmails.has(String(p.email).toLowerCase()))
    .map((p) => ({ name: String(p.name).trim(), email: String(p.email).trim().toLowerCase() }));
  if (!candidates.length) return turns;

  // Keep the prompt small: unknown speakers' turns plus the turn right before each.
  const lines = [];
  turns.forEach((t, i) => {
    if (!unknownLabels.includes(t.speaker)) return;
    if (i > 0) lines.push(`${turns[i - 1].speaker}: ${turns[i - 1].text}`);
    lines.push(`${t.speaker}: ${t.text}`);
  });
  const excerpt = [...new Set(lines)].join('\n').slice(0, 12000);

  let parsed = null;
  try {
    const resp = await llm.openai.chat.completions.create({
      model: llm.model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You map anonymous meeting speakers ("Speaker N") to people on the invite list. Assign a name ONLY when ' +
            'the transcript proves it: (a) the speaker introduces themselves by name, or (b) another speaker addresses ' +
            'that person by name and Speaker N answers in the very next line. Never guess from topic, role or tone. ' +
            'Each assignment must include "evidence": an exact quote copied from the transcript. If unsure, omit. ' +
            'Return JSON: {"assignments":[{"speaker":"Speaker 2","email":"…","evidence":"…"}]}',
        },
        {
          role: 'user',
          content:
            `Invited people without a recognised voice:\n${candidates.map((c) => `- ${c.name} <${c.email}>`).join('\n')}\n\n` +
            `Anonymous speakers: ${unknownLabels.join(', ')}\n\nTranscript excerpt:\n${excerpt}`,
        },
      ],
    });
    parsed = JSON.parse(resp.choices?.[0]?.message?.content || '{}');
  } catch (e) {
    console.warn('⚠️  Text-based speaker naming skipped:', e.message || e);
    return turns;
  }

  const fullText = norm(turns.map((t) => t.text).join(' '));
  const byEmail = new Map(candidates.map((c) => [c.email, c]));
  const map = new Map();
  const usedEmails = new Set();
  for (const a of Array.isArray(parsed && parsed.assignments) ? parsed.assignments : []) {
    const label = String(a && a.speaker || '').trim();
    const email = String(a && a.email || '').trim().toLowerCase();
    const evidence = norm(a && a.evidence);
    const person = byEmail.get(email);
    if (!unknownLabels.includes(label) || !person || map.has(label) || usedEmails.has(email)) continue;
    // Evidence must be verbatim and must actually contain the person's (first) name.
    const first = norm(person.name).split(' ')[0];
    if (!evidence || evidence.length < 4 || !fullText.includes(evidence) || !evidence.includes(first)) continue;
    map.set(label, person);
    usedEmails.add(email);
  }
  if (!map.size) return turns;
  console.log(`🏷️  Named ${map.size} unenrolled speaker(s) from transcript evidence`);
  return turns.map((t) => {
    const person = !t.email && map.get(t.speaker);
    return person ? { ...t, speaker: person.name, email: person.email, via: 'text' } : t;
  });
}

module.exports = { nameUnknownSpeakersFromText };
