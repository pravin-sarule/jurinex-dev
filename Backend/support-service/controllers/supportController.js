const {
  VALID_STATUSES,
  VALID_PRIORITIES,
  createTicket,
  listTicketsForUser,
  listTicketsForAdmin,
  getTicketForActor,
  markTicketSeen,
  updateTicketStatus,
  getAttachmentForActor,
} = require("../services/supportService");
const {
  sendTicketRaisedEmail,
  sendTicketSeenEmail,
  sendTicketResolvedEmail,
} = require("../services/mailService");
const { isAdminUser } = require("../middleware/auth");

function trimString(value) {
  return String(value || "").trim();
}

async function listMyTickets(req, res, next) {
  try {
    console.log("[SupportController] listMyTickets:start", {
      userId: req.user?.id,
      email: req.user?.email,
      accountType: req.user?.account_type,
    });
    const tickets = await listTicketsForUser(req.user.id);
    console.log("[SupportController] listMyTickets:success", {
      userId: req.user?.id,
      ticketCount: tickets.length,
    });
    return res.json({ success: true, tickets });
  } catch (error) {
    console.error("[SupportController] listMyTickets:error", {
      userId: req.user?.id,
      message: error.message,
      stack: error.stack,
    });
    return next(error);
  }
}

async function createSupportTicket(req, res, next) {
  try {
    const subject = trimString(req.body.subject);
    const priority = trimString(req.body.priority).toLowerCase() || "medium";
    const message = trimString(req.body.message || req.body.description);
    const files = req.files || [];

    console.log("[SupportController] createSupportTicket:start", {
      userId: req.user?.id,
      email: req.user?.email,
      subject,
      priority,
      messageLength: message.length,
      attachmentCount: files.length,
      attachments: files.map((file) => ({
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size,
      })),
    });

    if (!subject || !message) {
      console.warn("[SupportController] createSupportTicket:validation_failed", {
        subjectPresent: Boolean(subject),
        messagePresent: Boolean(message),
      });
      return res.status(400).json({
        success: false,
        message: "Subject and description are required.",
      });
    }

    if (priority && !VALID_PRIORITIES.includes(priority)) {
      console.warn("[SupportController] createSupportTicket:invalid_priority", {
        providedPriority: priority,
      });
      return res.status(400).json({
        success: false,
        message: "Invalid priority value.",
      });
    }

    const ticket = await createTicket({
      user: req.user,
      subject,
      priority,
      message,
      files,
    });

    console.log("[SupportController] createSupportTicket:ticket_created", {
      ticketId: ticket.id,
      ticketNumber: ticket.ticket_number,
      status: ticket.status,
      attachmentCount: ticket.attachments?.length || 0,
    });

    sendTicketRaisedEmail(ticket).catch((error) => {
      console.error("[SupportController] createSupportTicket:raised_email_failed", {
        ticketId: ticket.id,
        ticketNumber: ticket.ticket_number,
        message: error.message,
      });
    });

    return res.status(201).json({
      success: true,
      message: "Support ticket raised successfully.",
      ticket,
    });
  } catch (error) {
    console.error("[SupportController] createSupportTicket:error", {
      userId: req.user?.id,
      message: error.message,
      stack: error.stack,
    });
    return next(error);
  }
}

async function listAdminQueue(req, res, next) {
  try {
    console.log("[SupportController] listAdminQueue:start", {
      userId: req.user?.id,
      email: req.user?.email,
      status: trimString(req.query.status).toLowerCase(),
      search: trimString(req.query.search),
    });
    const tickets = await listTicketsForAdmin({
      status: trimString(req.query.status).toLowerCase(),
      search: trimString(req.query.search),
    });
    console.log("[SupportController] listAdminQueue:success", {
      userId: req.user?.id,
      ticketCount: tickets.length,
    });
    return res.json({ success: true, tickets });
  } catch (error) {
    console.error("[SupportController] listAdminQueue:error", {
      userId: req.user?.id,
      message: error.message,
      stack: error.stack,
    });
    return next(error);
  }
}

async function getTicket(req, res, next) {
  try {
    console.log("[SupportController] getTicket:start", {
      ticketId: req.params.ticketId,
      actorUserId: req.user?.id,
      isAdmin: isAdminUser(req.user),
    });
    const ticket = await getTicketForActor(
      Number(req.params.ticketId),
      req.user,
      isAdminUser(req.user)
    );

    if (!ticket) {
      console.warn("[SupportController] getTicket:not_found", {
        ticketId: req.params.ticketId,
        actorUserId: req.user?.id,
      });
      return res.status(404).json({
        success: false,
        message: "Ticket not found.",
      });
    }

    console.log("[SupportController] getTicket:success", {
      ticketId: ticket.id,
      ticketNumber: ticket.ticket_number,
      actorUserId: req.user?.id,
    });
    return res.json({ success: true, ticket });
  } catch (error) {
    console.error("[SupportController] getTicket:error", {
      ticketId: req.params.ticketId,
      actorUserId: req.user?.id,
      message: error.message,
      stack: error.stack,
    });
    return next(error);
  }
}

