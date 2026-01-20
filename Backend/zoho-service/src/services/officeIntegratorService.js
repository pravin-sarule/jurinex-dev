/**
 * Zoho Office Integrator Service
 * 
 * Supports multiple editors:
 * - Writer (DOCX) - POST https://api.office-integrator.in/writer/officeapi/v1/document
 * - Sheet (XLSX)  - POST https://api.office-integrator.in/sheet/officeapi/v1/spreadsheet
 * - Show (PPTX)   - POST https://api.office-integrator.in/show/officeapi/v1/presentation
 */
const axios = require('axios');
const FormData = require('form-data');

// =============================================================================
// HELPER: Extract Zoho Document Token
// =============================================================================
function extractZohoDocumentToken(documentUrl) {
    if (!documentUrl) {
        console.warn("[FORENSIC] extractZohoDocumentToken: document_url is empty/null");
        return null;
    }

    const patterns = [
        /\/open\/([^\/\?]+)/,           // .../open/{TOKEN}
        /\/documents\/([^\/\?]+)/,      // .../documents/{TOKEN}/...
        /\/spreadsheets\/([^\/\?]+)/,   // .../spreadsheets/{TOKEN}/...
        /\/presentations\/([^\/\?]+)/   // .../presentations/{TOKEN}/...
    ];

    for (const pattern of patterns) {
        const match = documentUrl.match(pattern);
        if (match && match[1]) {
            console.log(`[FORENSIC] extractZohoDocumentToken: Found token using pattern ${pattern}`);
            return match[1];
        }
    }

    console.warn("[FORENSIC] extractZohoDocumentToken: No pattern matched for URL:", documentUrl);
    return null;
}

// =============================================================================
// HELPER: Resolve Editor Type from MIME type or filename
// =============================================================================
function resolveEditorType(mimeType, filename) {
    const mime = mimeType?.toLowerCase() || '';
    const file = filename?.toLowerCase() || '';

    // PDF
    if (mime.includes('pdf') || file.endsWith('.pdf')) {
        return 'pdf';
    }

    // Word
    if (mime.includes('word') || mime.includes('msword') ||
        file.endsWith('.doc') || file.endsWith('.docx')) {
        return 'writer';
    }

    // Excel
    if (mime.includes('sheet') || mime.includes('excel') || mime.includes('spreadsheet') ||
        file.endsWith('.xls') || file.endsWith('.xlsx') || file.endsWith('.csv')) {
        return 'sheet';
    }

    // PowerPoint
    if (mime.includes('presentation') || mime.includes('powerpoint') ||
        file.endsWith('.ppt') || file.endsWith('.pptx')) {
        return 'show';
    }

    return 'unknown';
}

// =============================================================================
// WRITER SESSION - For DOCX files
// =============================================================================
async function createWriterSession({ signedUrl, fileName, draftId }) {
    const endpoint = "https://api.office-integrator.in/writer/officeapi/v1/document";

    const formData = new FormData();
    formData.append('apikey', process.env.ZOHO_OI_API_KEY);
    formData.append('permissions', JSON.stringify({
        "document.export": true,
        "document.print": true,
        "document.edit": true,
        "review.changes.resolve": false,
        "review.comment": true,
        "collab.chat": true
    }));
    formData.append('editor_settings', JSON.stringify({
        "unit": "in",
        "language": "en",
        "view": "pageview"
    }));
    formData.append('callback_settings', JSON.stringify({
        "save_format": "docx",
        "save_url": `${process.env.PUBLIC_BASE_URL}/drafting/oi/save-callback?draftId=${draftId}`,
        "context_info": "Draft save callback"
    }));
    formData.append('document_info', JSON.stringify({
        "document_name": fileName,
        "document_id": String(draftId)
    }));
    formData.append('url', signedUrl);

    console.log("[ZOHO][WRITER] Creating session for:", fileName);

    try {
        const response = await axios.post(endpoint, formData, {
            headers: { ...formData.getHeaders() },
            maxBodyLength: Infinity,
            validateStatus: () => true,
            timeout: 30000
        });

        if (response.status !== 200) {
            console.error("[ZOHO][WRITER] Session failed:", response.data);
            const err = new Error(`Zoho Writer error (${response.status}): ${JSON.stringify(response.data)}`);
            err.statusCode = response.status;
            throw err;
        }

        const zohoToken = extractZohoDocumentToken(response.data.document_url);
        console.log("[ZOHO][WRITER] Session created. Token:", zohoToken?.substring(0, 40) + "...");

        return {
            type: 'zoho',
            editor: 'writer',
            iframeUrl: response.data.document_url,
            sessionId: response.data.session_id,
            zohoDocumentToken: zohoToken,
            documentId: response.data.document_id
        };
    } catch (error) {
        console.error("[ZOHO][WRITER] Session failed:", error.message);
        throw error;
    }
}

