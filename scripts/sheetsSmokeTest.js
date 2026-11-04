// Writes one clearly labelled test row to each mobile-leads tab, using the same
// credentials and code path as the live backend, then reads it back.
//
//   export GOOGLE_SERVICE_ACCOUNT_JSON="$(aws secretsmanager get-secret-value \
//     --secret-id tritorc/mobile-leads/staging/google-service-account \
//     --query SecretString --output text --region ap-south-1)"
//   export MOBILE_SHEETS_ENABLED=true
//   export INDIA_MOBILE_SHEET_ID=... GCC_MOBILE_SHEET_ID=...   (tabs default to the real names)
//   npm run sheets:smoke-test
//
// It never prints credentials. Delete the SMOKE TEST rows from the sheet afterwards.

const sheets = require('../utils/mobileSheets');

(async () => {
  let failed = false;
  for (const source of Object.keys(sheets.SOURCES)) {
    const target = sheets.getTarget(source);
    if (!target) {
      console.error(`${source}: sheet id is not set`);
      failed = true;
      continue;
    }
    const marker = `SMOKE TEST ${new Date().toISOString()}`;
    try {
      await sheets.appendRow(target, sheets.buildRow({
        source,
        submissionId: 'smoke-test',
        dbId: 'smoke-test',
        row: { name: marker, email: 'smoke-test@example.invalid', message: 'Smoke test row, safe to delete' },
      }));
      const names = await sheets.readColumn(target, 'E');
      const found = names.includes(marker);
      console.log(`${source} -> tab "${target.tab}": ${found ? 'row written and read back' : 'row NOT found after write'}`);
      if (!found) failed = true;
    } catch (err) {
      console.error(`${source} -> tab "${target.tab}": FAILED (${err.message})`);
      failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
})();
