const express = require("express");
const router = express.Router();
const multer = require("multer");
const mindmapController = require("../controllers/mindmapController");
const authMiddleware = require("../middleware/auth");
const { checkDocumentUploadLimits } = require("../middleware/checkTokenLimits");

const upload = multer({ storage: multer.memoryStorage() });

router.post(
  "/upload",
  authMiddleware.protect,
  checkDocumentUploadLimits,
  upload.array("files", 10), // Allow up to 10 files
  mindmapController.uploadDocuments
);

router.post(
  "/generate-upload-url",
  authMiddleware.protect,
  mindmapController.generateUploadUrl
);

router.post(
  "/complete-upload",
  authMiddleware.protect,
  mindmapController.completeSignedUpload
);

router.get(
  "/files",
  authMiddleware.protect,
  mindmapController.getFilesForMindmap
);

router.post(
  "/generate",
  authMiddleware.protect,
  mindmapController.generateMindmap
);

module.exports = router;











