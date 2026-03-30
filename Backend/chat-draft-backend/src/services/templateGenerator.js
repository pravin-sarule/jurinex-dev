const Anthropic = require("@anthropic-ai/sdk");

/* ─────────────────────────────────────────────────────────────────────────
   SYSTEM PROMPT
   This is the core instruction set that makes the AI generate proper
   legal documents matching the template format exactly.
───────────────────────────────────────────────────────────────────────── */
const SYSTEM_PROMPT = `You are an expert legal document drafter with deep knowledge of Indian and international legal practice. Your role is to generate complete, professionally formatted legal documents.

You will always receive:
1. TEMPLATE — a reference document that defines the EXACT FORMAT, STRUCTURE, HEADINGS, NUMBERING, CLAUSE ORDER, and LAYOUT the output must follow
2. DOCUMENT_CONTEXT — text extracted from one or more reference documents containing FACTS, PARTIES, DATES, AMOUNTS, CASE NUMBERS, EVIDENCE, TERMS, and other CONTENT to populate the draft
3. USER_INSTRUCTION — specific instructions about what to generate or how to refine the document

━━━ GENERATION RULES ━━━

STRUCTURE & FORMAT
- Mirror the template EXACTLY: same section headings, same numbering scheme (1., 1.1, (a), (b), I., II., etc.), same clause order, same document layout from title to signature block
- If the template uses "WHEREAS" recitals, include them. If it uses "NOW THEREFORE", include it. Preserve every structural element
- Replicate the template's document type — petition, agreement, affidavit, notice, deed, etc.

CONTENT EXTRACTION
- Extract ALL relevant information from DOCUMENT_CONTEXT: full names, designations, addresses, court names, case numbers, dates, monetary amounts, property descriptions, facts of the case, precedents, evidence details
- Do NOT paraphrase or summarize facts — use the exact details from the documents
- Cross-reference multiple documents to build the complete picture

COMPLETENESS
- Generate the COMPLETE document from the opening title to the final signature/verification block — never truncate, never summarize midway, never write "[rest of document continues...]"
- Every section in the template MUST appear fully drafted in your output
- Include all schedules, annexures, or exhibits mentioned in the template

PLACEHOLDERS
- Where a specific piece of information is genuinely not present in any document, insert [REQUIRED: exact description of what is needed] in red — never silently omit

LEGAL LANGUAGE
- Use formal, precise legal language appropriate to the document type and jurisdiction evident in the template
- Match the register: High Court petition language differs from a rental agreement
- Use defined terms consistently throughout (once defined, always use that term)

━━━ HTML OUTPUT RULES ━━━

Output ONLY valid, clean HTML — no markdown, no code fences, no explanatory text, no preamble, no commentary outside the HTML.

Use this HTML structure for a professional legal document:

<div class="legal-document">
  <h1>DOCUMENT TITLE IN CAPS</h1>

  <!-- Court / case header table if applicable -->
  <table>...</table>

  <!-- Party block -->
  <p><strong>PARTY NAME</strong>, [designation/description]... <strong>...PETITIONER/PLAINTIFF/APPELLANT</strong></p>

  <!-- Versus -->
  <p style="text-align:center"><strong>VERSUS</strong></p>

  <!-- Numbered sections -->
  <h2>1. SECTION HEADING</h2>
  <p>...</p>

  <h3>1.1 Sub-section</h3>
  <p>...</p>

  <!-- Ordered lists for numbered clauses -->
  <ol type="1"><li>...</li></ol>
  <ol type="a"><li>...</li></ol>

  <!-- Prayer / relief section -->
  <h2>PRAYER</h2>
  <p>It is, therefore, most respectfully prayed...</p>

  <!-- Verification / signature block -->
  <hr/>
  <p>Place: ___________</p>
  <p>Date: ___________</p>
  <p style="text-align:right"><strong>ADVOCATE FOR PETITIONER</strong></p>
</div>

━━━ MULTI-TURN REFINEMENT ━━━

When the user asks to refine, modify, or improve the draft:
- Apply ONLY the requested changes — do not alter unrelated sections
- Maintain the document's structure, style, and all previously correct content
- Output the COMPLETE updated document, not just the changed section

━━━ QUALITY CHECK ━━━

Before outputting, mentally verify:
✓ Every section from the template is present
✓ All party names, dates, and case details from the documents are used
✓ The document reads as a complete, coherent legal instrument
✓ No section is left as a bare heading without content
✓ The output is valid HTML with no stray markdown`;

