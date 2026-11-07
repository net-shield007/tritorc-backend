// Country of the request, from the edge/proxy headers (no IP lookup, and the IP itself is never
// read or stored). Cloudflare sets cf-ipcountry, CloudFront cloudfront-viewer-country.
// Returns an upper-case ISO-3166 alpha-2 code, or undefined when unknown.
const HEADERS = ['cf-ipcountry', 'cloudfront-viewer-country', 'x-vercel-ip-country', 'x-appengine-country'];

// Cloudflare uses XX for unknown and T1 for Tor; neither is a country.
const NOT_A_COUNTRY = new Set(['XX', 'T1']);

function ipCountryCode(req) {
  for (const name of HEADERS) {
    const value = req.headers[name];
    if (typeof value !== 'string') continue;
    const code = value.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(code) && !NOT_A_COUNTRY.has(code)) return code;
  }
  return undefined;
}

module.exports = { ipCountryCode };