// =============================================================================
// SHEET SESSION - For XLSX/CSV files
// =============================================================================
async function createSheetSession({ signedUrl, fileName, draftId, user }) {
    const endpoint = "https://api.office-integrator.in/sheet/officeapi/v1/spreadsheet";

    // 1️⃣ Zoho Sheet – Fix Permissions
    const permissions = {
        // "document.edit": true,
        // "document.export": true,
        // "document.print": true
    };

    // const permissions = {
    //     "sheet.edit": true
    // };
    console.log("[FORENSIC][ZOHO][SHEET] Permissions payload:", permissions);

    const formData = new FormData();
    formData.append('apikey', process.env.ZOHO_OI_API_KEY);
    formData.append('permissions', JSON.stringify(permissions));
    formData.append('editor_settings', JSON.stringify({
        "language": "en"
    }));
    formData.append('callback_settings', JSON.stringify({
        "save_format": "xlsx",
        "save_url": `${process.env.PUBLIC_BASE_URL}/drafting/oi/save-callback?draftId=${draftId}`,
        "context_info": "Sheet save callback"
    }));
    formData.append('document_info', JSON.stringify({
        "document_name": fileName,
        "document_id": String(draftId)
    }));
    if (user) {
        formData.append('user_info', JSON.stringify({
            "display_name": user.name || user.email || 'User'
        }));
    }

    // Only append URL if it exists (skip for blank document flow)
    if (signedUrl) {
        formData.append('url', signedUrl);
    }

    console.log("[ZOHO][SHEET] Creating session for:", fileName);

    try {
        const response = await axios.post(endpoint, formData, {
            headers: { ...formData.getHeaders() },
            maxBodyLength: Infinity,
            validateStatus: () => true,
            timeout: 30000
        });

        if (response.status !== 200) {
            console.error("[FORENSIC][ZOHO][SHEET] Session failed:", response.data);
            const err = new Error(`Zoho Sheet error (${response.status}): ${JSON.stringify(response.data)}`);
            err.statusCode = response.status;
            throw err;
        }

        const zohoToken = extractZohoDocumentToken(response.data.document_url);
        console.log("[ZOHO][SHEET] Session created. Token:", zohoToken?.substring(0, 40) + "...");

        return {
            type: 'zoho',
            editor: 'sheet',
            iframeUrl: response.data.document_url,
            sessionId: response.data.session_id,
            zohoDocumentToken: zohoToken,
            documentId: response.data.document_id
        };
    } catch (error) {
        console.error("[FORENSIC][ZOHO][SHEET] Session failed:", error.response?.data || error.message);
        throw error;
    }
}

