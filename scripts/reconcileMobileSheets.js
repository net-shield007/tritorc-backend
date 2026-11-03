// Re-sends mobile leads that are in the database but missing from their sheet tab
// (for example after a Sheets outage or a restart mid-write). Safe to run repeatedly:
// a lead is matched by its database id in the "DB ID" column and never added twice.
//
//   npm run sheets:reconcile -- --dry-run     list what would be added
//   npm run sheets:reconcile                  add the missing rows
//
// Needs the same environment variables as the backend (DB_*, Sheets settings).

const knexConfig = require('../knexfile').development;
const knex = require('knex')(knexConfig);
const sheets = require('../utils/mobileSheets');
const { parseLeadSource, parseTrackingParams } = require('../utils/leadSource');

const PATHS = { 'htw-in-mobile': '/m/in/', 'htw-gcc-mobile': '/m/gcc/' };
const dryRun = process.argv.includes('--dry-run');

(async () => {
  let failed = false;
  try {
    for (const [source, path] of Object.entries(PATHS)) {
      const target = sheets.getTarget(source);
      if (!target) {
        console.error(`${source}: sheet id is not set`);
        failed = true;
        continue;
      }
      const inSheet = new Set((await sheets.readColumn(target, 'C')).map(String));
      const leads = await knex('ppc_contact_submissions')
        .where('message', 'like', `%URL: %${path}%`)
        .orderBy('id', 'asc');
      let added = 0;
      for (const lead of leads) {
        if (inSheet.has(String(lead.id))) continue;
        const parsed = parseLeadSource(lead.message);
        const row = {
          name: lead.name,
          email: lead.email,
          company: lead.company,
          phone: lead.phone,
          message: parsed.message,
          ...parsed.source,
          ...parseTrackingParams(parsed.source.page_url),
        };
        console.log(`${source}: ${dryRun ? 'would add' : 'adding'} lead #${lead.id}`);
        if (!dryRun) {
          await sheets.appendRow(target, sheets.buildRow({ source, submissionId: `db-${lead.id}`, dbId: lead.id, row }));
        }
        added++;
      }
      console.log(`${source}: ${added} missing lead(s) ${dryRun ? 'found' : 'added'}, ${leads.length} in database`);
    }
  } catch (err) {
    console.error('Reconcile failed:', err.message);
    failed = true;
  } finally {
    await knex.destroy();
  }
  process.exit(failed ? 1 : 0);
})();
