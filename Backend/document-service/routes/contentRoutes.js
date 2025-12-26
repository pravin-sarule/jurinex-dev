const express = require('express');
const router = express.Router();
const contentController = require('../controllers/contentController');
const { protect } = require('../middleware/auth');


router.get('/case-types', contentController.getCaseTypes);

router.get('/case-types/:caseTypeId/sub-types', contentController.getSubTypesByCaseType);



router.get('/courts', contentController.getCourts);

router.get('/courts/:id', contentController.getCourtById);

router.get('/courts/level/:level', contentController.getCourtsByLevel);



router.get('/judges', contentController.getJudgesByBench);


router.post('/case-draft/save', contentController.saveCaseDraft);

router.get('/case-draft/:userId', contentController.getCaseDraft);

router.delete('/case-draft/:userId', contentController.deleteCaseDraft);


router.get('/user-professional-profile', protect, contentController.getUserProfessionalProfileContext);

module.exports = router;
