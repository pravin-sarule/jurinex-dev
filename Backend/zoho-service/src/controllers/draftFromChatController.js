/**
 * Draft From Chat Controller
 * 
 * Handles creating Zoho documents from AI chat responses.
 * POST /drafting/oi/from-chat
 * 
 * Uses Zoho Office Integrator sessions (NOT manual file generation).
 */
const Document = require('../models/Document');
const Draft = require('../models/Draft');
const gcsService = require('../services/gcsService');
const oiService = require('../services/officeIntegratorService');

// =============================================================================
// HELPER: Detect content type from chat content
// =============================================================================
function classifyContent(content) {
    if (!content || typeof content !== 'string') {
        return 'text';
    }

    // Simple table detection: look for markdown table patterns or HTML tables
    const hasTable = /\|.*\|.*\|/m.test(content) ||
        /<table[\s\S]*<\/table>/i.test(content) ||
        /^\s*[\-\|]+\s*$/m.test(content);

    // Check if content has substantial text (more than just whitespace and table)
    const textContent = content
        .replace(/<table[\s\S]*<\/table>/gi, '')
        .replace(/\|[^\n]*\|/g, '')
        .replace(/^\s*[\-\|]+\s*$/gm, '')
        .trim();

    const hasText = textContent.length > 50;

    if (hasTable && hasText) {
        return 'mixed'; // Both text and table → Writer (tables embedded)
    } else if (hasTable && !hasText) {
        return 'table'; // Only table → Sheet
    } else {
        return 'text'; // Only text → Writer
    }
}

// =============================================================================
// HELPER: Convert markdown table to CSV for Zoho Sheet
// =============================================================================
function markdownTableToCSV(markdown) {
    const lines = markdown
        .split('\n')
        .filter(line => line.includes('|') && !line.match(/^\s*[\-\|]+\s*$/));

    const rows = lines.map(line =>
        line
            .split('|')
            .map(cell => cell.trim())
            .filter(cell => cell.length > 0)
    );

    return rows.map(row => row.join(',')).join('\n');
}









// =============================================================================
// HELPER: Convert Chat JSON to Readable Legal Document Format
// =============================================================================
function formatChatJsonToDocument(rawContent) {
    let parsed;

    try {
        // Remove ```json fences if present
        const cleaned = rawContent
            .replace(/```json/gi, '')
            .replace(/```/g, '')
            .trim();

        parsed = JSON.parse(cleaned);
    } catch (err) {
        console.log('[FROM CHAT] Content is not valid JSON, sending as plain text');
        return rawContent;
    }

    const template = parsed?.schemas?.output_summary_template;
    if (!template) {
        console.log('[FROM CHAT] JSON does not match expected schema, sending raw text');
        return rawContent;
    }

    const metadata = template.metadata || {};
    const sections = template.generated_sections || {};

    let output = '';

    // ===== HEADER =====
    if (metadata.document_title) {
        output += `${metadata.document_title}\n`;
        output += `${'='.repeat(metadata.document_title.length)}\n`;
    }

    if (metadata.case_title) {
        output += `Case: ${metadata.case_title}\n`;
    }

    if (metadata.date) {
        output += `Date: ${metadata.date}\n`;
    }

    if (metadata.prepared_by) {
        output += `Prepared by: ${metadata.prepared_by}\n`;
    }

    output += `\n------------------------------------------------------------\n\n`;

    // ===== SECTIONS =====
    for (const [key, section] of Object.entries(sections)) {
        const title = key
            .replace(/_/g, ' ')
            .replace(/\b\d+\b/g, '') // remove numeric keys
            .trim()
            .toUpperCase();

        output += `${title}\n`;
        output += `${'-'.repeat(title.length)}\n`;

        if (section.generated_text) {
            output += `${section.generated_text}\n\n`;
        }
    }

    return output;
}






