/**
 * Long-lived pyannote embedding worker (voice_embedding.py --serve).
 *
 * Spawning a fresh Python interpreter per live utterance re-imports torch and reloads the
 * pyannote model every time (10s+ on CPU), so live speaker names arrived long after the text
 * and the final-transcript attribution took minutes. This keeps one process with the model
 * loaded and talks to it over newline-delimited JSON.
 *
 * Callers should treat a rejected promise as "worker unavailable" and fall back to the
 * one-shot script path (voiceRecognition.tryPyannoteEmbedding handles that).
 *
 * VOICE_EMBEDDING_WORKER=false disables the worker entirely.
 */
const path = require('path');
const { spawn } = require('child_process');
const readline = require('readline');

const SCRIPT = path.join(__dirname, 'voice_embedding.py');
const MAX_CONSECUTIVE_START_FAILURES = 3;
const START_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

let child = null;
let readyPromise = null;
let nextId = 1;
const pending = new Map();
let startFailures = 0;
let disabledUntil = 0;

function workerEnabled() {
  return String(process.env.VOICE_EMBEDDING_WORKER || 'true').toLowerCase() !== 'false';
}

function startupTimeoutMs() {
  // First boot may download the model from Hugging Face.
  return Math.min(
    900000,
    Math.max(60000, parseInt(process.env.VOICE_WORKER_STARTUP_TIMEOUT_MS || '300000', 10) || 300000)
  );
}

/** Reject in-flight requests (only those sent to `proc` when given). */
function failAllPending(err, proc = null) {
  for (const [id, p] of pending) {
    if (proc && p.proc !== proc) continue;
    clearTimeout(p.timer);
    pending.delete(id);
    p.reject(err);
  }
}

function resetChild() {
  const c = child;
  child = null;
  readyPromise = null;
  if (c) {
    try {
      c.kill();
    } catch (_) {
      /* ignore */
    }
  }
}

function startWorker(pythonBin, env) {
  if (readyPromise) return readyPromise;

  readyPromise = new Promise((resolve, reject) => {
    let settled = false;
    const proc = spawn(pythonBin, [SCRIPT, '--serve'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child = proc;

    const startTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Voice worker did not become ready within ${startupTimeoutMs()}ms`));
      resetChild();
    }, startupTimeoutMs());

    let stderrTail = '';
    proc.stderr.on('data', (d) => {
      stderrTail = (stderrTail + String(d)).slice(-4000);
    });

    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch (_) {
        return;
      }
      if (msg.id === 0) {
        if (settled) return;
        settled = true;
        clearTimeout(startTimer);
        if (msg.ok) {
          startFailures = 0;
          console.log('✅ Voice embedding worker ready (speaker model loaded once)');
          resolve();
        } else {
          reject(new Error(msg.error || 'Voice worker failed to load the embedding model'));
        }
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg);
      else p.reject(new Error(msg.error || 'Voice worker request failed'));
    });

    const onGone = (why) => {
      const err = new Error(`Voice worker exited (${why}). ${stderrTail.slice(-800)}`.trim());
      if (child === proc) {
        child = null;
        readyPromise = null;
      }
      failAllPending(err, proc);
      if (!settled) {
        settled = true;
        clearTimeout(startTimer);
        reject(err);
      }
    };
    proc.on('error', (e) => onGone(e.message || 'spawn error'));
    proc.on('exit', (code, signal) => onGone(signal || `code ${code}`));
  }).catch((err) => {
    startFailures += 1;
    if (startFailures >= MAX_CONSECUTIVE_START_FAILURES) {
      disabledUntil = Date.now() + START_RETRY_COOLDOWN_MS;
      startFailures = 0;
      console.warn(
        `⚠️  Voice embedding worker failed to start ${MAX_CONSECUTIVE_START_FAILURES}x; using one-shot embeddings for ${START_RETRY_COOLDOWN_MS / 60000} min.`
      );
    }
    resetChild();
    throw err;
  });

  return readyPromise;
}

/**
 * @param {object} payload request body ({ cmd, path, ... })
 * @param {{ pythonBin: string, env: object, timeoutMs?: number }} opts
 */
async function workerRequest(payload, opts) {
  if (!workerEnabled()) throw new Error('Voice worker disabled (VOICE_EMBEDDING_WORKER=false)');
  if (Date.now() < disabledUntil) throw new Error('Voice worker temporarily disabled after start failures');
  if (!opts || !opts.pythonBin) throw new Error('Python binary not resolved');

  await startWorker(opts.pythonBin, opts.env || process.env);
  const proc = child;
  if (!proc || !proc.stdin || proc.stdin.destroyed) throw new Error('Voice worker not running');

  const id = nextId++;
  const timeoutMs = Math.max(5000, opts.timeoutMs || 60000);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      // A stuck request blocks every later one (the worker is sequential) — restart it.
      reject(new Error(`Voice worker request timed out after ${timeoutMs}ms`));
      failAllPending(new Error('Voice worker restarted after a timed-out request'), proc);
      if (child === proc) resetChild();
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer, proc });
    try {
      proc.stdin.write(`${JSON.stringify({ ...payload, id })}\n`);
    } catch (e) {
      pending.delete(id);
      clearTimeout(timer);
      reject(e);
    }
  });
}

function shutdownVoiceWorker() {
  failAllPending(new Error('Voice worker shutting down'));
  resetChild();
}

process.once('exit', shutdownVoiceWorker);

module.exports = {
  workerRequest,
  workerEnabled,
  shutdownVoiceWorker,
};
