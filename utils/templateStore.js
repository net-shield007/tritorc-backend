const knexConfig = require('../knexfile').development;
const knex = require('knex')(knexConfig);
const { schemaCheck } = require('./schemaCheck');

const TABLE = 'ppc_email_templates';
const hasTemplateTable = schemaCheck(() => knex.schema.hasTable(TABLE));

// The saved wording for one template, or null when it still uses the default (or the table does not exist yet).
async function getCustom(template) {
  if (!(await hasTemplateTable())) return null;
  try {
    return (await knex(TABLE).where({ template }).first()) || null;
  } catch (err) {
    console.error('Reading email template failed', err.message);
    return null;
  }
}

async function listCustom() {
  if (!(await hasTemplateTable())) return [];
  return knex(TABLE).select('*');
}

module.exports = { TABLE, hasTemplateTable, getCustom, listCustom };
