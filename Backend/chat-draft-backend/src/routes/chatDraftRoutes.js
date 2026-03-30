const express = require("express");
const multer = require("multer");
const config = require("../config");
const {
  extractTextFromFile,
  splitText,
  processDocumentsParallel,
  retrieveRelevantChunks,
} = require("../services/documentProcessor");
const { generateDraftHtml } = require("../services/templateGenerator");
const { toDocxBuffer } = require("../services/docxService");
const { createSession, getSession, updateSession } = require("../store/sessionStore");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: config.maxFiles,
    fileSize: config.maxFileSizeMb * 1024 * 1024,
  },
});

/* ─────────────────────────────────────────────────────────────────────────
   Build context string from chunks.

   Strategy:
   - For "generate full draft" type requests → pass ALL chunks up to
     maxContextChars (fits comfortably in Claude's 200K context window)
   - For refinement requests → use keyword retrieval (topK)

   This ensures the AI sees the COMPLETE document content for generation,
   not just a small keyword-matched slice.
───────────────────────────────────────────────────────────────────────── */
const GENERATION_KEYWORDS = [
  "generate", "draft", "create", "write", "produce", "make",
  "prepare", "complete", "full", "entire", "whole",
];

function isGenerationRequest(message) {
  const lower = String(message || "").toLowerCase();
  return GENERATION_KEYWORDS.some((kw) => lower.includes(kw));
}

function buildContextFromAllChunks(chunks, maxChars) {
  // Group chunks by source document
  const bySource = {};
  for (const chunk of chunks) {
    if (!bySource[chunk.source]) bySource[chunk.source] = [];
    bySource[chunk.source].push(chunk.text);
  }

  const parts = [];
  let totalChars = 0;

  for (const [source, texts] of Object.entries(bySource)) {
    const header = `\n\n━━━ SOURCE: ${source} ━━━\n`;
    parts.push(header);
    totalChars += header.length;

    for (const text of texts) {
      if (totalChars + text.length > maxChars) break;
      parts.push(text);
      totalChars += text.length;
    }

    if (totalChars >= maxChars) break;
  }

  return parts.join("\n");
}

function buildContextFromRetrieved(chunks, query, topK) {
  const retrieved = retrieveRelevantChunks(chunks, query, topK);
  if (!retrieved.length) {
    // Fallback: return first N chunks if keyword retrieval finds nothing
    return chunks.slice(0, Math.min(topK, chunks.length))
      .map((c) => `[${c.source}]\n${c.text}`)
      .join("\n\n");
  }
  return retrieved.map((c) => `[${c.source}]\n${c.text}`).join("\n\n");
}

