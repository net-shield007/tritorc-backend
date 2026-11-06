/**
 * Adds lead-capture columns to ppc_contact_submissions and an email log table
 * used by the admin "send reply" buttons.
 *
 * Safe to run on a database that already has some of this (every step checks first), and it only
 * adds things: no existing data is changed.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
const TABLE = 'ppc_contact_submissions';

const COLUMNS = {
    country_code: (table) => table.string('country_code', 10),
    country_name: (table) => table.string('country_name', 100),
    campaign_id: (table) => table.string('campaign_id', 50),
    page_name: (table) => table.text('page_name'),
    page_url: (table) => table.text('page_url'),
    referrer: (table) => table.text('referrer'),
    gclid: (table) => table.text('gclid'),
    gbraid: (table) => table.text('gbraid'),
    gad_source: (table) => table.string('gad_source', 20),
};

exports.up = async function (knex) {
    for (const [name, add] of Object.entries(COLUMNS)) {
        if (!(await knex.schema.hasColumn(TABLE, name))) {
            await knex.schema.alterTable(TABLE, function (table) {
                add(table);
            });
        }
    }

    if (!(await knex.schema.hasTable('ppc_email_log'))) {
        await knex.schema.createTable('ppc_email_log', function (table) {
            table.increments('id').primary();
            table
                .integer('submission_id')
                .notNullable()
                .references('id')
                .inTable(TABLE)
                .onDelete('CASCADE');
            table.string('template', 50).notNullable();
            table.string('to_email').notNullable();
            table.string('status', 20).notNullable(); // sent | failed
            table.string('message_id');
            table.text('error');
            table.string('sent_by');
            table.timestamp('created_at').defaultTo(knex.fn.now());
            table.index(['submission_id', 'template']);
        });
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('ppc_email_log');
    for (const name of Object.keys(COLUMNS)) {
        if (await knex.schema.hasColumn(TABLE, name)) {
            await knex.schema.alterTable(TABLE, function (table) {
                table.dropColumn(name);
            });
        }
    }
};
