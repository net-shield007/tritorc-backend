const knexConfig = require('../knexfile').development;
const knex = require('knex')(knexConfig);

exports.createPPCSubmission = async (req, res, next) => {
  const { name, email, company, phone, message } = req.body;

  if (!name || !email) {
    return res.status(400).json({ error: 'Name and email are required' });
  }

  try {
    const [id] = await knex('ppc_contact_submissions')
      .insert({ name, email, company, phone, message })
      .returning('id');

    res.status(201).json({ id });
  } catch (err) {
    next(err);
  }
};

exports.getPPCSubmissions = async (req, res, next) => {
  try {
    let { page = 1, limit = 10, orderBy = 'created_at', order = 'desc' } = req.query;

    page = parseInt(page, 10);
    limit = parseInt(limit, 10);

    const offset = (page - 1) * limit;

    const submissions = await knex('ppc_contact_submissions')
      .select('*')
      .where({ is_active: true })
      .orderBy(orderBy, order)
      .limit(limit)
      .offset(offset);

    const [{ count }] = await knex('ppc_contact_submissions').where({ is_active: true }).count('* as count');

    res.status(200).json({
      data: submissions,
      pagination: {
        total: parseInt(count, 10),
        page,
        limit,
        totalPages: Math.ceil(count / limit),
      },
    });
  } catch (err) {
    next(err);
  }
};

exports.updatePPCStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    const allowedStatuses = ["new", "contacted", "qualified", "hot", "closed"];

    if (!allowedStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Allowed statuses: ${allowedStatuses.join(", ")}` });
    }

    const updated = await knex('ppc_contact_submissions')
      .where({ id })
      .update({ status, updated_at: knex.fn.now() });

    if (!updated) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    res.status(200).json({ message: 'Status updated successfully', id, status });
  } catch (err) {
    next(err);
  }
};
