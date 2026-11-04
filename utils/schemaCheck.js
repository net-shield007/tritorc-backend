// The dashboard code can be deployed before its migrations have run. A check remembers whether an
// optional column / table exists, and re-asks about a missing one at most once a minute.
function schemaCheck(check) {
  let found = false;
  let checkedAt = 0;
  return async () => {
    if (found) return true;
    if (Date.now() - checkedAt < 60000) return false;
    checkedAt = Date.now();
    try {
      found = await check();
    } catch (err) {
      found = false;
    }
    return found;
  };
}

module.exports = { schemaCheck };
