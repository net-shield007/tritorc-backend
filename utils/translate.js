// Translates a lead's message to English with Google Cloud Translation (v2, "Basic").
// It logs in with the same service account the rest of the app uses for Google
// (GOOGLE_SERVICE_ACCOUNT_JSON, or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY), so there is
// no new secret. The Cloud Translation API must be enabled in that Google Cloud project and the
// service account needs the "Cloud Translation API User" role.

const crypto = require('crypto');
const { JWT } = require('google-auth-library');

const ENDPOINT = 'https://translation.googleapis.com/language/translate/v2';
const SCOPE = 'https://www.googleapis.com/auth/cloud-translation';
const MAX_CHARS = 5000; // Google recommends well under 30k per request; a lead message is short
const TIMEOUT_MS = 10000;
const CACHE_MAX = 500;

let authClient = null;
const cache = new Map(); // text hash -> { translated, detectedLanguage }

function readServiceAccount() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json);
      return { email: parsed.client_email, key: parsed.private_key };
    } catch (err) {
      // Never include the value in the message: it holds the private key.
      throw codeError('TRANSLATE_NOT_CONFIGURED', 'GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON');
    }
  }
  return {
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  };
}

function codeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function getAuth() {
  if (!authClient) {
    const { email, key } = readServiceAccount();
    if (!email || !key) throw codeError('TRANSLATE_NOT_CONFIGURED', 'Google service account is not configured');
    authClient = new JWT({ email, key, scopes: [SCOPE] });
  }
  return authClient;
}

// Lets tests swap in a fake client with a request({ url, method, data }) method.
function setAuthClient(client) {
  authClient = client;
  cache.clear();
}

// Turns whatever Google / the network threw into an error with a code the controller can map.
// Only the status and Google's own error text are kept; never the request, headers or key.
function classify(err) {
  if (err && err.code && String(err.code).startsWith('TRANSLATE_')) return err;
  const status = err && err.response && err.response.status;
  const reason = err && err.response && err.response.data && err.response.data.error && err.response.data.error.message;
  if (status === 401 || status === 403) {
    return codeError('TRANSLATE_DENIED', reason || 'Google refused the request (is the Cloud Translation API enabled and the role granted?)');
  }
  if (status === 429) return codeError('TRANSLATE_QUOTA', reason || 'Translation quota exceeded');
  if (err && (err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED' || /timeout|timed out/i.test(err.message || ''))) {
    return codeError('TRANSLATE_TIMEOUT', 'The translation service took too long to answer');
  }
  return codeError('TRANSLATE_FAILED', reason || 'The translation service failed');
}

// Returns { translated, detectedLanguage, truncated }. `translated` is null when the text is already English.
async function translateToEnglish(text) {
  const source = String(text || '').trim();
  if (!source) throw codeError('TRANSLATE_EMPTY', 'There is no message to translate');
  const truncated = source.length > MAX_CHARS;
  const q = truncated ? source.slice(0, MAX_CHARS) : source;

  const key = crypto.createHash('sha256').update(q).digest('hex');
  const hit = cache.get(key);
  if (hit) return { ...hit, truncated };

  let response;
  try {
    response = await getAuth().request({
      url: ENDPOINT,
      method: 'POST',
      data: { q, target: 'en', format: 'text' },
      timeout: TIMEOUT_MS,
    });
  } catch (err) {
    throw classify(err);
  }

  const item = response && response.data && response.data.data && response.data.data.translations && response.data.data.translations[0];
  if (!item || typeof item.translatedText !== 'string') throw codeError('TRANSLATE_FAILED', 'The translation service sent an unexpected answer');

  const detectedLanguage = item.detectedSourceLanguage || null;
  const alreadyEnglish = !!detectedLanguage && /^en(-|$)/i.test(detectedLanguage);
  const result = { translated: alreadyEnglish ? null : item.translatedText, detectedLanguage };

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value); // oldest first
  cache.set(key, result);
  return { ...result, truncated };
}

module.exports = { translateToEnglish, setAuthClient, MAX_CHARS };
