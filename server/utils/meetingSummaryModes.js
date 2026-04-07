/**
 * Summary "modes" — lightweight prompt/output switches on the same transcription → LLM pipeline.
 * Add future modes (e.g. sales, lecture) here with their prompts and JSON shapes.
 */

const SUMMARY_MODES = {
  STANDARD: 'standard',
  INTERVIEW: 'interview',
};

/** User-requested evaluation prompt (system message). Output format is enforced via JSON in the user message. */
const INTERVIEW_EVALUATION_SYSTEM_PROMPT = `You are an expert hiring assistant helping evaluate a candidate based on an interview transcript.

Your goal is to provide a clear, structured, and practical evaluation that helps a human make a hiring decision.

IMPORTANT RULES:
- Be analytical, not emotional
- Do NOT exaggerate
- Do NOT be overly positive
- Avoid generic statements
- Base all conclusions ONLY on what is said in the transcript
- If signals are weak or unclear, explicitly say so

----------------------------------

OUTPUT FORMAT:

1. SUMMARY  
Provide a concise 3–5 line summary of the candidate's performance in the interview.

----------------------------------

2. KEY STRENGTHS  
List 2–4 specific strengths observed.  
Only include strengths that are supported by actual responses.

----------------------------------

3. CONCERNS / RED FLAGS  
List any concerns, vague answers, lack of clarity, or weak signals.

----------------------------------

4. EVALUATION SIGNALS  

- Communication Clarity: (High / Medium / Low)  
- Ownership Signals: (High / Medium / Low)  
- Depth of Answers: (High / Medium / Low)  
- Confidence Level: (High / Medium / Low)  

For each, give 1 short justification.

----------------------------------

5. FINAL RECOMMENDATION  

Choose ONE:

- Strong Hire  
- Lean Hire  
- No Hire  

Then provide a clear 1–2 line justification.

----------------------------------

TONE:

- Neutral and professional  
- Slightly opinionated but not absolute  
- Do NOT say things like "definitely reject"  
- Use phrasing like:
  "Leaning towards No Hire due to lack of depth and vague responses."

----------------------------------

Remember:
You are assisting decision-making, not replacing it.`;

function normalizeInterviewJson(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  let rec = String(o.hiringRecommendation || o.finalRecommendation || '').trim();
  const recLower = rec.toLowerCase();
  if (recLower.includes('strong') && recLower.includes('hire')) rec = 'Strong Hire';
  else if (recLower.includes('lean') && recLower.includes('hire')) rec = 'Lean Hire';
  else if (recLower.includes('no') && recLower.includes('hire')) rec = 'No Hire';
  else if (!rec) rec = '';
  const reason = String(o.hiringRecommendationReason || o.recommendationJustification || '').trim();

  const summary = String(o.summary || '').trim();

  let strengths = o.keyStrengths;
  if (!Array.isArray(strengths)) strengths = o.key_strengths;
  if (!Array.isArray(strengths)) strengths = [];
  strengths = strengths.map((s) => String(s || '').trim()).filter(Boolean);

  let concerns = o.concernsRedFlags;
  if (!Array.isArray(concerns)) concerns = o.concerns_red_flags;
  if (!Array.isArray(concerns)) concerns = [];
  concerns = concerns.map((s) => String(s || '').trim()).filter(Boolean);

  let signals = o.evaluationSignals || o.evaluation_signals;
  if (!signals || typeof signals !== 'object') signals = null;
  else {
    const normKey = (k) =>
      String(k || '')
        .replace(/([A-Z])/g, ' $1')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '');
    const map = {
      communicationclarity: 'communicationClarity',
      ownershipsignals: 'ownershipSignals',
      depthofanswers: 'depthOfAnswers',
      confidencelevel: 'confidenceLevel',
    };
    const out = {};
    for (const [k, v] of Object.entries(signals)) {
      const nk = map[normKey(k)] || k;
      if (v && typeof v === 'object') {
        out[nk] = {
          level: String(v.level || v.rating || '').trim(),
          justification: String(v.justification || v.note || '').trim(),
        };
      }
    }
    signals = Object.keys(out).length ? out : null;
  }

  return {
    hiringRecommendation: rec,
    hiringRecommendationReason: reason,
    summary,
    keyStrengths: strengths,
    concernsRedFlags: concerns,
    evaluationSignals: signals,
  };
}

/**
 * Map interview model output to the shared pipeline shape (summary, keyPoints, importantNotes, …).
 */
function mapInterviewToPipelinePayload(normalized) {
  return {
    summary: normalized.summary,
    keyPoints: normalized.keyStrengths,
    importantNotes: normalized.concernsRedFlags,
    actionItems: [],
    decisions: [],
    nextSteps: [],
    hiringRecommendation: normalized.hiringRecommendation,
    hiringRecommendationReason: normalized.hiringRecommendationReason,
    evaluationSignals: normalized.evaluationSignals,
  };
}

function buildInterviewUserJsonInstructions() {
  return `Return ONLY a JSON object (no markdown fences) with this exact structure:
{
  "hiringRecommendation": "Strong Hire" | "Lean Hire" | "No Hire",
  "hiringRecommendationReason": "1-2 line justification matching the tone rules above",
  "summary": "3-5 line summary paragraph",
  "keyStrengths": ["strength 1", "strength 2"],
  "concernsRedFlags": ["concern 1", "concern 2"],
  "evaluationSignals": {
    "communicationClarity": { "level": "High" | "Medium" | "Low", "justification": "short text" },
    "ownershipSignals": { "level": "High" | "Medium" | "Low", "justification": "short text" },
    "depthOfAnswers": { "level": "High" | "Medium" | "Low", "justification": "short text" },
    "confidenceLevel": { "level": "High" | "Medium" | "Low", "justification": "short text" }
  }
}

Use empty arrays only if there is truly nothing to list. Ground every field in the transcript.`;
}

module.exports = {
  SUMMARY_MODES,
  INTERVIEW_EVALUATION_SYSTEM_PROMPT,
  normalizeInterviewJson,
  mapInterviewToPipelinePayload,
  buildInterviewUserJsonInstructions,
};
