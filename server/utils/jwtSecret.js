/**
 * Single source of the JWT signing secret.
 *
 * The previous fallback ('your_secret_key') is public in this repo: anyone could forge a token for
 * any account, including the super-admin. In production a missing JWT_SECRET is now fatal at boot
 * instead of silently signing with a known key. Locally (NODE_ENV !== 'production') the dev
 * fallback still works so the app runs out of the box.
 */
const DEV_FALLBACK = 'portiq-dev-only-insecure-secret';

function isProduction() {
  return String(process.env.NODE_ENV || '').toLowerCase() === 'production';
}

function getJwtSecret() {
  const s = String(process.env.JWT_SECRET || '').trim();
  if (s) return s;
  if (isProduction()) {
    throw new Error('JWT_SECRET is not set. Refusing to sign or verify tokens with a default secret.');
  }
  return DEV_FALLBACK;
}

/** Call at boot: crash early (with a clear message) rather than run with forgeable tokens. */
function assertJwtSecretConfigured() {
  if (isProduction() && !String(process.env.JWT_SECRET || '').trim()) {
    console.error(
      '❌ JWT_SECRET is not set. Set a long random value in your environment (e.g. Railway → Variables) and redeploy.'
    );
    process.exit(1);
  }
  if (!String(process.env.JWT_SECRET || '').trim()) {
    console.warn('⚠️  JWT_SECRET not set — using an insecure development secret (never do this in production).');
  }
}

module.exports = { getJwtSecret, assertJwtSecretConfigured };