async function markTicketAsSeen(req, res, next) {
  try {
    console.log("[SupportController] markTicketAsSeen:start", {
      ticketId: req.params.ticketId,
      adminUserId: req.user?.id,
      adminEmail: req.user?.email,
    });
    const ticket = await markTicketSeen(Number(req.params.ticketId), req.user.email);

    if (!ticket) {
      console.warn("[SupportController] markTicketAsSeen:not_found", {
        ticketId: req.params.ticketId,
      });
      return res.status(404).json({
        success: false,
        message: "Ticket not found.",
      });
    }

    sendTicketSeenEmail(ticket).catch((error) => {
      console.error("[SupportController] markTicketAsSeen:email_failed", {
        ticketId: ticket.id,
        ticketNumber: ticket.ticket_number,
        message: error.message,
      });
    });

    console.log("[SupportController] markTicketAsSeen:success", {
      ticketId: ticket.id,
      ticketNumber: ticket.ticket_number,
      newStatus: ticket.status,
    });

    return res.json({
      success: true,
      message: "Ticket marked as in progress.",
      ticket,
    });
  } catch (error) {
    console.error("[SupportController] markTicketAsSeen:error", {
      ticketId: req.params.ticketId,
      adminUserId: req.user?.id,
      message: error.message,
      stack: error.stack,
    });
    return next(error);
  }
}

async function updateTicket(req, res, next) {
  try {
    const status = trimString(req.body.status).toLowerCase();
    const adminNote = trimString(req.body.admin_note || req.body.adminNote);

    console.log("[SupportController] updateTicket:start", {
      ticketId: req.params.ticketId,
      adminUserId: req.user?.id,
      adminEmail: req.user?.email,
      status,
      adminNoteLength: adminNote.length,
    });

    if (!VALID_STATUSES.includes(status)) {
      console.warn("[SupportController] updateTicket:invalid_status", {
        ticketId: req.params.ticketId,
        providedStatus: status,
      });
      return res.status(400).json({
        success: false,
        message: "Invalid status value.",
      });
    }

    const ticket = await updateTicketStatus(Number(req.params.ticketId), {
      status,
      adminNote,
      adminEmail: req.user.email,
    });

    if (!ticket) {
      console.warn("[SupportController] updateTicket:not_found", {
        ticketId: req.params.ticketId,
      });
      return res.status(404).json({
        success: false,
        message: "Ticket not found.",
      });
    }

    if (status === "resolved") {
      sendTicketResolvedEmail(ticket).catch((error) => {
        console.error("[SupportController] updateTicket:resolved_email_failed", {
          ticketId: ticket.id,
          ticketNumber: ticket.ticket_number,
          message: error.message,
        });
      });
    } else if (status === "in_progress") {
      sendTicketSeenEmail(ticket).catch((error) => {
        console.error("[SupportController] updateTicket:processing_email_failed", {
          ticketId: ticket.id,
          ticketNumber: ticket.ticket_number,
          message: error.message,
        });
      });
    }

    console.log("[SupportController] updateTicket:success", {
      ticketId: ticket.id,
      ticketNumber: ticket.ticket_number,
      newStatus: ticket.status,
    });

    return res.json({
      success: true,
      message: "Ticket updated successfully.",
      ticket,
    });
  } catch (error) {
    console.error("[SupportController] updateTicket:error", {
      ticketId: req.params.ticketId,
      adminUserId: req.user?.id,
      message: error.message,
      stack: error.stack,
    });
    return next(error);
  }
}

async function redirectToAttachment(req, res, next) {
  try {
    console.log("[SupportController] redirectToAttachment:start", {
      ticketId: req.params.ticketId,
      attachmentId: req.params.attachmentId,
      actorUserId: req.user?.id,
      isAdmin: isAdminUser(req.user),
    });
    const attachment = await getAttachmentForActor(
      Number(req.params.ticketId),
      req.params.attachmentId,
      req.user,
      isAdminUser(req.user)
    );

    if (!attachment || !attachment.signedUrl) {
      console.warn("[SupportController] redirectToAttachment:not_found", {
        ticketId: req.params.ticketId,
        attachmentId: req.params.attachmentId,
      });
      return res.status(404).json({
        success: false,
        message: "Attachment not found.",
      });
    }

    console.log("[SupportController] redirectToAttachment:success", {
      ticketId: req.params.ticketId,
      attachmentId: req.params.attachmentId,
      actorUserId: req.user?.id,
    });
    return res.redirect(attachment.signedUrl);
  } catch (error) {
    console.error("[SupportController] redirectToAttachment:error", {
      ticketId: req.params.ticketId,
      attachmentId: req.params.attachmentId,
      actorUserId: req.user?.id,
      message: error.message,
      stack: error.stack,
    });
    return next(error);
  }
}

module.exports = {
  listMyTickets,
  createSupportTicket,
  listAdminQueue,
  getTicket,
  markTicketAsSeen,
  updateTicket,
  redirectToAttachment,
};