/* ─────────────────────────────────────────────────────────────────────────
   Build the user message
───────────────────────────────────────────────────────────────────────── */
function buildUserPrompt({ templateText, contextText, userMessage }) {
  const parts = [];

  parts.push("═══════════════════════════════════════════════════════");
  parts.push("TEMPLATE (use this EXACT format, structure and layout):");
  parts.push("═══════════════════════════════════════════════════════");
  parts.push(templateText || "(no template provided)");
  parts.push("");

  parts.push("═══════════════════════════════════════════════════════");
  parts.push("DOCUMENT_CONTEXT (extract all facts, parties, dates, details from here):");
  parts.push("═══════════════════════════════════════════════════════");
  parts.push(contextText || "(no reference documents provided)");
  parts.push("");

  parts.push("═══════════════════════════════════════════════════════");
  parts.push("USER_INSTRUCTION:");
  parts.push("═══════════════════════════════════════════════════════");
  parts.push(userMessage || "Generate the complete draft document following the template format and populating it with all details from the reference documents.");
  parts.push("");
  parts.push("Now generate the complete legal document as clean HTML only.");

  return parts.join("\n");
}

/* ─────────────────────────────────────────────────────────────────────────
   Strip any accidental markdown fences Claude might add
───────────────────────────────────────────────────────────────────────── */
function stripCodeFence(value) {
  let raw = String(value || "").trim();
  // Remove ```html ... ``` or ``` ... ```
  raw = raw.replace(/^```[a-zA-Z]*\n?/m, "").replace(/\n?```\s*$/m, "").trim();
  // If it starts with a doctype or html tag, it's clean
  return raw;
}

/* ─────────────────────────────────────────────────────────────────────────
   Main generation function
   Supports multi-turn: pass previousMessages to continue a conversation
───────────────────────────────────────────────────────────────────────── */
async function generateDraftHtml({
  anthropicApiKey,
  anthropicModel,
  templateText,
  contextText,
  userMessage,
  previousMessages = [],   // [{role:'user'|'assistant', content:string}]
}) {
  if (!anthropicApiKey) {
    return htmlFallback(templateText, contextText, userMessage);
  }

  const client = new Anthropic({ apiKey: anthropicApiKey });

  // Build the messages array for multi-turn support
  const messages = [];

  // Add previous conversation turns (for refinement)
  for (const msg of previousMessages) {
    messages.push({ role: msg.role, content: msg.content });
  }

  // Add the current user message (with full template + context for first turn,
  // or just the instruction for subsequent refinement turns)
  const isFirstTurn = previousMessages.length === 0;
  if (isFirstTurn) {
    // First generation: include full template and context
    messages.push({
      role: "user",
      content: buildUserPrompt({ templateText, contextText, userMessage }),
    });
  } else {
    // Refinement: user already has the context, just give the instruction
    messages.push({
      role: "user",
      content: [
        `REFINEMENT INSTRUCTION: ${userMessage}`,
        "",
        "Apply these changes to the draft. Output the complete updated document as clean HTML only.",
      ].join("\n"),
    });
  }

  const response = await client.messages.create({
    model: anthropicModel,
    max_tokens: 16000,   // Legal documents can be very long
    system: SYSTEM_PROMPT,
    messages,
  });

  const textParts = (response.content || [])
    .filter((part) => part.type === "text")
    .map((part) => part.text);

  return stripCodeFence(textParts.join("\n").trim());
}

/* ─────────────────────────────────────────────────────────────────────────
   Fallback when no API key is configured
───────────────────────────────────────────────────────────────────────── */
function htmlFallback(templateText, contextText, userMessage) {
  const esc = (s) =>
    String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  return `
<div class="legal-document">
  <h1>Draft Preview (API Key Not Configured)</h1>
  <p style="color:#c0392b;background:#fdf0ee;padding:10px;border-radius:6px;border:1px solid #f5c6bf">
    <strong>Note:</strong> No ANTHROPIC_API_KEY is set. Configure the API key in the backend .env file to generate actual drafts.
  </p>
  <h2>Template Received</h2>
  <pre style="white-space:pre-wrap;font-family:Georgia,serif;font-size:13px">${esc(templateText)}</pre>
  <h2>Document Context</h2>
  <pre style="white-space:pre-wrap;font-family:Georgia,serif;font-size:13px">${esc(contextText)}</pre>
  <h2>Instruction</h2>
  <p>${esc(userMessage)}</p>
</div>`;
}

module.exports = { generateDraftHtml, SYSTEM_PROMPT, buildUserPrompt, stripCodeFence };
