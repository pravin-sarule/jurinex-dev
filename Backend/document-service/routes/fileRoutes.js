
const express = require("express");
const router = express.Router();
const multer = require("multer");
const fileController = require("../controllers/FileController");
const intelligentChatController = require("../controllers/intelligentFolderChatController");
const authMiddleware = require("../middleware/auth"); // Import auth middleware
const { checkDocumentUploadLimits } = require("../middleware/checkTokenLimits"); // Import the new middleware

const upload = multer({ storage: multer.memoryStorage() });

// ✅ CRITICAL: File view routes MUST be at the TOP before all other routes
// This prevents route conflicts with /:folderName routes

// Route 1: More specific route /file/:fileId/view (recommended, no conflicts)
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

// Route 2: UUID-specific route /:fileId/view (with UUID validation)
router.get("/:fileId/view", authMiddleware.protect, async (req, res, next) => {
  try {
    const fileId = req.params.fileId;
    
    // UUID pattern: 8-4-4-4-12 hex digits with hyphens
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    
    console.log(`🔍 [Route /:fileId/view] Checking fileId: ${fileId}`);
    console.log(`🔍 [Route /:fileId/view] Full URL: ${req.originalUrl || req.url}`);
    
    // Validate that fileId is a UUID (not a folder name)
    if (!uuidPattern.test(fileId)) {
      // Not a UUID, skip this route and let other routes handle it
      console.log(`⏭️ [Route /:fileId/view] Not a UUID (${fileId}), calling next('route')`);
      return next('route'); // Skip to next matching route
    }
    
    console.log(`✅ [Route /:fileId/view] UUID validated! fileId: ${fileId}`);
    console.log(`✅ [Route /:fileId/view] Calling viewDocument controller`);
    
    // Call the controller - it's async
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

// Other routes (folders, cases, etc.)
// Create folder
router.post("/create-folder", authMiddleware.protect, fileController.createFolder);
router.post("/create", authMiddleware.protect, fileController.createCase);
router.delete("/cases/:caseId", authMiddleware.protect, fileController.deleteCase);
router.put("/cases/:caseId", authMiddleware.protect, fileController.updateCase);
router.get("/cases/:caseId", authMiddleware.protect, fileController.getCase);

// Get all folders for a user
router.get("/folders", authMiddleware.protect, fileController.getFolders);

// Get all cases for a user
router.get("/cases", authMiddleware.protect, fileController.getAllCases);

// Get all documents in a specific folder
router.get("/:folderName/documents", authMiddleware.protect, fileController.getDocumentsInFolder);

// Get all chunks for a folder with page information
router.get("/:folderName/chunks", authMiddleware.protect, fileController.getFolderChunks);

// Generate signed URL for large file uploads (>32MB)
router.post("/:folderName/generate-upload-url", authMiddleware.protect, fileController.generateUploadUrl);

// Complete upload after signed URL upload
router.post("/:folderName/complete-upload", authMiddleware.protect, fileController.completeSignedUpload);

// Upload multiple docs to folder
router.post("/:folderName/upload", authMiddleware.protect, checkDocumentUploadLimits, upload.array("files", 10), fileController.uploadDocumentsToCaseByFolderName);

// Generate & store folder summary
router.get("/:folderName/summary", authMiddleware.protect, fileController.getFolderSummary);

// Get file processing status (individual file)
router.get("/status/:file_id", authMiddleware.protect, fileController.getFileProcessingStatus);

// NEW ROUTES - Get folder processing status (all documents in folder)
router.get("/:folderName/status", authMiddleware.protect, fileController.getFolderProcessingStatus);

// NEW ROUTES - Query documents in folder (like Claude AI project modules)
router.post("/:folderName/query", authMiddleware.protect, fileController.queryFolderDocuments);

// NEW ROUTES - Query documents in folder - SSE Streaming Version
router.post("/:folderName/query/stream", authMiddleware.protect, fileController.queryFolderDocumentsStream);

// ============ INTELLIGENT FOLDER CHAT ROUTES (Combines Gemini Eyeball + RAG) ============
// Intelligent routing: Complete summaries → Gemini Eyeball, Specific queries → RAG
// All chats stored in folder_chat table
// NOTE: These routes must come BEFORE other :folderName routes to avoid conflicts
router.post("/:folderName/intelligent-chat", authMiddleware.protect, intelligentChatController.intelligentFolderChat);
router.post("/:folderName/intelligent-chat/stream", authMiddleware.protect, intelligentChatController.intelligentFolderChatStream);

// ============ NEW CHAT SESSION ROUTES ============
// Get all chat sessions for a folder (with previews and metadata)
router.get("/:folderName/sessions", authMiddleware.protect, fileController.getFolderChatSessions);

// Get specific chat session with complete conversation history (reopen session)
router.get("/:folderName/sessions/:sessionId", authMiddleware.protect, fileController.getFolderChatSessionById);

// Get citations for a specific chat message
router.get("/:folderName/chats/:chatId/citations", authMiddleware.protect, fileController.getChatCitations);

// Continue conversation in existing chat session (add new message)
router.post("/:folderName/sessions/:sessionId/continue", authMiddleware.protect, fileController.continueFolderChat);

// Delete entire chat session
router.delete("/:folderName/sessions/:sessionId", authMiddleware.protect, fileController.deleteFolderChatSession);

// Alternative routes using /chats/ pattern (for compatibility)
router.get("/:folderName/chats", authMiddleware.protect, fileController.getFolderChatsByFolder);
router.get("/:folderName/chats/:sessionId", authMiddleware.protect, fileController.getFolderChatSessionById);
// ✅ Delete single chat by chat ID (not session ID) - must come before session delete route
router.delete("/:folderName/chat/:chatId", authMiddleware.protect, fileController.deleteSingleFolderChat);
router.delete("/:folderName/chats/:sessionId", authMiddleware.protect, fileController.deleteFolderChatSession);


router.get("/:folderName/files", authMiddleware.protect, fileController.getCaseFilesByFolderName)

// View/Open document endpoints (alternative routes - these also work but prefer the main route above)
router.get("/document/:fileId/view", authMiddleware.protect, async (req, res) => {
  // Redirect or call the same controller
  await fileController.viewDocument(req, res);
});
router.get("/document/:fileId/stream", authMiddleware.protect, fileController.streamDocument);

router.delete("/:fileId", authMiddleware.protect, fileController.deleteDocument);

// Get file with all related data (chunks, chats, metadata) - user-specific
router.get(
  "/file/:file_id/complete",
  authMiddleware.protect,
  fileController.getFileComplete
);

module.exports = router;