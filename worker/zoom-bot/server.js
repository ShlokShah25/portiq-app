/**
 * PortIQ Zoom conference bot worker (Node reference).
 *
 * Receives POST bodies from the API (see docs/ZOOM_PLATFORM.md). Verifies optional HMAC,
 * fetches join context (ZAK) when not in mock mode, reports status to the API, and logs
 * where a Linux Meeting SDK binary would run for real capture.
 */

require('dotenv').config();
const crypto = require('crypto');
const { spawn } = require('child_process');
const express = require('express');

const fetch = global.fetch;
const PORT = parseInt(process.env.PORT || '8790', 10);
/** Mock simulates join lifecycle; set ZOOM_BOT_MOCK=0 to attempt join-context + real-bot hook. */
const MOCK_MODE = process.env.ZOOM_BOT_MOCK !== '0' && process.env.ZOOM_BOT_MOCK !== 'false';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function verifySignature(rawBody, sigHeader, secret) {
  if (!secret) return true;
  const sig = String(sigHeader || '').trim();
  if (!sig) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(sig, 'utf8'));
  } catch {
    return false;
  }
}

function reportUrlFromJob(job) {
  if (job.reportUrl) return job.reportUrl;
  const base = String(process.env.PORTIQ_API_URL || '').trim().replace(/\/+$/, '');
  return base ? `${base}/api/integrations/bot/report` : null;
}

function joinContextUrlFromJob(job) {
  if (job.joinContextUrl) return job.joinContextUrl;
  const base = String(process.env.PORTIQ_API_URL || '').trim().replace(/\/+$/, '');
  return base ? `${base}/api/integrations/worker/zoom/join-context` : null;
}

async function postReport(reportUrl, meetingId, body) {
  const secret = process.env.PORTIQ_WORKER_SECRET;
  if (!secret) {
    console.error('[zoom-bot] PORTIQ_WORKER_SECRET is not set; cannot call bot/report');
    return;
  }
  const res = await fetch(reportUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PortIQ-Worker-Secret': secret,
    },
    body: JSON.stringify({ meetingId, ...body }),
  });
  const text = await res.text().catch(() => '');
  if (!res.ok) {
    console.warn('[zoom-bot] bot/report', res.status, text.slice(0, 300));
  }
}

async function fetchJoinContext(job) {
  const url = joinContextUrlFromJob(job);
  if (!url) return null;
  const secret = process.env.PORTIQ_WORKER_SECRET;
  if (!secret) return null;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-PortIQ-Worker-Secret': secret,
    },
    body: JSON.stringify({ meetingId: job.meetingId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.warn('[zoom-bot] join-context failed', res.status, data);
    return null;
  }
  return data;
}

async function runMockJob(job) {
  const reportUrl = reportUrlFromJob(job);
  if (!reportUrl) {
    console.error('[zoom-bot] No reportUrl on job and PORTIQ_API_URL unset');
    return;
  }
  const mid = job.meetingId;
  await postReport(reportUrl, mid, { conferenceBotStatus: 'joining' });
  await sleep(parseInt(process.env.ZOOM_BOT_MOCK_JOIN_MS || '1500', 10));
  await postReport(reportUrl, mid, { conferenceBotStatus: 'in_meeting' });
  await sleep(parseInt(process.env.ZOOM_BOT_MOCK_MEET_MS || '2000', 10));
  await postReport(reportUrl, mid, { conferenceBotStatus: 'ended' });
}

/**
 * Optional real capture: set ZOOM_BOT_CAPTURE_COMMAND to an executable (and optional ZOOM_BOT_CAPTURE_ARGS JSON array).
 * The process receives env: PORTIQ_MEETING_ID, PORTIQ_JOIN_URL, PORTIQ_ZAK, PORTIQ_EXTERNAL_MEETING_ID, PORTIQ_REPORT_URL, PORTIQ_WORKER_SECRET.
 * Exit 0: last line of stdout may be JSON, e.g. {"conferenceBotStatus":"ended","audioFile":"/uploads/..."} — merged into bot/report.
 * Your binary can also call bot/report itself; then exit 0 with empty stdout.
 */
