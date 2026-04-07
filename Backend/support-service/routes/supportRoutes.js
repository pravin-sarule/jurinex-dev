const express = require("express");
const multer = require("multer");
const {
  authenticate,
  requireAdmin,
} = require("../middleware/auth");
const {
  listMyTickets,
  createSupportTicket,
  listAdminQueue,
  getTicket,
  markTicketAsSeen,
  updateTicket,
  redirectToAttachment,
} = require("../controllers/supportController");

const router = express.Router();

const allowedMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
    files: 30,
  },
  fileFilter: (req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      const error = new Error(
        "Unsupported attachment type. Please upload screenshots, PDFs, or Word documents."
      );
      error.code = "UNSUPPORTED_ATTACHMENT_TYPE";
      return cb(error);
    }

    return cb(null, true);
  },
});

router.get("/health", (req, res) => {
  res.json({ success: true, message: "Support service is running." });
});

router.use(authenticate);

router.get("/tickets/my", listMyTickets);
router.post("/tickets", upload.array("attachments", 30), createSupportTicket);
router.get("/tickets/:ticketId", getTicket);
router.get("/tickets/:ticketId/attachments/:attachmentId", redirectToAttachment);

router.get("/tickets/admin/all", requireAdmin, listAdminQueue);
router.post("/tickets/:ticketId/seen", requireAdmin, markTicketAsSeen);
router.patch("/tickets/:ticketId/status", requireAdmin, updateTicket);

module.exports = router;
