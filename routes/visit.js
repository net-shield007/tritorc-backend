const express = require('express');
const router = express.Router();
const visit = require('../controllers/visitController');
const auth = require('../middleware/auth');

router.post('/', visit.recordVisit); // public: the site's analytics ping
router.get('/map', auth, visit.getVisitMap);

module.exports = router;
