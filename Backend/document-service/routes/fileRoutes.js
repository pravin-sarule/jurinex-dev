const express = require("express");
const router = express.Router();
const multer = require("multer");
const fileController = require("../controllers/FileController");
const intelligentChatController = require("../controllers/intelligentFolderChatController");
const authMiddleware = require("../middleware/auth"); // Import auth middleware
const { checkDocumentUploadLimits } = require("../middleware/checkTokenLimits"); // Import the new middleware

const upload = multer({ storage: multer.memoryStorage() });


router.get("/file/:fileId/view", authMiddleware.protect, async (req, res) => {
  try {
    const fileId = req.params.fileId;
    console.log(`✅ [Route /file/:fileId/view] Matched! fileId: ${fileId}, URL: ${req.originalUrl}`);
    await fileController.viewDocument(req, res);
  } catch (error) {
    console.error(`❌ [Route /file/:fileId/view] Error:`, error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: "Failed to process file view request",
        details: error.message
      });
    }
  }
});

router.get("/:fileId/view", authMiddleware.protect, async (req, res, next) => {
  try {
    const fileId = req.params.fileId;

    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    console.log(`🔍 [Route /:fileId/view] Checking fileId: ${fileId}`);
    console.log(`🔍 [Route /:fileId/view] Full URL: ${req.originalUrl || req.url}`);

    if (!uuidPattern.test(fileId)) {
      console.log(`⏭️ [Route /:fileId/view] Not a UUID (${fileId}), calling next('route')`);
      return next('route'); // Skip to next matching route
    }

    console.log(`✅ [Route /:fileId/view] UUID validated! fileId: ${fileId}`);
    console.log(`✅ [Route /:fileId/view] Calling viewDocument controller`);

    await fileController.viewDocument(req, res);
  } catch (error) {
    console.error(`❌ [Route /:fileId/view] Error:`, error);
    console.error(`❌ [Route /:fileId/view] Error stack:`, error.stack);
    if (!res.headersSent) {
      return res.status(500).json({
        error: "Failed to process file view request",
        details: error.message
      });
    }
    next(error);
  }
});

router.post("/create-folder", authMiddleware.protect, fileController.createFolder);
router.post("/create", authMiddleware.protect, fileController.createCase);
router.delete("/cases/:caseId", authMiddleware.protect, fileController.deleteCase);
router.put("/cases/:caseId", authMiddleware.protect, fileController.updateCase);
router.get("/cases/:caseId", authMiddleware.protect, fileController.getCase);

router.get("/folders", authMiddleware.protect, fileController.getFolders);

router.get("/mindmap/files", authMiddleware.protect, fileController.getFilesForMindmap);

router.get("/cases", authMiddleware.protect, fileController.getAllCases);

router.get("/:folderName/documents", authMiddleware.protect, fileController.getDocumentsInFolder);

router.get("/:folderName/chunks", authMiddleware.protect, fileController.getFolderChunks);

router.post("/:folderName/generate-upload-url", authMiddleware.protect, fileController.generateUploadUrl);

router.post("/:folderName/complete-upload", authMiddleware.protect, fileController.completeSignedUpload);

router.post("/:folderName/upload", authMiddleware.protect, checkDocumentUploadLimits, upload.array("files", 10), fileController.uploadDocumentsToCaseByFolderName);

router.get("/:folderName/summary", authMiddleware.protect, fileController.getFolderSummary);

router.get("/status/:file_id", authMiddleware.protect, fileController.getFileProcessingStatus);

// Handle folder status - decode folderName to support paths with slashes
router.get("/:folderName/status", authMiddleware.protect, (req, res, next) => {
  // Decode the folderName parameter to handle URL-encoded paths
  req.params.folderName = decodeURIComponent(req.params.folderName);
  fileController.getFolderProcessingStatus(req, res);
});

router.post("/:folderName/query", authMiddleware.protect, fileController.queryFolderDocuments);

router.post("/:folderName/query/stream", authMiddleware.protect, fileController.queryFolderDocumentsStream);

router.post("/upload-and-extract-case-fields", authMiddleware.protect, checkDocumentUploadLimits, upload.array("files", 10), fileController.uploadAndExtractCaseFields);

// New separate endpoints for case creation workflow
router.post("/upload-for-processing", authMiddleware.protect, checkDocumentUploadLimits, upload.array("files", 10), fileController.uploadForProcessing);
// Handle extract case fields - decode folderName to support paths with slashes
router.post("/extract-case-fields/:folderName", authMiddleware.protect, (req, res, next) => {
  // Decode the folderName parameter to handle URL-encoded paths
  req.params.folderName = decodeURIComponent(req.params.folderName);
  fileController.extractCaseFieldsFromFolder(req, res);
});

router.post("/:folderName/intelligent-chat", authMiddleware.protect, intelligentChatController.intelligentFolderChat);
router.post("/:folderName/intelligent-chat/stream", authMiddleware.protect, intelligentChatController.intelligentFolderChatStream);

router.get("/:folderName/sessions", authMiddleware.protect, fileController.getFolderChatSessions);

router.get("/:folderName/sessions/:sessionId", authMiddleware.protect, fileController.getFolderChatSessionById);

router.get("/:folderName/chats/:chatId/citations", authMiddleware.protect, fileController.getChatCitations);

router.post("/:folderName/sessions/:sessionId/continue", authMiddleware.protect, fileController.continueFolderChat);

router.delete("/:folderName/sessions/:sessionId", authMiddleware.protect, fileController.deleteFolderChatSession);

router.get("/:folderName/chats", authMiddleware.protect, fileController.getFolderChatsByFolder);
router.get("/:folderName/chats/:sessionId", authMiddleware.protect, fileController.getFolderChatSessionById);
router.delete("/:folderName/chats", authMiddleware.protect, fileController.deleteAllFolderChats);
router.delete("/:folderName/chat/:chatId", authMiddleware.protect, fileController.deleteSingleFolderChat);
router.delete("/:folderName/chats/:sessionId", authMiddleware.protect, fileController.deleteFolderChatSession);

router.get("/:folderName/files", authMiddleware.protect, fileController.getCaseFilesByFolderName);

router.get("/document/:fileId/view", authMiddleware.protect, async (req, res) => {
  await fileController.viewDocument(req, res);
});
router.get("/document/:fileId/stream", authMiddleware.protect, fileController.streamDocument);

router.delete("/:fileId", authMiddleware.protect, fileController.deleteDocument);

router.get(
  "/file/:file_id/complete",
  authMiddleware.protect,
  fileController.getFileComplete
);

module.exports = router;