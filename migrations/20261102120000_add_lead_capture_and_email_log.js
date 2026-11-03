/**
 * Adds lead-capture columns to ppc_contact_submissions and an email log table
 * used by the admin "send reply" buttons.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    await knex.schema.alterTable('ppc_contact_submissions', function (table) {
        table.string('country_code', 10);
        table.string('country_name', 100);
        table.string('campaign_id', 50);
        table.text('page_name');
        table.text('page_url');
        table.text('referrer');
        table.text('gclid');
        table.text('gbraid');
        table.string('gad_source', 20);
    });

    await knex.schema.createTable('ppc_email_log', function (table) {
        table.increments('id').primary();
        table
            .integer('submission_id')
            .notNullable()
            .references('id')
            .inTable('ppc_contact_submissions')
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
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('ppc_email_log');
    await knex.schema.alterTable('ppc_contact_submissions', function (table) {
        table.dropColumns(
            'country_code',
            'country_name',
            'campaign_id',
            'page_name',
            'page_url',
            'referrer',
            'gclid',
            'gbraid',
            'gad_source'
        );
    });
};
