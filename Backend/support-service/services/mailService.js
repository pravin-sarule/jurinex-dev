const nodemailer = require("nodemailer");
require("dotenv").config();

const transportConfigured = Boolean(process.env.EMAIL_USER && process.env.EMAIL_PASS);

const transporter = transportConfigured
  ? nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    })
  : null;

console.log("[SupportMail] Mail transport status", {
  transportConfigured,
  emailUser: process.env.EMAIL_USER || null,
});

function layout({ title, intro, ticket, actionLabel, accent = "#21C1B6" }) {
  const statusLabel = String(ticket.status || "open")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

  const noteBlock = ticket.admin_note
    ? `<div style="margin-top:16px;padding:14px 16px;border-radius:12px;background:#F8FAFC;border:1px solid #E2E8F0;">
         <div style="font-size:12px;font-weight:700;color:#475569;text-transform:uppercase;letter-spacing:0.08em;">Support Note</div>
         <div style="margin-top:8px;font-size:14px;line-height:1.7;color:#334155;">${ticket.admin_note}</div>
       </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:24px;background:#F1F5F9;font-family:Inter,Arial,sans-serif;color:#0F172A;">
    <div style="max-width:620px;margin:0 auto;background:#FFFFFF;border-radius:20px;overflow:hidden;box-shadow:0 18px 40px rgba(15,23,42,0.08);">
      <div style="height:6px;background:${accent};"></div>
      <div style="padding:28px 32px 20px;">
        <div style="font-size:26px;font-weight:800;color:#0F172A;">${title}</div>
        <div style="margin-top:10px;font-size:15px;line-height:1.7;color:#475569;">${intro}</div>
        <div style="margin-top:22px;padding:18px;border-radius:16px;background:#F8FAFC;border:1px solid #E2E8F0;">
          <div style="font-size:12px;font-weight:700;color:#64748B;text-transform:uppercase;letter-spacing:0.08em;">${actionLabel}</div>
          <div style="margin-top:12px;font-size:20px;font-weight:800;color:#0F172A;">${ticket.ticket_number || `Ticket #${ticket.id}`}</div>
          <div style="margin-top:10px;font-size:14px;color:#334155;"><strong>Subject:</strong> ${ticket.subject}</div>
          <div style="margin-top:6px;font-size:14px;color:#334155;"><strong>Priority:</strong> ${ticket.priority}</div>
          <div style="margin-top:6px;font-size:14px;color:#334155;"><strong>Status:</strong> ${statusLabel}</div>
        </div>
        ${noteBlock}
      </div>
      <div style="padding:18px 32px 28px;border-top:1px solid #E2E8F0;background:#F8FAFC;font-size:13px;color:#64748B;">
        You can track this ticket anytime from the Jurinex Help Center.
      </div>
    </div>
  </body>
</html>`;
}

async function sendEmail({ to, subject, html, stage, ticket }) {
  console.log("[SupportMail] sendEmail:attempt", {
    stage,
    to,
    subject,
    ticketId: ticket?.id || null,
    ticketNumber: ticket?.ticket_number || null,
    status: ticket?.status || null,
  });

  if (!transporter) {
    console.warn("[SupportMail] sendEmail:skipped", {
      stage,
      to,
      subject,
      reason: "EMAIL_USER or EMAIL_PASS not configured",
      ticketId: ticket?.id || null,
      ticketNumber: ticket?.ticket_number || null,
    });
    return;
  }

  const info = await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to,
    subject,
    html,
  });

  console.log("[SupportMail] sendEmail:success", {
    stage,
    to,
    subject,
    ticketId: ticket?.id || null,
    ticketNumber: ticket?.ticket_number || null,
    messageId: info?.messageId || null,
    accepted: info?.accepted || [],
    rejected: info?.rejected || [],
    response: info?.response || null,
  });

  return info;
}

async function sendTicketRaisedEmail(ticket) {
  console.log("[SupportMail] sendTicketRaisedEmail:start", {
    ticketId: ticket?.id || null,
    ticketNumber: ticket?.ticket_number || null,
    to: ticket?.user_email || null,
  });

  return sendEmail({
    to: ticket.user_email,
    subject: `Your Jurinex ticket ${ticket.ticket_number} has been raised`,
    html: layout({
      title: "Your support ticket has been raised",
      intro:
        "Our support team has received your request. We will review it and keep the status updated in your Help Center history.",
      ticket,
      actionLabel: "Ticket Created",
    }),
    stage: "ticket_raised",
    ticket,
  });
}

async function sendTicketSeenEmail(ticket) {
  console.log("[SupportMail] sendTicketSeenEmail:start", {
    ticketId: ticket?.id || null,
    ticketNumber: ticket?.ticket_number || null,
    to: ticket?.user_email || null,
  });

  return sendEmail({
    to: ticket.user_email,
    subject: `Your Jurinex ticket ${ticket.ticket_number} is being processed`,
    html: layout({
      title: "Your ticket is now in progress",
      intro:
        "A support admin has opened your ticket and started working on the request.",
      ticket,
      actionLabel: "Processing Started",
      accent: "#0EA5E9",
    }),
    stage: "ticket_in_progress",
    ticket,
  });
}

async function sendTicketResolvedEmail(ticket) {
  console.log("[SupportMail] sendTicketResolvedEmail:start", {
    ticketId: ticket?.id || null,
    ticketNumber: ticket?.ticket_number || null,
    to: ticket?.user_email || null,
  });

  return sendEmail({
    to: ticket.user_email,
    subject: `Your Jurinex ticket ${ticket.ticket_number} has been resolved`,
    html: layout({
      title: "Your ticket has been resolved",
      intro:
        "The support team has marked your request as resolved. Please review the update in the Help Center. If the issue continues, you can raise a new ticket with fresh details.",
      ticket,
      actionLabel: "Resolved",
      accent: "#16A34A",
    }),
    stage: "ticket_resolved",
    ticket,
  });
}

module.exports = {
  sendTicketRaisedEmail,
  sendTicketSeenEmail,
  sendTicketResolvedEmail,
};
