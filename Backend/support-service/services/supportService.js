const pool = require("../config/db");
const { uploadAttachments, hydrateAttachments, getSignedReadUrl } = require("./storageService");

const VALID_STATUSES = ["open", "in_progress", "resolved"];
const VALID_PRIORITIES = ["low", "medium", "high", "urgent"];

function normalizeEmailName(email = "") {
  const local = String(email).split("@")[0] || "User";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function createHistoryEntry({ status, actorType, actorEmail, note, label }) {
  return {
    id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    status,
    actorType,
    actorEmail: actorEmail || null,
    note: note || null,
    label: label || null,
    createdAt: new Date().toISOString(),
  };
}

function parseJsonArray(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (!value) return fallback;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch (error) {
      return fallback;
    }
  }
  return fallback;
}

async function initializeSupportSchema() {
  console.log("[SupportServiceDB] initializeSupportSchema:start");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS support_queries (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL,
      subject TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await pool.query(`
    ALTER TABLE support_queries
    ADD COLUMN IF NOT EXISTS ticket_number TEXT,
    ADD COLUMN IF NOT EXISTS user_email TEXT,
    ADD COLUMN IF NOT EXISTS user_name TEXT,
    ADD COLUMN IF NOT EXISTS attachment_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS status_history JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS admin_note TEXT,
    ADD COLUMN IF NOT EXISTS seen_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ;
  `);

  await pool.query(`
    ALTER TABLE support_queries
    DROP COLUMN IF EXISTS attachment_url;
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_support_queries_ticket_number
    ON support_queries (ticket_number)
    WHERE ticket_number IS NOT NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_support_queries_user_id_created_at
    ON support_queries (user_id, created_at DESC);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_support_queries_status_created_at
    ON support_queries (status, created_at DESC);
  `);
  console.log("[SupportServiceDB] initializeSupportSchema:success");
}

async function mapTicketRow(row) {
  console.log("[SupportServiceDB] mapTicketRow:start", {
    ticketId: row?.id,
    ticketNumber: row?.ticket_number || null,
    status: row?.status || null,
  });
  const attachments = parseJsonArray(row.attachment_urls);
  const history = parseJsonArray(row.status_history);

  const mapped = {
    id: row.id,
    ticket_number: row.ticket_number,
    user_id: row.user_id,
    user_email: row.user_email,
    user_name: row.user_name,
    subject: row.subject,
    priority: row.priority,
    message: row.message,
    status: row.status,
    admin_note: row.admin_note,
    seen_at: row.seen_at,
    resolved_at: row.resolved_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    attachments: await hydrateAttachments(row.id, attachments),
    status_history: history,
  };

  console.log("[SupportServiceDB] mapTicketRow:success", {
    ticketId: mapped.id,
    ticketNumber: mapped.ticket_number,
    status: mapped.status,
    attachmentCount: mapped.attachments.length,
    historyCount: mapped.status_history.length,
  });

  return mapped;
}

function buildTicketNumber(id) {
  return `SUP-${String(id).padStart(6, "0")}`;
}

async function createTicket({ user, subject, priority, message, files }) {
  console.log("[SupportServiceDB] createTicket:start", {
    userId: user?.id,
    email: user?.email,
    subject,
    priority,
    messageLength: message?.length || 0,
    fileCount: files?.length || 0,
  });
  const normalizedPriority = VALID_PRIORITIES.includes(priority) ? priority : "medium";
  const uploadedAttachments = await uploadAttachments(files, user.id);
  const userName = normalizeEmailName(user.email);
  const history = [
    createHistoryEntry({
      status: "open",
      actorType: "user",
      actorEmail: user.email,
      label: "Ticket raised",
    }),
  ];

  const insertResult = await pool.query(
    `
      INSERT INTO support_queries (
        user_id,
        user_email,
        user_name,
        subject,
        priority,
        message,
        attachment_urls,
        status,
        status_history,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'open', $8::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING *
    `,
    [
      user.id,
      user.email,
      userName,
      subject,
      normalizedPriority,
      message,
      JSON.stringify(uploadedAttachments),
      JSON.stringify(history),
    ]
  );

  const insertedRow = insertResult.rows[0];
  const ticketNumber = buildTicketNumber(insertedRow.id);

  console.log("[SupportServiceDB] createTicket:inserted", {
    ticketId: insertedRow.id,
    generatedTicketNumber: ticketNumber,
    attachmentCount: uploadedAttachments.length,
    userId: user.id,
  });

  const updateResult = await pool.query(
    `
      UPDATE support_queries
      SET ticket_number = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `,
    [insertedRow.id, ticketNumber]
  );

  const mapped = await mapTicketRow(updateResult.rows[0]);
  console.log("[SupportServiceDB] createTicket:success", {
    ticketId: mapped.id,
    ticketNumber: mapped.ticket_number,
    status: mapped.status,
  });
  return mapped;
}

async function listTicketsForUser(userId) {
  console.log("[SupportServiceDB] listTicketsForUser:start", { userId });
  const result = await pool.query(
    `
      SELECT *
      FROM support_queries
      WHERE user_id = $1
      ORDER BY created_at DESC
    `,
    [userId]
  );

  console.log("[SupportServiceDB] listTicketsForUser:rows_fetched", {
    userId,
    rowCount: result.rows.length,
  });

  const mapped = await Promise.all(result.rows.map(mapTicketRow));
  console.log("[SupportServiceDB] listTicketsForUser:success", {
    userId,
    ticketCount: mapped.length,
  });
  return mapped;
}

async function listTicketsForAdmin({ status, search }) {
  console.log("[SupportServiceDB] listTicketsForAdmin:start", {
    status: status || null,
    search: search || null,
  });
  const whereClauses = [];
  const values = [];

  if (status && VALID_STATUSES.includes(status)) {
    values.push(status);
    whereClauses.push(`status = $${values.length}`);
  }

  if (search) {
    values.push(`%${search.toLowerCase()}%`);
    whereClauses.push(`
      (
        LOWER(COALESCE(ticket_number, '')) LIKE $${values.length}
        OR LOWER(COALESCE(user_email, '')) LIKE $${values.length}
        OR LOWER(COALESCE(subject, '')) LIKE $${values.length}
        OR LOWER(COALESCE(message, '')) LIKE $${values.length}
      )
    `);
  }

  const result = await pool.query(
    `
      SELECT *
      FROM support_queries
      ${whereClauses.length ? `WHERE ${whereClauses.join(" AND ")}` : ""}
      ORDER BY
        CASE status
          WHEN 'open' THEN 1
          WHEN 'in_progress' THEN 2
          WHEN 'resolved' THEN 3
          ELSE 4
        END,
        created_at DESC
    `,
    values
  );

  console.log("[SupportServiceDB] listTicketsForAdmin:rows_fetched", {
    rowCount: result.rows.length,
    status: status || null,
    search: search || null,
  });

  const mapped = await Promise.all(result.rows.map(mapTicketRow));
  console.log("[SupportServiceDB] listTicketsForAdmin:success", {
    ticketCount: mapped.length,
  });
  return mapped;
}

async function getRawTicketById(ticketId) {
  console.log("[SupportServiceDB] getRawTicketById:start", { ticketId });
  const result = await pool.query(`SELECT * FROM support_queries WHERE id = $1`, [ticketId]);
  const row = result.rows[0] || null;
  console.log("[SupportServiceDB] getRawTicketById:result", {
    ticketId,
    found: Boolean(row),
    status: row?.status || null,
    ticketNumber: row?.ticket_number || null,
  });
  return row;
}

async function getTicketById(ticketId) {
  const row = await getRawTicketById(ticketId);
  return row ? mapTicketRow(row) : null;
}

async function getTicketForActor(ticketId, user, isAdmin) {
  console.log("[SupportServiceDB] getTicketForActor:start", {
    ticketId,
    actorUserId: user?.id,
    actorEmail: user?.email,
    isAdmin,
  });
  const row = await getRawTicketById(ticketId);
  if (!row) return null;
  if (!isAdmin && Number(row.user_id) !== Number(user.id)) {
    console.warn("[SupportServiceDB] getTicketForActor:forbidden", {
      ticketId,
      actorUserId: user?.id,
      ownerUserId: row.user_id,
    });
    return null;
  }
  const mapped = await mapTicketRow(row);
  console.log("[SupportServiceDB] getTicketForActor:success", {
    ticketId: mapped.id,
    ticketNumber: mapped.ticket_number,
    actorUserId: user?.id,
  });
  return mapped;
}

async function markTicketSeen(ticketId, adminEmail) {
  console.log("[SupportServiceDB] markTicketSeen:start", {
    ticketId,
    adminEmail,
  });
  const existing = await getRawTicketById(ticketId);
  if (!existing) return null;

  const alreadyProcessed = existing.status === "in_progress" && existing.seen_at;
  if (alreadyProcessed) {
    console.log("[SupportServiceDB] markTicketSeen:already_processed", {
      ticketId,
      ticketNumber: existing.ticket_number,
      status: existing.status,
      seenAt: existing.seen_at,
    });
    return mapTicketRow(existing);
  }

  const history = parseJsonArray(existing.status_history);
  history.push(
    createHistoryEntry({
      status: "in_progress",
      actorType: "admin",
      actorEmail: adminEmail,
      label: "Ticket opened by admin",
    })
  );

  const result = await pool.query(
    `
      UPDATE support_queries
      SET
        status = 'in_progress',
        seen_at = COALESCE(seen_at, CURRENT_TIMESTAMP),
        status_history = $2::jsonb,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `,
    [ticketId, JSON.stringify(history)]
  );

  const mapped = await mapTicketRow(result.rows[0]);
  console.log("[SupportServiceDB] markTicketSeen:success", {
    ticketId: mapped.id,
    ticketNumber: mapped.ticket_number,
    status: mapped.status,
    historyCount: mapped.status_history.length,
  });
  return mapped;
}

async function updateTicketStatus(ticketId, { status, adminNote, adminEmail }) {
  console.log("[SupportServiceDB] updateTicketStatus:start", {
    ticketId,
    status,
    adminEmail,
    adminNoteLength: adminNote?.length || 0,
  });
  if (!VALID_STATUSES.includes(status)) {
    const error = new Error("Invalid status value.");
    error.statusCode = 400;
    throw error;
  }

  const existing = await getRawTicketById(ticketId);
  if (!existing) return null;

  const history = parseJsonArray(existing.status_history);
  history.push(
    createHistoryEntry({
      status,
      actorType: "admin",
      actorEmail: adminEmail,
      note: adminNote,
      label:
        status === "resolved"
          ? "Ticket resolved"
          : status === "in_progress"
            ? "Ticket moved to processing"
            : "Ticket updated",
    })
  );

  const result = await pool.query(
    `
      UPDATE support_queries
      SET
        status = $2,
        admin_note = $3,
        seen_at = CASE
          WHEN $2 = 'in_progress' THEN COALESCE(seen_at, CURRENT_TIMESTAMP)
          ELSE seen_at
        END,
        resolved_at = CASE
          WHEN $2 = 'resolved' THEN CURRENT_TIMESTAMP
          WHEN $2 <> 'resolved' THEN NULL
          ELSE resolved_at
        END,
        status_history = $4::jsonb,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `,
    [ticketId, status, adminNote || null, JSON.stringify(history)]
  );

  const mapped = await mapTicketRow(result.rows[0]);
  console.log("[SupportServiceDB] updateTicketStatus:success", {
    ticketId: mapped.id,
    ticketNumber: mapped.ticket_number,
    status: mapped.status,
    resolvedAt: mapped.resolved_at || null,
  });
  return mapped;
}

async function getAttachmentForActor(ticketId, attachmentId, user, isAdmin) {
  console.log("[SupportServiceDB] getAttachmentForActor:start", {
    ticketId,
    attachmentId,
    actorUserId: user?.id,
    isAdmin,
  });
  const ticket = await getTicketForActor(ticketId, user, isAdmin);
  if (!ticket) return null;

  const attachment = (ticket.attachments || []).find((item) => item.id === attachmentId);
  if (!attachment) return null;

  const resolved = attachment.gcsPath
    ? {
        ...attachment,
        signedUrl: await getSignedReadUrl(attachment.gcsPath),
      }
    : attachment;

  console.log("[SupportServiceDB] getAttachmentForActor:success", {
    ticketId,
    attachmentId,
    actorUserId: user?.id,
    hasSignedUrl: Boolean(resolved?.signedUrl),
  });

  return resolved;
}

module.exports = {
  VALID_STATUSES,
  VALID_PRIORITIES,
  initializeSupportSchema,
  createTicket,
  listTicketsForUser,
  listTicketsForAdmin,
  getTicketById,
  getTicketForActor,
  markTicketSeen,
  updateTicketStatus,
  getAttachmentForActor,
};
