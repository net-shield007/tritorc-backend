/**
 * Supports the admin dashboard:
 *  - first_contacted_at: when a lead was first worked on (status moved off "new", or a reply was
 *    sent from the dashboard). Used for the response-time numbers. Old leads stay null.
 *  - indexes for the filters and sorting the dashboard uses.
 *
 * Safe to run on a database that already has some of this (every step checks first), and it only
 * adds things: no existing data is changed. The lead columns (country_name, campaign_id) come from
 * the earlier lead-capture migration, so an index is only added when its column exists.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
const TABLE = 'ppc_contact_submissions';

const INDEXES = [
    ['ppc_submissions_created_at_idx', 'created_at'],
    ['ppc_submissions_status_idx', 'status'],
    ['ppc_submissions_country_idx', 'country_name'],
    ['ppc_submissions_campaign_idx', 'campaign_id'],
];

exports.up = async function (knex) {
    if (!(await knex.schema.hasColumn(TABLE, 'first_contacted_at'))) {
        await knex.schema.alterTable(TABLE, function (table) {
            table.timestamp('first_contacted_at');
        });
    }

    for (const [name, column] of INDEXES) {
        if (await knex.schema.hasColumn(TABLE, column)) {
            await knex.raw('CREATE INDEX IF NOT EXISTS ?? ON ?? (??)', [name, TABLE, column]);
        }
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    for (const [name] of INDEXES) {
        await knex.raw('DROP INDEX IF EXISTS ??', [name]);
    }
    if (await knex.schema.hasColumn(TABLE, 'first_contacted_at')) {
        await knex.schema.alterTable(TABLE, function (table) {
            table.dropColumn('first_contacted_at');
        });
    }
};
