const express = require('express');
const router = express.Router();
const ppcController = require('../controllers/ppcController');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

router.post('/', ppcController.createPPCSubmission);
router.get('/', auth, ppcController.getPPCSubmissions);
router.patch('/:id/status', auth, authorize(['superadmin', 'admin', 'editor']), ppcController.updatePPCStatus);
router.post('/:id/reply', auth, authorize(['superadmin', 'admin', 'editor']), ppcController.sendPPCReply);

module.exports = router;