// =============================================================================
// SHOW SESSION - For PPTX files
// =============================================================================
async function createShowSession({ signedUrl, fileName, draftId, user }) {
    const endpoint = "https://api.office-integrator.in/show/officeapi/v1/presentation";

    // 2️⃣ Zoho Show – Fix Permissions
    // const permissions = {
    //     "show.edit": true
    // };
    const permissions = {
        "document.edit": true,
        "document.export": true,
        "document.print": true
    };

    console.log("[FORENSIC][ZOHO][SHOW] Permissions payload:", permissions);

    const formData = new FormData();
    formData.append('apikey', process.env.ZOHO_OI_API_KEY);
    formData.append('permissions', JSON.stringify(permissions));
    formData.append('editor_settings', JSON.stringify({
        "language": "en"
    }));
    formData.append('callback_settings', JSON.stringify({
        "save_format": "pptx",
        "save_url": `${process.env.PUBLIC_BASE_URL}/drafting/oi/save-callback?draftId=${draftId}`,
        "context_info": "Show save callback"
    }));
    formData.append('document_info', JSON.stringify({
        "document_name": fileName,
        "document_id": String(draftId)
    }));
    if (user) {
        formData.append('user_info', JSON.stringify({
            "display_name": user.name || user.email || 'User'
        }));
    }

    // Only append URL if it exists (skip for blank document flow)
    if (signedUrl) {
        formData.append('url', signedUrl);
    }

    console.log("[ZOHO][SHOW] Creating session for:", fileName);

    try {
        const response = await axios.post(endpoint, formData, {
            headers: { ...formData.getHeaders() },
            maxBodyLength: Infinity,
            validateStatus: () => true,
            timeout: 30000
        });

        if (response.status !== 200) {
            console.error("[FORENSIC][ZOHO][SHOW] Session failed:", response.data);
            const err = new Error(`Zoho Show error (${response.status}): ${JSON.stringify(response.data)}`);
            err.statusCode = response.status;
            throw err;
        }

        const zohoToken = extractZohoDocumentToken(response.data.document_url);
        console.log("[ZOHO][SHOW] Session created. Token:", zohoToken?.substring(0, 40) + "...");

        return {
            type: 'zoho',
            editor: 'show',
            iframeUrl: response.data.document_url,
            sessionId: response.data.session_id,
            zohoDocumentToken: zohoToken,
            documentId: response.data.document_id
        };
    } catch (error) {
        console.error("[FORENSIC][ZOHO][SHOW] Session failed:", error.response?.data || error.message);
        throw error;
    }
}

// =============================================================================
// UNIFIED SESSION CREATOR - Routes to correct editor
// =============================================================================
async function createEditorSession({ signedUrl, fileName, mimeType, draftId, user }) {
    const editorType = resolveEditorType(mimeType, fileName);

    console.log(`[FORENSIC][EDITOR] Type resolved: ${editorType} (mime: ${mimeType}, file: ${fileName})`);

    switch (editorType) {
        case 'writer':
            console.log("[FORENSIC][EDITOR] Opening in: Zoho Writer");
            return await createWriterSession({ signedUrl, fileName, draftId });

        case 'sheet':
            console.log("[FORENSIC][EDITOR] Opening in: Zoho Sheet");
            return await createSheetSession({ signedUrl, fileName, draftId, user });

        case 'show':
            console.log("[FORENSIC][EDITOR] Opening in: Zoho Show");
            return await createShowSession({ signedUrl, fileName, draftId, user });

        case 'pdf':
            console.log("[FORENSIC][EDITOR] Opening in: PDF Viewer (read-only)");
            return {
                type: 'pdf',
                editor: 'pdf',
                viewerUrl: signedUrl,
                readOnly: true
            };

        default:
            console.error("[FORENSIC][EDITOR] Unsupported file type:", editorType);
            const err = new Error('This file type is not supported for editing.');
            err.statusCode = 400;
            throw err;
    }
}

// =============================================================================
// Legacy export for backward compatibility
// =============================================================================
const createSession = createWriterSession;

// =============================================================================
// NOTE: Zoho does NOT support programmatic export API
// Saving works via save_url callback where Zoho POSTs the file
// =============================================================================

module.exports = {
    createSession,           // Legacy (backward compatible)
    createWriterSession,
    createSheetSession,
    createShowSession,
    createEditorSession,     // Unified
    resolveEditorType
};