function extractTemplateTextFromPayload(payload) {
  if (!payload || typeof payload !== "object") return "";

  const directCandidates = [
    payload.html,
    payload.templateText,
    payload.template_text,
    payload.extracted_text,
    payload.original_template_text,
  ];
  for (const candidate of directCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  const template = payload.template && typeof payload.template === "object"
    ? payload.template
    : payload;
  const templateContent = template.content && typeof template.content === "object"
    ? template.content
    : null;

  const templateCandidates = [
    template?.templateText,
    template?.template_text,
    template?.extracted_text,
    template?.original_template_text,
    template?.html?.html_content,
  ];
  for (const candidate of templateCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  if (templateContent?.fallback_html?.pages?.length) {
    const html = templateContent.fallback_html.pages.map((p) => p?.html || "").join("\n\n").trim();
    if (html) return html;
  }

  if (templateContent?.structured?.pages?.length) {
    const text = templateContent.structured.pages
      .flatMap((page) => (page?.blocks || []).map((block) => block?.content?.value || block?.content?.label || ""))
      .join("\n")
      .trim();
    if (text) return text;
  }

  if (templateContent?.blocks?.length) {
    const text = templateContent.blocks
      .map((block) => block?.content?.value || block?.content?.label || "")
      .join("\n")
      .trim();
    if (text) return text;
  }

  const fields = Array.isArray(payload.all_fields)
    ? payload.all_fields
    : Array.isArray(payload.fields)
      ? payload.fields
      : Array.isArray(template.fields)
        ? template.fields
        : [];
  if (fields.length) {
    const text = fields
      .map((field) => field?.field_label || field?.label || field?.field_name || field?.key || "")
      .filter(Boolean)
      .join("\n")
      .trim();
    if (text) return text;
  }

  return "";
}

function buildTemplateSkeletonFromPayload(payload, templateId) {
  if (!payload || typeof payload !== "object") return "";

  const template = payload.template && typeof payload.template === "object"
    ? payload.template
    : payload;
  const title = String(
    template?.template_name ||
    template?.name ||
    payload?.templateName ||
    `Template ${templateId || ""}`
  ).trim();

  const sections = Array.isArray(payload.sections)
    ? payload.sections
    : Array.isArray(template.sections)
      ? template.sections
      : [];
  const fields = Array.isArray(payload.all_fields)
    ? payload.all_fields
    : Array.isArray(payload.fields)
      ? payload.fields
      : Array.isArray(template.fields)
        ? template.fields
        : [];

  const sectionLines = sections
    .map((section, index) => {
      const name = String(
        section?.section_name ||
        section?.title ||
        section?.name ||
        section?.section_key ||
        `Section ${index + 1}`
      ).trim();
      return name ? `${index + 1}. ${name}` : "";
    })
    .filter(Boolean);

  const fieldLines = fields
    .map((field) => {
      const label = String(
        field?.field_label ||
        field?.label ||
        field?.field_name ||
        field?.key ||
        ""
      ).trim();
      return label ? `- ${label}` : "";
    })
    .filter(Boolean);

  const parts = [];
  if (title) parts.push(title.toUpperCase());
  if (sectionLines.length) {
    parts.push("");
    parts.push("Sections");
    parts.push(...sectionLines);
  }
  if (fieldLines.length) {
    parts.push("");
    parts.push("Fields");
    parts.push(...fieldLines);
  }

  return parts.join("\n").trim();
}

async function fetchTemplateTextById(templateId, req) {
  const id = String(templateId || "").trim();
  if (!id) return "";

  const headers = {};
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;
  if (req.headers["x-user-id"]) headers["X-User-Id"] = req.headers["x-user-id"];

  const tryFetchJson = async (url) => {
    try {
      const res = await fetch(url, { headers });
      const payload = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, payload };
    } catch (error) {
      return { ok: false, status: 0, payload: { message: error.message } };
    }
  };

  const contentUrl = `${config.agentDraftTemplateApiUrl}/api/templates/${encodeURIComponent(id)}/content`;
  const contentRes = await tryFetchJson(contentUrl);
  if (contentRes.ok || contentRes.status === 200) {
    const text = extractTemplateTextFromPayload(contentRes.payload);
    if (text) return text;
    // If content endpoint returned a message, log it but continue trying
    if (contentRes.payload?.message) {
      console.warn(`[fetchTemplateTextById] content endpoint: ${contentRes.payload.message}`);
    }
  }

  const detailUrl = `${config.agentDraftTemplateApiUrl}/api/templates/${encodeURIComponent(id)}?include_sections=true&include_preview_url=false`;
  const detailRes = await tryFetchJson(detailUrl);
  if (detailRes.ok || detailRes.status === 200) {
    const text = extractTemplateTextFromPayload(detailRes.payload);
    if (text) return text;

    const skeleton = buildTemplateSkeletonFromPayload(detailRes.payload, id);
    if (skeleton) return skeleton;
  }

  const analyzerBase = String(process.env.TEMPLATE_ANALYZER_URL || "http://localhost:5017").replace(/\/+$/, "");
  const analyzerUrl = `${analyzerBase}/analysis/template/${encodeURIComponent(id)}`;
  const analyzerRes = await tryFetchJson(analyzerUrl);
  if (analyzerRes.ok) {
    const text = extractTemplateTextFromPayload(analyzerRes.payload);
    if (text) return text;

    const skeleton = buildTemplateSkeletonFromPayload(analyzerRes.payload, id);
    if (skeleton) return skeleton;
  }

  const msg =
    contentRes.payload?.message ||
    contentRes.payload?.detail ||
    detailRes.payload?.message ||
    detailRes.payload?.detail ||
    analyzerRes.payload?.message ||
    analyzerRes.payload?.detail ||
    "No template text could be resolved from templateId.";
  throw new Error(msg);
}

/* ─────────────────────────────────────────────────────────────────────────
   POST /session
   Create a session by uploading template + reference documents
───────────────────────────────────────────────────────────────────────── */
router.post(
  "/session",
  upload.fields([
    { name: "documents", maxCount: config.maxFiles },
    { name: "templateFile", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const documents    = req.files?.documents || [];
      const templateFile = req.files?.templateFile?.[0] || null;
      const templateTextFromBody = String(req.body?.templateText || "").trim();
      const templateIdFromBody = String(req.body?.templateId || req.body?.template_id || "").trim();

      if (!documents.length) {
        return res.status(400).json({
          message: "At least one reference document is required.",
        });
      }

      // Extract template text (from body paste or uploaded file)
      let templateText = templateTextFromBody;
      if (!templateText && templateFile) {
        templateText = await extractTextFromFile(templateFile);
      }
      if (!templateText && templateIdFromBody) {
        templateText = await fetchTemplateTextById(templateIdFromBody, req);
      }
      if (!templateText) {
        return res.status(400).json({
          message: "A template is required. Paste template text, upload a template file, or pass a valid templateId.",
        });
      }

      // Process all reference documents IN PARALLEL (up to 4 concurrently)
      const results = await processDocumentsParallel(documents, config.chunkSize, config.chunkOverlap);

      // Separate successes from failures
      const failed = results.filter(r => r.error);
      if (failed.length === results.length) {
        // All files failed — reject with details
        return res.status(400).json({
          message: `All documents failed to process. Errors: ${failed.map(f => `"${f.name}": ${f.error}`).join("; ")}`,
        });
      }

      // Collect chunks from successfully processed files
      const processedDocuments = [];
      const allChunks = [];

      for (const result of results) {
        allChunks.push(...result.chunkEntries);
        processedDocuments.push({
          name: result.name,
          textLength: result.textLength,
          chunks: result.chunks,
          ...(result.error ? { warning: result.error } : {}),
        });
      }

      const session = createSession({
        templateText,
        documents: processedDocuments,
        chunks: allChunks,
      });

      return res.json({
        sessionId: session.id,
        documents: processedDocuments,
        totalChunks: allChunks.length,
        templateLength: templateText.length,
      });
    } catch (error) {
      console.error("[session] error:", error);
      return res.status(500).json({ message: error.message || "Session creation failed." });
    }
  }
);

/* ─────────────────────────────────────────────────────────────────────────
   POST /session/:sessionId/message
   Generate or refine the draft
───────────────────────────────────────────────────────────────────────── */
router.post("/session/:sessionId/message", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { message }   = req.body || {};

    const session = getSession(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found. Please create a new session." });
    }

    const userMsg = String(message || "Generate the complete draft.").trim();

    // ── Choose context strategy ──────────────────────────────────────
    let contextText;
    if (isGenerationRequest(userMsg)) {
      // Full generation: send ALL document text (up to context limit)
      contextText = buildContextFromAllChunks(session.chunks, config.maxContextChars);
    } else {
      // Refinement / question: use keyword-based retrieval
      contextText = buildContextFromRetrieved(session.chunks, userMsg, config.retrievalTopK);
    }

    // ── Build previous messages for multi-turn ───────────────────────
    // Pass previous assistant HTML outputs as conversation history so
    // Claude can refine them intelligently
    const previousMessages = session.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));

    // ── Generate ─────────────────────────────────────────────────────
    const html = await generateDraftHtml({
      anthropicApiKey: config.anthropicApiKey,
      anthropicModel:  config.anthropicModel,
      templateText:    session.templateText,
      contextText,
      userMessage:     userMsg,
      previousMessages,
    });

    // ── Persist to session ────────────────────────────────────────────
    const newMessages = [
      ...session.messages,
      { role: "user",      content: userMsg, createdAt: new Date().toISOString() },
      { role: "assistant", content: html,    createdAt: new Date().toISOString() },
    ];

    updateSession(sessionId, { latestHtml: html, messages: newMessages });

    // Return citations (source document names used)
    const sources = [...new Set(session.chunks.map((c) => c.source))];

    return res.json({ html, citations: sources });
  } catch (error) {
    console.error("[message] error:", error);
    return res.status(500).json({ message: error.message || "Draft generation failed." });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   POST /session/:sessionId/message-stream
   Server-Sent Events streaming version of /message
   Frontend receives: data: {"html_chunk":"..."}\n\n  ...  data: [DONE]\n\n
───────────────────────────────────────────────────────────────────────── */
router.post("/session/:sessionId/message-stream", async (req, res) => {
  const { sessionId } = req.params;
  const { message }   = req.body || {};

  const session = getSession(sessionId);
  if (!session) {
    return res.status(404).json({ message: "Session not found." });
  }

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const done  = () => { res.write("data: [DONE]\n\n"); res.end(); };

  const userMsg = String(message || "Generate the complete draft.").trim();

  try {
    const contextText = isGenerationRequest(userMsg)
      ? buildContextFromAllChunks(session.chunks, config.maxContextChars)
      : buildContextFromRetrieved(session.chunks, userMsg, config.retrievalTopK);

    const previousMessages = session.messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: m.role, content: m.content }));

    const Anthropic = require("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey: config.anthropicApiKey });

    const { SYSTEM_PROMPT, buildUserPrompt, stripCodeFence } = require("../services/templateGenerator");

    const isFirstTurn = previousMessages.length === 0;
    const userContent = isFirstTurn
      ? buildUserPrompt({ templateText: session.templateText, contextText, userMessage: userMsg })
      : `REFINEMENT INSTRUCTION: ${userMsg}\n\nApply these changes. Output the complete updated document as clean HTML only.`;

    const msgs = [...previousMessages, { role: "user", content: userContent }];

    let fullHtml = "";

    const stream = client.messages.stream({
      model: config.anthropicModel,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      messages: msgs,
    });

    stream.on("text", (text) => {
      fullHtml += text;
      send({ html_chunk: text });
    });

    await stream.finalMessage();

    // Strip code fences and send the final clean HTML
    const cleanHtml = stripCodeFence(fullHtml.trim());

    // Persist
    const sources = [...new Set(session.chunks.map((c) => c.source))];
    const newMessages = [
      ...session.messages,
      { role: "user",      content: userMsg,   createdAt: new Date().toISOString() },
      { role: "assistant", content: cleanHtml, createdAt: new Date().toISOString() },
    ];
    updateSession(sessionId, { latestHtml: cleanHtml, messages: newMessages });

    // Send final complete HTML so frontend can replace streamed chunks
    send({ html: cleanHtml, citations: sources });
    done();
  } catch (error) {
    console.error("[message-stream] error:", error);
    send({ error: error.message || "Streaming failed." });
    done();
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   POST /session/:sessionId/export-docx
   Export the latest draft as a Word document
───────────────────────────────────────────────────────────────────────── */
router.post("/session/:sessionId/export-docx", async (req, res) => {
  try {
    const session = getSession(req.params.sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found." });
    }
    if (!session.latestHtml) {
      return res.status(400).json({
        message: "No draft generated yet. Send a message first to generate the draft.",
      });
    }

    const docxBuffer = toDocxBuffer(session.latestHtml);

    res.setHeader(
      "Content-Disposition",
      `attachment; filename="draft-${session.id}.docx"`
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    return res.send(docxBuffer);
  } catch (error) {
    console.error("[export-docx] error:", error);
    return res.status(500).json({ message: error.message || "DOCX export failed." });
  }
});

/* ─────────────────────────────────────────────────────────────────────────
   POST /api/chat-draft/upload-google-docs
   Upload generated HTML to Google Drive via drafting-service, return iframe URL.
   Body: { html, title, draft_id, existing_google_file_id?, user_id? }
───────────────────────────────────────────────────────────────────────── */
router.post("/upload-google-docs", async (req, res) => {
  const { html, title, draft_id, existing_google_file_id, user_id } = req.body || {};

  if (!html) {
    return res.status(400).json({ message: "html is required." });
  }

  const DRAFTING_SERVICE_URL =
    process.env.DRAFTING_SERVICE_URL || "http://localhost:5005";

  const docTitle = (title || `ChatDraft_${draft_id || "doc"}`).trim();

  try {
    // Build multipart/form-data for the drafting-service finish-assembled endpoint
    const { FormData, Blob } = await import("node:buffer").then(() => globalThis);
    // Use undici FormData if global not available (Node 18 has it globally)
    const form = new FormData();
    const htmlBlob = new Blob([html], { type: "text/html" });
    form.append("file", htmlBlob, `${docTitle}.html`);
    form.append("draft_id", draft_id || "");
    form.append("title", docTitle);
    form.append("user_id", String(user_id || req.headers["x-user-id"] || ""));
    form.append("existing_google_file_id", existing_google_file_id || "");
    form.append("google_import_html", html);
    form.append("google_import_filename", `${docTitle}.html`);
    form.append("google_import_mime", "text/html");

    const upstream = await fetch(
      `${DRAFTING_SERVICE_URL}/api/drafts/finish-assembled`,
      {
        method: "POST",
        body: form,
        headers: {
          "x-user-id": String(user_id || req.headers["x-user-id"] || ""),
        },
      }
    );

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      return res.status(502).json({
        message: `Drafting service error ${upstream.status}: ${errText.slice(0, 200)}`,
      });
    }

    const result = await upstream.json();
    const googleFileId =
      result.google_file_id || result.googleFileId ||
      result.file_id || result.fileId || "";
    let iframeUrl =
      result.iframe_url || result.iframeUrl || "";
    if (!iframeUrl && googleFileId) {
      iframeUrl = `https://docs.google.com/document/d/${googleFileId}/edit?embedded=true`;
    }
    const webViewLink =
      result.webViewLink || result.web_view_link ||
      (googleFileId ? `https://docs.google.com/document/d/${googleFileId}/edit` : "");

    return res.json({
      success: true,
      google_file_id: googleFileId,
      iframe_url: iframeUrl,
      web_view_link: webViewLink,
    });
  } catch (err) {
    console.error("[upload-google-docs] error:", err);
    return res.status(500).json({ message: err.message || "Upload failed." });
  }
});

module.exports = router;