// =============================================================================
// POST /drafting/oi/from-chat
// Create Zoho editor session from chat content
// =============================================================================
const createFromChat = async (req, res, next) => {
    const requestId = req.requestId || `fc-${Date.now()}`;
    const userId = req.user?.id;
    const userName = req.user?.name || req.user?.email || `User ${userId}`;
    const userEmail = req.user?.email || '';
    const { content, chatMessageId } = req.body;

    console.log(`[FROM CHAT] [REQ:${requestId}] Received request`);
    console.log(`[FROM CHAT] [REQ:${requestId}] userId=${userId}, chatMessageId=${chatMessageId}`);

    try {
        // Validate required fields
        if (!userId) {
            console.log(`[FROM CHAT] [REQ:${requestId}] ❌ Missing userId`);
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        if (!content) {
            console.log(`[FROM CHAT] [REQ:${requestId}] ❌ Missing content`);
            return res.status(400).json({ success: false, error: 'content is required' });
        }

        if (!chatMessageId) {
            console.log(`[FROM CHAT] [REQ:${requestId}] ❌ Missing chatMessageId`);
            return res.status(400).json({ success: false, error: 'chatMessageId is required' });
        }

        // Classify content
        const contentType = classifyContent(content);
        console.log(`[FROM CHAT] [REQ:${requestId}] Content classified as: ${contentType}`);

        // Determine editor type based on content classification
        // Mixed text+tables MUST open in Writer (tables embedded inside Writer doc)
        const editorType = contentType === 'table' ? 'sheet' : 'writer';
        const isSheet = editorType === 'sheet';

        // Set file config
        const fileConfig = isSheet ? {
            extension: '.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        } : {
            extension: '.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
        };

        // Generate title
        const title = `Chat Edit - ${chatMessageId}`;
        const fileName = `${title}${fileConfig.extension}`;

        // Create content buffer - convert markdown table to CSV for Sheet
        let contentBuffer;

        if (editorType === 'sheet') {
            console.log(`[FROM CHAT] [REQ:${requestId}] Converting markdown table to CSV for Zoho Sheet`);
            const csvContent = markdownTableToCSV(content);
            contentBuffer = Buffer.from(csvContent, 'utf-8');
        } else {
            // contentBuffer = Buffer.from(content, 'utf-8');
            console.log(`[FROM CHAT] [REQ:${requestId}] Formatting JSON content for Zoho Writer`);
const formattedText = formatChatJsonToDocument(content);
contentBuffer = Buffer.from(formattedText, 'utf-8');

        }

        const gcsPath = gcsService.generateGcsPath(userId, fileName, 'oi-chat-drafts');

        console.log(`[FROM CHAT] [REQ:${requestId}] Uploading content to GCS: ${gcsPath}`);
        await gcsService.uploadBuffer(contentBuffer, gcsPath, fileConfig.mimeType, requestId);
        console.log(`[FROM CHAT] [REQ:${requestId}] GCS upload complete`);

        // Generate signed URL for Zoho
        console.log(`[FROM CHAT] [REQ:${requestId}] Generating signed URL...`);
        const signedUrl = await gcsService.getSignedUrl(gcsPath, 120, requestId);
        console.log(`[FROM CHAT] [REQ:${requestId}] Signed URL generated`);

        // Create document record first (needed for draftId in Zoho callback)
        console.log(`[FROM CHAT] [REQ:${requestId}] Creating document record...`);
        const document = await Document.create({
            userId,
            title,
            gcsPath,
            mimeType: fileConfig.mimeType,
            status: 'uploaded'
        }, requestId);

        const draftId = document.id;
        console.log(`[FROM CHAT] [REQ:${requestId}] Document created with ID: ${draftId}`);

        // Create draft record with source tracking
        await Draft.upsert({
            userId,
            title,
            zohoDocId: null, // Will be updated after Zoho session
            gcsPath,
            status: 'uploaded',
            source: 'chat',
            source_id: chatMessageId
        }, requestId);
        console.log(`[FROM CHAT] [REQ:${requestId}] Draft record created`);

        // Create Zoho editor session
        console.log(`[FROM CHAT] [REQ:${requestId}] Creating Zoho ${editorType} session...`);
        const session = await oiService.createEditorSession({
            signedUrl,
            fileName,
            mimeType: fileConfig.mimeType,
            draftId,
            user: { name: userName, email: userEmail }
        });

        console.log(`[FROM CHAT] [REQ:${requestId}] ✅ Zoho session created: editorType=${session.editor}`);
        console.log(`[FROM CHAT] [REQ:${requestId}] iframeUrl: ${session.iframeUrl?.substring(0, 50)}...`);

        // Update document with Zoho token if available
        if (session.zohoDocumentToken) {
            try {
                await Document.updateZohoDocId(draftId, session.zohoDocumentToken, requestId);
                console.log(`[FROM CHAT] [REQ:${requestId}] Zoho token stored in document`);
            } catch (tokenErr) {
                console.error(`[FROM CHAT] [REQ:${requestId}] ⚠️ Could not store Zoho token: ${tokenErr.message}`);
                // Non-fatal, continue
            }
        }

        res.status(201).json({
            success: true,
            draftId,
            editorType: session.editor,
            editorUrl: session.iframeUrl,
            title
        });

    } catch (error) {
        console.error(`[FROM CHAT] [REQ:${requestId}] ❌ Error: ${error.message}`);
        console.error(`[FROM CHAT] [REQ:${requestId}] Stack: ${error.stack}`);

        res.status(error.statusCode || 500).json({
            success: false,
            error: error.message || 'Failed to create draft from chat'
        });
    }
};

module.exports = {
    createFromChat
};
