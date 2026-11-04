/**
 * Stores the reply templates edited from the dashboard settings. A template with no row here
 * uses the default wording from utils/replyTemplates.js, so an empty table changes nothing.
 *
 * Safe to run twice (it checks first), and it only adds a table.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    if (await knex.schema.hasTable('ppc_email_templates')) return;
    await knex.schema.createTable('ppc_email_templates', function (table) {
        table.string('template', 50).primary();
        table.string('subject', 200).notNullable();
        table.text('body').notNullable();
        table.string('updated_by');
        table.timestamp('updated_at').defaultTo(knex.fn.now());
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('ppc_email_templates');
};
