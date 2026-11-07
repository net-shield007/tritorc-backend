/**
 * Visitors who allowed analytics (cookie banner), whether or not they sent a form. One row per browser
 * tab session. Holds a random session id, the landing page, the country the request came from (proxy
 * header) and, only if the visitor allowed it, the browser location. No IP address is stored.
 * Safe to re-run.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    if (await knex.schema.hasTable('visits')) return;
    await knex.schema.createTable('visits', function (table) {
        table.increments('id').primary();
        table.string('session_id', 64).notNullable().unique();
        table.string('landing_page', 500);
        table.string('referrer', 500);
        table.string('ip_country_code', 2);
        table.string('location_status', 20);
        table.decimal('latitude', 8, 4);
        table.decimal('longitude', 8, 4);
        table.integer('accuracy');
        table.string('location_country', 100);
        table.integer('pages').notNullable().defaultTo(1);
        table.timestamp('first_seen').defaultTo(knex.fn.now());
        table.timestamp('last_seen').defaultTo(knex.fn.now());
        table.index('first_seen', 'visits_first_seen_idx');
        table.index('ip_country_code', 'visits_country_idx');
    });
};

exports.down = function (knex) {
    return knex.schema.dropTableIfExists('visits');
};