function runCaptureProcess(envExtra) {
  const cmd = String(process.env.ZOOM_BOT_CAPTURE_COMMAND || '').trim();
  if (!cmd) return Promise.resolve(null);

  let args = [];
  const rawArgs = process.env.ZOOM_BOT_CAPTURE_ARGS;
  if (rawArgs && String(rawArgs).trim()) {
    try {
      args = JSON.parse(String(rawArgs));
      if (!Array.isArray(args)) args = [];
    } catch (e) {
      console.error('[zoom-bot] ZOOM_BOT_CAPTURE_ARGS must be a JSON array of strings');
      return Promise.resolve({ code: 1, stdout: '', stderr: 'invalid ZOOM_BOT_CAPTURE_ARGS' });
    }
  }

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      env: { ...process.env, ...envExtra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', (err) => {
      resolve({ code: 1, stdout, stderr: stderr || err.message });
    });
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function runRealJob(job) {
  const reportUrl = reportUrlFromJob(job);
  if (!reportUrl) {
    console.error('[zoom-bot] No reportUrl on job and PORTIQ_API_URL unset');
    return;
  }
  const mid = job.meetingId;
  await postReport(reportUrl, mid, { conferenceBotStatus: 'joining' });

  const ctx = await fetchJoinContext(job);
  if (ctx) {
    console.log(
      '[zoom-bot] join-context:',
      'zak=' + (ctx.zak ? 'yes' : 'no'),
      ctx.zakError || ''
    );
  } else {
    console.warn('[zoom-bot] join-context unavailable; check PORTIQ_WORKER_SECRET and API URL');
  }

  const captureEnv = {
    PORTIQ_MEETING_ID: mid,
    PORTIQ_JOIN_URL: (ctx && ctx.joinUrl) || job.joinUrl || '',
    PORTIQ_ZAK: (ctx && ctx.zak) || '',
    PORTIQ_EXTERNAL_MEETING_ID: String(
      job.externalMeetingId || (ctx && ctx.externalMeetingId) || ''
    ),
    PORTIQ_REPORT_URL: reportUrl,
  };

  const run = await runCaptureProcess(captureEnv);
  if (run === null) {
    await postReport(reportUrl, mid, {
      conferenceBotStatus: 'failed',
      error:
        'Set ZOOM_BOT_CAPTURE_COMMAND to your Zoom Meeting SDK (Linux) wrapper, or use ZOOM_BOT_MOCK=1 for testing. Node cannot join Zoom calls by itself.',
    });
    return;
  }

  if (run.code === 0) {
    const lines = run.stdout.trim().split('\n').filter(Boolean);
    const last = lines.length ? lines[lines.length - 1] : '';
    let extra = {};
    if (last.startsWith('{')) {
      try {
        extra = JSON.parse(last);
      } catch {
        /* ignore */
      }
    }
    await postReport(reportUrl, mid, {
      conferenceBotStatus: extra.conferenceBotStatus || 'ended',
      ...(extra.audioFile !== undefined ? { audioFile: extra.audioFile } : {}),
      ...(extra.transcriptionStatus !== undefined
        ? { transcriptionStatus: extra.transcriptionStatus }
        : {}),
      ...(extra.error ? { error: extra.error } : {}),
    });
    return;
  }

  await postReport(reportUrl, mid, {
    conferenceBotStatus: 'failed',
    error: String(run.stderr || run.stdout || `capture_exit_${run.code}`).slice(0, 500),
  });
}

async function handleJob(job) {
  if (!job || job.type !== 'conference.join') {
    console.log('[zoom-bot] ignored job type', job?.type);
    return;
  }
  if (job.provider !== 'zoom') {
    console.log('[zoom-bot] skip non-zoom provider', job.provider);
    return;
  }
  if (MOCK_MODE) {
    await runMockJob(job);
  } else {
    await runRealJob(job);
  }
}

const app = express();

app.get('/health', (_req, res) => {
  res.json({ ok: true, mock: MOCK_MODE });
});

app.post(
  '/',
  express.raw({ type: 'application/json', limit: '512kb' }),
  (req, res) => {
    const raw = req.body instanceof Buffer ? req.body.toString('utf8') : String(req.body || '');
    const secret = process.env.CONFERENCE_BOT_WEBHOOK_SECRET || '';
    const sig = req.get('x-portiq-signature');
    if (!verifySignature(raw, sig, secret)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }
    let job;
    try {
      job = JSON.parse(raw || '{}');
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }
    res.status(202).json({ accepted: true });
    handleJob(job).catch((e) => console.error('[zoom-bot] job error', e));
  }
);

app.listen(PORT, () => {
  console.log(
    `[zoom-bot] listening on :${PORT} mock=${MOCK_MODE} capture=${!!String(process.env.ZOOM_BOT_CAPTURE_COMMAND || '').trim()}`
  );
});
