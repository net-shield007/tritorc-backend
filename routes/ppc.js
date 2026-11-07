const express = require('express');
const router = express.Router();
const ppcController = require('../controllers/ppcController');
const insights = require('../controllers/ppcInsightsController');
const templates = require('../controllers/ppcTemplatesController');
const auth = require('../middleware/auth');
const authorize = require('../middleware/authorize');

router.post('/', ppcController.createPPCSubmission);
router.get('/', auth, ppcController.getPPCSubmissions);
router.get('/stats', auth, insights.getStats);
router.get('/facets', auth, insights.getFacets);
router.get('/new-count', auth, insights.getNewCount);
router.get('/map', auth, insights.getMapPoints);
router.get('/templates', auth, authorize(['superadmin', 'admin', 'editor']), templates.listTemplates);
router.post('/templates/preview', auth, authorize(['superadmin', 'admin', 'editor']), templates.previewTemplate);
router.put('/templates/:template', auth, authorize(['superadmin', 'admin']), templates.saveTemplate);
router.delete('/templates/:template', auth, authorize(['superadmin', 'admin']), templates.resetTemplate);
router.get('/export', auth, authorize(['superadmin', 'admin', 'editor']), insights.exportCsv);
router.patch('/:id/status', auth, authorize(['superadmin', 'admin', 'editor']), ppcController.updatePPCStatus);
router.post('/:id/reply', auth, authorize(['superadmin', 'admin', 'editor']), ppcController.sendPPCReply);
router.post('/:id/translate', auth, authorize(['superadmin', 'admin', 'editor']), ppcController.translatePPCMessage);

module.exports = router;
