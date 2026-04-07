const crypto = require("crypto");
const { bucket } = require("../config/gcs");

const ATTACHMENT_URL_TTL_MS = 24 * 60 * 60 * 1000;

function safeFileName(fileName = "attachment") {
  return String(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function uploadAttachments(files = [], userId) {
  console.log("[SupportStorage] uploadAttachments:start", {
    userId,
    fileCount: files.length,
    files: files.map((file) => ({
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
    })),
  });

  if (!files.length) return [];

  if (!bucket) {
    const error = new Error(
      "Attachment storage is not configured. Add SUPPORT_GCS_BUCKET_NAME and GCS credentials."
    );
    error.statusCode = 500;
    throw error;
  }

  const uploaded = [];

  for (const file of files) {
    const attachmentId = crypto.randomUUID();
    const objectName = `support/${userId}/${Date.now()}-${attachmentId}-${safeFileName(file.originalname)}`;
    const objectRef = bucket.file(objectName);

    console.log("[SupportStorage] uploadAttachments:file_uploading", {
      userId,
      attachmentId,
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      objectName,
    });

    await objectRef.save(file.buffer, {
      contentType: file.mimetype,
      resumable: false,
      metadata: {
        metadata: {
          attachmentId,
          uploadedAt: new Date().toISOString(),
          userId: String(userId),
        },
      },
    });

    uploaded.push({
      id: attachmentId,
      name: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      gcsPath: objectName,
    });

    console.log("[SupportStorage] uploadAttachments:file_uploaded", {
      userId,
      attachmentId,
      originalname: file.originalname,
      objectName,
    });
  }

  console.log("[SupportStorage] uploadAttachments:success", {
    userId,
    uploadedCount: uploaded.length,
    uploaded,
  });

  return uploaded;
}

async function getSignedReadUrl(gcsPath) {
  if (!bucket || !gcsPath) return null;

  console.log("[SupportStorage] getSignedReadUrl:start", { gcsPath });

  const [url] = await bucket.file(gcsPath).getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + ATTACHMENT_URL_TTL_MS,
  });

  console.log("[SupportStorage] getSignedReadUrl:success", {
    gcsPath,
    urlGenerated: Boolean(url),
  });

  return url;
}

async function hydrateAttachments(ticketId, attachments = []) {
  const normalized = Array.isArray(attachments) ? attachments : [];

  console.log("[SupportStorage] hydrateAttachments:start", {
    ticketId,
    attachmentCount: normalized.length,
  });

  const hydrated = await Promise.all(
    normalized.map(async (attachment) => ({
      ...attachment,
      previewUrl: attachment.gcsPath ? await getSignedReadUrl(attachment.gcsPath) : null,
      downloadUrl: `/support/tickets/${ticketId}/attachments/${attachment.id}`,
    }))
  );

  console.log("[SupportStorage] hydrateAttachments:success", {
    ticketId,
    attachmentCount: hydrated.length,
  });

  return hydrated;
}

module.exports = {
  uploadAttachments,
  getSignedReadUrl,
  hydrateAttachments,
};
