const express = require('express');
const router = express.Router();
const ppcController = require('../controllers/ppcController');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

// Submitting a lead stays public (the landing pages use it); reading and changing leads needs a login,
// the same rules as the contact, product and distribution lead routes.
router.post('/', ppcController.createPPCSubmission);
router.get('/', auth, ppcController.getPPCSubmissions);
router.patch('/:id/status', auth, authorize(['superadmin', 'admin', 'editor']), ppcController.updatePPCStatus);

module.exports = router;
