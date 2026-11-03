const knexConfig = require('../knexfile').development;
const knex = require('knex')(knexConfig);
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');


const { getJwtSecret } = require('../utils/jwtSecret');

exports.register = async (req, res, next) => {
  const { name, email, password, role } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const [id] = await knex('users')
      .insert({ 
        name, 
        email, 
        password: hashedPassword,
        role: role || 'viewer'
      })
      .returning('id');
    res.status(201).json({ "message": "User Registered Successfully" });
  } catch (err) {
    next(err);
  }
};

exports.login = async (req, res, next) => {
  const { email, password } = req.body;
  try {
    const user = await knex('users').where({ email }).first();
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });

    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(400).json({ error: 'Invalid credentials' });

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      getJwtSecret(),
      { expiresIn: '1h' }
    );
    res.json({ token });
  } catch (err) {
    next(err);
  }
};
