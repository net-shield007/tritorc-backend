// A stored lead message can end with blocks the website added: "Lead Source:" (older leads),
// "GPS Location:" and "Visitor:". This takes all of them out in one go, so replies, the CSV export
// and anything else that shows or quotes the message see only what the visitor wrote.
const { parseLeadSource } = require('./leadSource');
const { splitLocation } = require('./location');
const { splitVisitor } = require('./visitor');

// Returns { message, location, visitor, source } (location / visitor are null when absent).
function splitMessage(raw) {
  const withoutLocation = splitLocation(raw);
  const withoutVisitor = splitVisitor(withoutLocation.message);
  const parsed = parseLeadSource(withoutVisitor.message);
  return {
    message: parsed.message,
    location: withoutLocation.location,
    visitor: withoutVisitor.visitor,
    source: parsed.source,
  };
}

module.exports = { splitMessage };
