# Workspace ad (v3) — claim audit

Each claim made in `PortIQ-Workspace-Ad-v3.mp4`, checked against the code, with what was broken and
what changed. Status: ✅ holds · 🔧 was broken/weak, fixed in this change · ⚠️ still a gap (decision needed).

| # | Ad claim | Status | Notes |
|---|----------|--------|-------|
| 1 | "Add a title. Pick your team." — up to 50 people | ✅ | `MeetingCreateForm.js`, plan-limited. |
| 2 | "Your contact book — voices recognised" (Configured badge) | 🔧 | Badge showed for basic FFT fallback voiceprints that could never match a pyannote utterance. Profiles now store `embeddingKind`, matching compares like-for-like, and `/voice/profiles` returns the kind so the UI can prompt a re-record. |
| 3 | "Hit record. Just talk." — live transcript | 🔧 **was broken** | MediaRecorder only writes the WebM header into its first slice, so every live utterance after the first was undecodable and silently dropped. This was reproduced in Chromium: ffmpeg failed with "EBML header parsing failed". The live preview now captures PCM with Web Audio and sends self-contained 16 kHz WAV utterances (`client/src/utils/liveUtteranceCapture.js`). VAD now runs in the audio callback, so it keeps working in background tabs (`requestAnimationFrame` pauses there). |
| 4 | "Live transcript — every speaker named" | 🔧 | (a) Each live utterance spawned a fresh Python process that imported torch and loaded pyannote plus a diarization pipeline, which took 10s+ per utterance. That work is now a persistent worker (`voiceEmbeddingWorker.js`, `voice_embedding.py --serve`), warmed at boot. (b) Whisper and speaker ID now run in parallel. (c) The thresholds were inconsistent: a cosine ≥ 0.90 rule meant 1–2 enrolled people were almost never named, and a "closest ≥ 0.50" fallback for 3+ people gave guests someone else's name. Matching is now one consistent rule (default accept ≥ 0.55 with a margin over the runner-up), plus per-meeting learning. Tune it with `VOICE_PYANNOTE_MIN` and use `VOICE_MATCH_DEBUG=true` to calibrate. |
| 5 | Final transcript / "Every answer captured, speaker by speaker" (Interview) | 🔧 | The stored transcript had **no speaker labels at all**. Voice was only used as hidden evidence that merged 10–45 s buckets (several people per label). It was skipped for interviews and for every meeting longer than 10 min. Now each Whisper segment is attributed (`speakerTimeline.js`), unenrolled voices become "Speaker N", and long-audio chunks share one voice session. Turns are stored in `Meeting.transcriptSegments`, shown on the summary page (`SpeakerTranscript.js`), and fed to the summary / interview evaluation prompt, which helps action-item owners. |
| 6 | Language understanding (Hinglish etc.) | 🔧 | Live chunks were transcribed with no context, so language, spelling and names drifted between utterances. The live Whisper prompt now carries the previous ~400 chars plus participant names. The final pass already auto-detects the language and the summary prompt reads mixed languages. |
| 7 | "Hang up. PortIQ does the rest." / "Delivered to every inbox." | ⚠️ | Summaries are **held for approval**: someone must click *Approve & send*. Nothing is emailed automatically. Either soften the ad copy, or add an opt-in "auto-send when ready" setting. That's a product decision, so it wasn't changed here. |
| 8 | Decisions / Action items / Key points, "Every task. An owner. A due date." | ✅ (improved by #5) | Owners now come from voice-labelled turns, not only from names said in the text. |
| 9 | "Your summary, in their language" — Hindi, German; "Summaries in 8 languages" | ✅ / 🔧 | English plus 7 translation options = 8. The translated block **left out action items** (owner and due date); they're now included, and names and dates are kept as written. Translation needs a plan with `allowsTranslatedSummary` (Business). |
| 10 | Email with PDF + calendar invites, English + हिंदी in the same email | ✅ | `sendMeetingSummary` attaches the PDF, the meeting .ics and the follow-ups .ics. |
| 11 | "Then it follows up. Automatically." — reminder "Sent to Marcus Lee" | 🔧 | Reminders went to **every participant**, not the owner. They now go to the owner (assignee matched to a participant) plus the organizer, falling back to everyone only when the owner can't be matched. A strict "exactly 1 day before" window also meant an item due *tomorrow* from a meeting ending after the daily run **never** got a reminder. It now sends on the daily run when the item is due today or tomorrow. The ad's example ("Patch Android crash" due tomorrow) failed before this change. |
| 12 | Interview Mode — candidate, role, panel, DISC, scores, "Hire · with reasons" | ✅ (improved by #5) | `generateInterviewMeetingSummaryFromTranscript` returns DISC, signal scores and the recommendation. The evaluation now sees who said what. |

## Deployment notes

- Speaker recognition needs `HF_TOKEN`, with the pyannote/embedding terms accepted, plus the Python venv from `nixpacks.toml`. Without them, enrollment falls back to the basic FFT voiceprint (low accuracy).
- New env knobs: `VOICE_EMBEDDING_WORKER` (default on), `VOICE_WORKER_STARTUP_TIMEOUT_MS`, `VOICE_WORKER_REQUEST_TIMEOUT_MS`, `VOICE_TIMELINE_ENABLED` (default on), `VOICE_MATCH_DEBUG`.
- `VOICE_PYANNOTE_DIARIZATION` now defaults to **off**. Cropping to the longest single segment threw away most of a short enrollment or utterance.
- The matching thresholds are set from typical pyannote/embedding score ranges, not from PortIQ's own recordings. Before relying on them for the ad, run a meeting with 3–4 enrolled people and `VOICE_MATCH_DEBUG=true`, then adjust `VOICE_PYANNOTE_MIN` if needed.

## Verification done

- Headless Chromium: the old slice-based chunks fail to decode after the first; the new capture produced correctly bounded 16 kHz WAV utterances from a fake mic (tone / silence / tone).
- Worker manager tested against a stub process (concurrent requests, a hung request timing out, automatic restart).
- Matcher and timeline tested with synthetic embeddings: enrolled speakers named, an unenrolled guest kept as "Speaker 1", no false match.
- Reminder recipient resolution (first name, full name, email, unknown owner → fallback).
- Client production build compiles cleanly; all changed server modules load.
- **Not yet run:** the real pyannote model end to end (needs `HF_TOKEN` and the torch stack). Please do one live meeting on staging before filming.
