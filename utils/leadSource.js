// Parses the "Lead Source:" block the front end appends to a lead's message:
//
//   Lead Source:
//   Page: /gcc/en/hydraulic-torque-wrench
//   URL: https://solutions.tritorc.com/gcc/en/hydraulic-torque-wrench#quote
//   Referrer: https://www.google.com/        (optional)
//
// Returns the message without the block, plus whatever source details it held.

const MARKER = /^[ \t]*Lead Source:[ \t]*$/im;
const SOURCE_LINE = /^[ \t]*(Page|URL|Referrer):[ \t]*(.*)$/i;

function parseLeadSource(message) {
  const text = typeof message === 'string' ? message : '';
  const match = MARKER.exec(text);
  if (!match) return { message: text, source: {} };

  const before = text.slice(0, match.index);
  const lines = text.slice(match.index + match[0].length).split(/\r?\n/);

  const source = {};
  let i = 0;
  // the marker's own line ends at the first newline, so skip the empty remainder
  if (lines[0] === '') i = 1;
  for (; i < lines.length; i++) {
    const m = SOURCE_LINE.exec(lines[i]);
    if (!m) break;
    source[m[1].toLowerCase()] = m[2].trim();
  }
  // anything after the block that is not part of it stays in the message
  const after = lines.slice(i).join('\n');

  return {
    message: `${before}${after}`.trim(),
    source: {
      page_name: source.page || undefined,
      page_url: source.url || undefined,
      referrer: source.referrer || undefined,
    },
  };
}

// Campaign details carried in the landing URL (Google Ads).
function parseTrackingParams(url) {
  if (!url) return {};
  try {
    const params = new URL(url).searchParams;
    return {
      campaign_id: params.get('gad_campaignid') || undefined,
      gclid: params.get('gclid') || undefined,
      gbraid: params.get('gbraid') || undefined,
      gad_source: params.get('gad_source') || undefined,
    };
  } catch (err) {
    return {};
  }
}

module.exports = { parseLeadSource, parseTrackingParams };
