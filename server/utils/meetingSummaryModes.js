/**
 * Summary "modes" — lightweight prompt/output switches on the same transcription → LLM pipeline.
 * Add future modes (e.g. sales, lecture) here with their prompts and JSON shapes.
 */

const SUMMARY_MODES = {
  STANDARD: 'standard',
  INTERVIEW: 'interview',
  CLINICAL: 'clinical',
};

/** Cura clinical scribe — SOAP documentation from consultation transcript */
const CLINICAL_SOAP_SYSTEM_PROMPT = `You are an expert clinical documentation assistant helping a licensed physician produce accurate SOAP notes from a patient consultation transcript.

IMPORTANT RULES:
- The consultation may be in English, Hindi, Hinglish, or other languages: understand everything said, but write your entire JSON output in professional clinical English only.
- Document ONLY what is supported by the transcript — do not invent findings, diagnoses, vitals, or medications.
- If information for a SOAP section is missing, write "Not documented in encounter" for that section rather than guessing.
- Distinguish clearly between patient-reported symptoms (Subjective) and clinician-observed or stated findings (Objective).
- Assessment should list working diagnoses or clinical impressions with appropriate uncertainty language when the transcript does not confirm a diagnosis.
- Plan should include medications, investigations, referrals, lifestyle advice, and follow-up only when discussed or clearly implied in the encounter.
- Flag allergies, contraindications, or safety concerns mentioned in the transcript under redFlags.
- Use concise, EHR-ready prose — not conversational filler.
- Never prescribe controlled substances or dosages not explicitly discussed; if dosing is unclear, note "dose not specified in encounter".

TONE: Professional, neutral, medico-legally careful. You assist documentation — the clinician is solely responsible for the final note.`;

function normalizeClinicalJson(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  const str = (k) => String(o[k] || '').trim();
  let meds = o.medications;
  if (!Array.isArray(meds)) meds = [];
  meds = meds.map((m) => String(m || '').trim()).filter(Boolean);
  let redFlags = o.redFlags;
  if (!Array.isArray(redFlags)) redFlags = o.red_flags;
  if (!Array.isArray(redFlags)) redFlags = [];
  redFlags = redFlags.map((r) => String(r || '').trim()).filter(Boolean);
  return {
    subjective: str('subjective'),
    objective: str('objective'),
    assessment: str('assessment'),
    plan: str('plan'),
    medications: meds,
    followUpInstructions: str('followUpInstructions') || str('follow_up_instructions'),
    patientCounseling: str('patientCounseling') || str('patient_counseling'),
    redFlags,
  };
}

