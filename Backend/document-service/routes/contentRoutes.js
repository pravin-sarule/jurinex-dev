// const express = require('express');
// const router = express.Router();
// const contentController = require('../controllers/contentController');

// /* ============================================================
//    CASE TYPES ROUTES
// ============================================================ */

// // Get all case types
// router.get('/case-types', contentController.getCaseTypes);

// // Get sub-types for a specific case type
// router.get('/case-types/:caseTypeId/sub-types', contentController.getSubTypesByCaseType);


// /* ============================================================
//    COURTS ROUTES
// ============================================================ */

// // Get all courts
// router.get('/courts', contentController.getCourts);

// // Get court by ID
// router.get('/courts/:id', contentController.getCourtById);

// // Get courts by level (e.g., High Court, District Court)
// router.get('/courts/level/:level', contentController.getCourtsByLevel);


// /* ============================================================
//    JUDGES ROUTES
// ============================================================ */

// // Get judges by bench (query params: ?courtId=1&benchName=Principal Bench)
// router.get('/judges', contentController.getJudgesByBench);


// /* ============================================================
//    EXPORT ROUTER
// ============================================================ */
// module.exports = router;



const express = require('express');
const router = express.Router();
const contentController = require('../controllers/contentController');
const { protect } = require('../middleware/auth');

/* ============================================================
   CASE TYPES ROUTES
============================================================ */

// Get all case types
router.get('/case-types', contentController.getCaseTypes);

// Get sub-types for a specific case type
router.get('/case-types/:caseTypeId/sub-types', contentController.getSubTypesByCaseType);


/* ============================================================
   COURTS ROUTES
============================================================ */

// Get all courts
router.get('/courts', contentController.getCourts);

// Get court by ID
router.get('/courts/:id', contentController.getCourtById);

// Get courts by level (e.g., High Court, District Court)
router.get('/courts/level/:level', contentController.getCourtsByLevel);


/* ============================================================
   JUDGES ROUTES
============================================================ */

// Get judges by bench (query params: ?courtId=1&benchName=Principal Bench)
router.get('/judges', contentController.getJudgesByBench);

/* ============================================================
   🧠 CASE DRAFTS (Auto-Save Support)
============================================================ */

// Save or update draft (upsert)
router.post('/case-draft/save', contentController.saveCaseDraft);

// Fetch existing draft for a user
router.get('/case-draft/:userId', contentController.getCaseDraft);

// Delete draft once case is finalized
router.delete('/case-draft/:userId', contentController.deleteCaseDraft);

/* ============================================================
   USER PROFESSIONAL PROFILE ROUTES
============================================================ */

// Get user professional profile context (for AI prompts)
router.get('/user-professional-profile', protect, contentController.getUserProfessionalProfileContext);

/* ============================================================
   EXPORT ROUTER
============================================================ */
module.exports = router;
