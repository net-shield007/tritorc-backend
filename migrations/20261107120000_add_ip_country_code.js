/**
 * Adds ip_country_code to the leads table: the country the request came from, read from the proxy's
 * country header (see utils/ipCountry.js). It is the fallback for the admin map when a visitor did not
 * share a browser location. No IP address is stored. Safe to re-run; old leads stay null.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
const TABLE = 'ppc_contact_submissions';

exports.up = async function (knex) {
    if (!(await knex.schema.hasColumn(TABLE, 'ip_country_code'))) {
        await knex.schema.alterTable(TABLE, function (table) {
            table.string('ip_country_code', 2);
        });
    }
};

exports.down = async function (knex) {
    if (await knex.schema.hasColumn(TABLE, 'ip_country_code')) {
        await knex.schema.alterTable(TABLE, function (table) {
            table.dropColumn('ip_country_code');
        });
    }
};