function mapClinicalToPipelinePayload(normalized) {
  const soapNarrative = [
    normalized.subjective ? `**Subjective**\n${normalized.subjective}` : '',
    normalized.objective ? `**Objective**\n${normalized.objective}` : '',
    normalized.assessment ? `**Assessment**\n${normalized.assessment}` : '',
    normalized.plan ? `**Plan**\n${normalized.plan}` : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const assessmentLines = normalized.assessment
    ? normalized.assessment
        .split(/\n|;/)
        .map((s) => s.trim())
        .filter((s) => s.length > 3)
    : [];

  const planLines = [
    ...normalized.medications.map((m) => `Medication: ${m}`),
    ...(normalized.plan
      ? normalized.plan
          .split(/\n|;/)
          .map((s) => s.trim())
          .filter((s) => s.length > 3)
      : []),
    ...(normalized.followUpInstructions ? [`Follow-up: ${normalized.followUpInstructions}`] : []),
  ];

  return {
    summary: soapNarrative,
    keyPoints: assessmentLines.slice(0, 8),
    importantNotes: normalized.redFlags,
    nextSteps: planLines.slice(0, 12),
    clinicalNote: normalized,
    followUpPlan: normalized.followUpInstructions,
  };
}

function buildClinicalUserJsonInstructions() {
  return `Return ONLY a JSON object (no markdown fences) with this exact structure:
{
  "subjective": "Patient-reported history, symptoms, duration, context — from transcript only",
  "objective": "Exam findings, vitals, test results mentioned by clinician — or 'Not documented in encounter'",
  "assessment": "Working diagnoses / clinical impressions with appropriate uncertainty",
  "plan": "Treatment plan, investigations, referrals discussed",
  "medications": ["drug name and sig if stated"],
  "followUpInstructions": "When to return, warning signs, follow-up timing",
  "patientCounseling": "Key counseling points discussed with patient",
  "redFlags": ["allergies, contraindications, or safety concerns mentioned"]
}

Ground every field in the transcript. Use empty arrays only when nothing applies.`;
}

/** User-requested evaluation prompt (system message). Output format is enforced via JSON in the user message. */
const INTERVIEW_EVALUATION_SYSTEM_PROMPT = `You are an expert hiring assistant helping evaluate a candidate based on an interview transcript.

Your goal is to provide a clear, structured, and practical evaluation that helps a human make a hiring decision.

IMPORTANT RULES:
- The interview may be conducted in English, Hindi, Hinglish, or other languages: understand everything said, but write your entire JSON output in professional English only (translate and paraphrase; do not leave evaluation text in a non-English script).
- Be analytical, not emotional
- Do NOT exaggerate
- Do NOT be overly positive
- Avoid generic statements
- Base all conclusions ONLY on what is said in the transcript
- If signals are weak or unclear, explicitly say so
- Do NOT infer motivations, intent, or personality traits unless the transcript directly supports that claim
- Do NOT write claims like "the candidate demonstrated X" unless specific interview responses in the transcript support it
- When evidence is missing or unclear, explicitly use: "Insufficient evidence from transcript"

ROLE AS REFERENCE (when the user message includes a role or position for the candidate):
- Use that role as the fixed reference for judging the interviewee’s answers: interpret what they said in light of what strong performance looks like for that role (skills, judgment, communication style, depth).
- Do not score answers in the abstract—always anchor comments to “for a [role], this answer shows …” or “relative to [role] expectations …” when the transcript supports it.
- Strengths and concerns should cite specific answers and explain how they meet, exceed, or fall short of what the role needs.
- Evaluation signal justifications should tie evidence to role-relevant expectations (e.g. depth of technical reasoning for an engineer, stakeholder clarity for a PM).
- If multiple candidates or roles are listed, map evidence to the right person/role when the transcript allows; otherwise focus on the primary candidate.

----------------------------------

OUTPUT FORMAT:

1. SUMMARY  
Provide a concise 3–5 line summary of the candidate’s performance relative to the role (when a role is given), or of the interview overall if no role is given.

----------------------------------

2. KEY STRENGTHS  
List 2–4 specific strengths observed.  
Only include strengths that are supported by actual responses. If there are no clear strengths, return an empty array.

----------------------------------

3. CONCERNS / RED FLAGS  
List concerns, vague answers, lack of clarity, or weak signals that are directly grounded in transcript evidence. If none, return an empty array.

----------------------------------

4. EVALUATION SIGNALS  

- Communication Clarity: (High / Medium / Low)  
- Ownership Signals: (High / Medium / Low)  
- Depth of Answers: (High / Medium / Low)  
- Confidence Level: (High / Medium / Low)  

For each, give 1 short justification that references how the candidate’s answers showed up in the interview, in role-relevant terms when a role was provided.

----------------------------------

5. FINAL RECOMMENDATION  

Choose ONE:

- Strong Hire  
- Hire  
- Neutral  
- No Hire  

Then provide a clear 1–2 line justification.
If justification evidence is weak, state: "Insufficient evidence from transcript for high-confidence recommendation."

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
  else if (recLower.includes('no') && recLower.includes('hire')) rec = 'No Hire';
  else if (recLower.includes('neutral')) rec = 'Neutral';
  else if (recLower.includes('lean') && recLower.includes('hire')) rec = 'Hire';
  else if (recLower.includes('hire')) rec = 'Hire';
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
  "hiringRecommendation": "Strong Hire" | "Hire" | "Neutral" | "No Hire",
  "hiringRecommendationReason": "1-2 line justification matching the tone rules above; if a role was given, tie justification to role fit. If evidence is weak, say insufficient evidence from transcript",
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

Use empty arrays only if there is truly nothing to list. Ground every field in the transcript. Never invent behaviors, intent, or traits that are not clearly present in the transcript. If evidence is uncertain, explicitly say "Insufficient evidence from transcript". If the user message provided a role/position, judge every answer you mention against that role as reference; strengths, concerns, signals, and hiring recommendation must reflect that comparison.`;
}

module.exports = {
  SUMMARY_MODES,
  INTERVIEW_EVALUATION_SYSTEM_PROMPT,
  CLINICAL_SOAP_SYSTEM_PROMPT,
  normalizeInterviewJson,
  mapInterviewToPipelinePayload,
  buildInterviewUserJsonInstructions,
  normalizeClinicalJson,
  mapClinicalToPipelinePayload,
  buildClinicalUserJsonInstructions,
};
