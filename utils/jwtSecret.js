// The one place the JWT signing secret is read, for both signing (authController)
// and verifying (middleware/auth). There is no built-in default: a missing secret
// stops the server at startup, unless NODE_ENV is development or test, where a
// random per-process secret is used (tokens stop working when the server restarts).

const crypto = require('crypto');

let devSecret = null;

function getJwtSecret() {
  const secret = (process.env.JWT_SECRET || '').trim();
  if (secret) return secret;

  if (['development', 'test'].includes(process.env.NODE_ENV)) {
    if (!devSecret) {
      devSecret = crypto.randomBytes(32).toString('hex');
      console.warn('JWT_SECRET is not set; using a temporary secret for this process only.');
    }
    return devSecret;
  }

  throw new Error('JWT_SECRET is not set. Set it as an environment variable before starting the server.');
}

module.exports = { getJwtSecret };
