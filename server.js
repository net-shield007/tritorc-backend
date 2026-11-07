require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bodyParser = require("body-parser");
const logger = require('./middleware/logger');
const errorHandler = require('./middleware/errorHandler');
const knexConfig = require('./knexfile').development;
const knex = require('knex')(knexConfig);

// Fail at startup, not on the first login, if the JWT secret is missing.
require('./utils/jwtSecret').getJwtSecret();

const app = express();
const PORT = process.env.PORT || 4000;

// Behind App Runner / Cloudflare: lets req.ip and forwarded headers reflect the real client.
app.set('trust proxy', true);

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '100mb' }));
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));
app.use(logger);

// Routes
app.get('/', (req, res) => res.send('Welcome To Tritorc'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/distribution', require('./routes/distribution'));
app.use('/api/contact', require('./routes/contact'));
app.use('/api/product', require('./routes/product'));
app.use('/api/ppc', require('./routes/ppc'));
app.use('/api/visit', require('./routes/visit'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/blog', require('./routes/blog'));

// Error handler (last)
app.use(errorHandler);

// Prevent server from exiting unexpectedly
process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', reason => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

// Check DB connection before starting server
(async () => {
  try {
    await knex.raw('SELECT 1+1 AS result'); // simple query to verify DB connection
    console.log('✅ Database connection successful');

    app.listen(PORT, () => {
      console.log(`Server listening on port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
    process.exit(1); // stop process if DB is not connected
  }
})();
