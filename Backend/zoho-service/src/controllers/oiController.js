// /**
//  * Office Integrator Controller
//  * 
//  * Handles all Office Integrator-related HTTP endpoints:
//  * - POST /drafting/oi/upload - Upload file, create DB record
//  * - POST /drafting/oi/session - Create editor session, return iframe URL
//  * - POST /drafting/oi/save - Manual save (export from OI, store to GCS)
//  * - POST /drafting/oi/save-callback - Webhook from Office Integrator on save
//  */
// const Busboy = require('busboy');
// const Document = require('../models/Document');
// const Draft = require('../models/Draft');
// const gcsService = require('../services/gcsService');
// const oiService = require('../services/officeIntegratorService');

// // =============================================================================
// // HELPER: Get file extension from MIME type or path
// // =============================================================================
// function getFileExtension(mimeType, gcsPath) {
//     const mime = mimeType?.toLowerCase() || '';
//     const path = gcsPath?.toLowerCase() || '';

//     // Check MIME type first
//     if (mime.includes('pdf')) return '.pdf';
//     if (mime.includes('word') || mime.includes('msword')) return '.docx';
//     if (mime.includes('sheet') || mime.includes('excel') || mime.includes('spreadsheet')) return '.xlsx';
//     if (mime.includes('presentation') || mime.includes('powerpoint')) return '.pptx';

//     // Fall back to path extension
//     if (path.endsWith('.pdf')) return '.pdf';
//     if (path.endsWith('.docx') || path.endsWith('.doc')) return '.docx';
//     if (path.endsWith('.xlsx') || path.endsWith('.xls') || path.endsWith('.csv')) return '.xlsx';
//     if (path.endsWith('.pptx') || path.endsWith('.ppt')) return '.pptx';

//     return '.docx'; // Default
// }

// // =============================================================================
// // HELPER: Get file type label for frontend
// // =============================================================================
// function getFileTypeLabel(mimeType, gcsPath) {
//     const ext = getFileExtension(mimeType, gcsPath);
//     switch (ext) {
//         case '.pdf': return 'pdf';
//         case '.docx': return 'word';
//         case '.xlsx': return 'excel';
//         case '.pptx': return 'powerpoint';
//         default: return 'word';
//     }
// }

// /**
//  * POST /drafting/oi/upload
//  * Upload file to GCS, create database record
//  */
// const upload = async (req, res, next) => {
//     const requestId = req.requestId;
//     const userId = req.user.id;
//     const userEmail = req.user.email;
//     const userName = req.user.name || req.user.email;

//     console.log(`[REQ:${requestId}] [OI Controller] Upload started for user ${userId}`);

//     const chunks = [];
//     let filename = 'untitled.docx';
//     let mimeType = 'application/octet-stream';

//     try {
//         const busboy = Busboy({ headers: req.headers });

//         await new Promise((resolve, reject) => {
//             busboy.on('file', (fieldname, file, info) => {
//                 filename = info.filename || 'untitled.docx';
//                 mimeType = info.mimeType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

//                 console.log(`[REQ:${requestId}] [OI Controller] Receiving file: ${filename} (${mimeType})`);

//                 file.on('data', (chunk) => chunks.push(chunk));
//                 file.on('end', () => console.log(`[REQ:${requestId}] [OI Controller] File stream completed`));
//             });

//             busboy.on('finish', resolve);
//             busboy.on('error', reject);

//             req.pipe(busboy);
//         });

//         const fileBuffer = Buffer.concat(chunks);
//         console.log(`[REQ:${requestId}] [OI Controller] File size: ${fileBuffer.length} bytes`);

//         if (fileBuffer.length === 0) {
//             const err = new Error('No file uploaded');
//             err.statusCode = 400;
//             throw err;
//         }

//         // 1. Upload to GCS
//         const gcsPath = gcsService.generateGcsPath(userId, filename, 'oi-originals');
//         await gcsService.uploadBuffer(fileBuffer, gcsPath, mimeType, requestId);

//         // 2. Create document record
//         const title = filename.replace(/\.[^/.]+$/, '');
//         const document = await Document.create({
//             userId,
//             title,
//             gcsPath,
//             mimeType,
//             status: 'uploaded'
//         }, requestId);

//         // 3. Create draft record
//         await Draft.upsert({
//             userId,
//             title,
//             zohoDocId: null, // Will be set when session is created
//             gcsPath,
//             status: 'uploaded'
//         }, requestId);

//         console.log(`[REQ:${requestId}] [OI Controller] ✅ Upload complete: docId=${document.id}`);

//         res.status(201).json({
//             success: true,
//             draftId: document.id,
//             title,
//             filename,
//             mimeType
//         });

//     } catch (error) {
//         console.error(`[REQ:${requestId}] [OI Controller] ❌ Upload failed: ${error.message}`);
//         next(error);
//     }
// };

// /**
//  * POST /drafting/oi/session
//  * Create Office Integrator embedded editor session (Writer/Sheet/Show) or PDF viewer
//  */
// const createSession = async (req, res, next) => {
//     const requestId = req.requestId;
//     const userId = req.user.id;
//     const userEmail = req.user.email || '';
//     const userName = req.user.name || req.user.email || `User ${userId}`;
//     const { draftId } = req.body;

//     console.log(`[REQ:${requestId}] [OI Controller] Create session for draft ${draftId} (user: ${userId})`);

//     try {
//         if (!draftId) {
//             const err = new Error('draftId is required');
//             err.statusCode = 400;
//             throw err;
//         }

//         // 1. Find document and verify ownership
//         const document = await Document.findByIdAndUser(draftId, userId, requestId);

//         if (!document) {
//             console.log(`[REQ:${requestId}] [OI Controller] Document ${draftId} not found for user ${userId}`);
//             const err = new Error('Document not found or access denied');
//             err.statusCode = 404;
//             throw err;
//         }

//         // 2. Determine file extension and editor type
//         const fileName = document.title + getFileExtension(document.mime_type, document.gcs_path);

//         // Use service helper or local logic to determine type loosely for handling null gcs_path
//         const isSheetOrShow = document.mime_type?.includes('spreadsheet') ||
//             document.mime_type?.includes('presentation') ||
//             document.mime_type?.includes('sheet') ||
//             document.mime_type?.includes('show') ||
//             document.mime_type?.includes('excel') ||
//             document.mime_type?.includes('powerpoint');

//         // Check for GCS path logic
//         let signedUrl = null;

//         if (!document.gcs_path) {
//             // If gcs_path is missing, ONLY allow if it represents a blank Sheet/Show that hasn't been saved yet
//             if (isSheetOrShow) {
//                 console.log(`[REQ:${requestId}] [FORENSIC][SESSION] gcs_path is NULL – allowed for Sheet/Show blank flow`);
//                 signedUrl = null;
//             } else {
//                 const err = new Error('Document has no file stored');
//                 err.statusCode = 400;
//                 throw err;
//             }
//         } else {
//             // Normal flow - generate signed URL
//             // ========== PDF DETECTION: Read-only viewer for PDFs ==========
//             const isPdf = document.mime_type === 'application/pdf' ||
//                 document.gcs_path?.toLowerCase().endsWith('.pdf');

//             if (isPdf) {
//                 console.log(`[REQ:${requestId}] [FORENSIC] File type detected: application/pdf → opening in PDF viewer`);
//                 // Generate signed URL for PDF viewer (longer expiry for reading)
//                 const viewerUrl = await gcsService.getSignedUrl(document.gcs_path, 120, requestId);

//                 return res.json({
//                     success: true,
//                     type: 'pdf',
//                     editor: 'pdf',
//                     viewerUrl,
//                     draftId,
//                     title: document.title,
//                     mimeType: document.mime_type,
//                     readOnly: true
//                 });
//             }

//             // Generate signed URL for the document
//             signedUrl = await gcsService.getSignedUrl(document.gcs_path, 120, requestId);
//         }

//         // 3. Use unified editor session creator
//         console.log(`[REQ:${requestId}] [FORENSIC][EDITOR] Creating session for: ${fileName} (${document.mime_type})`);

//         const result = await oiService.createEditorSession({
//             signedUrl,
//             fileName,
//             mimeType: document.mime_type,
//             draftId,
//             user: { name: userName, email: userEmail }
//         });

//         // 4. Handle response based on editor type
//         if (result.type === 'pdf') {
//             // Should verify redundant logic isn't hit here, but safe to keep
//             console.log(`[REQ:${requestId}] [FORENSIC][EDITOR] Opening in: PDF Viewer (read-only)`);
//             return res.json({
//                 success: true,
//                 type: 'pdf',
//                 editor: 'pdf',
//                 viewerUrl: result.viewerUrl,
//                 draftId,
//                 title: document.title,
//                 mimeType: document.mime_type,
//                 readOnly: true
//             });
//         }

//         // Zoho editor (Writer/Sheet/Show)
//         console.log(`[REQ:${requestId}] [FORENSIC][EDITOR] Opening in: Zoho ${result.editor}`);

//         // 5. Store zoho token (only for Zoho editors, not PDF)
//         if (result.zohoDocumentToken) {
//             console.log(`[REQ:${requestId}] [FORENSIC] Storing Zoho token: ${result.zohoDocumentToken?.substring(0, 40)}...`);
//             try {
//                 await Document.updateZohoDocId(document.id, result.zohoDocumentToken, requestId);
//                 console.log(`[REQ:${requestId}] [FORENSIC] ✅ Stored zoho_file_id`);
//             } catch (dbError) {
//                 console.error(`[REQ:${requestId}] [OI Controller] ❌ Could not store Zoho token: ${dbError.message}`);
//             }
//         }

//         console.log(`[REQ:${requestId}] [OI Controller] ✅ Session created for ${result.editor}`);

//         res.json({
//             success: true,
//             type: 'zoho',
//             editor: result.editor,
//             sessionId: result.sessionId,
//             iframeUrl: result.iframeUrl,
//             draftId,
//             title: document.title,
//             mimeType: document.mime_type
//         });

//     } catch (error) {
//         console.error(`[REQ:${requestId}] [OI Controller] ❌ Create session failed: ${error.message}`);
//         res.status(error.statusCode || 500).json({
//             success: false,
//             error: error.message || 'Failed to create editor session'
//         });
//     }
// };

// /**
//  * POST /drafting/oi/save
//  * 
//  * IMPORTANT: Zoho Office Integrator does NOT support programmatic export.
//  * Saving works via callback_settings.save_url:
//  * 1. User clicks Save in Zoho editor
//  * 2. Zoho saves and POSTs file to our /save-callback endpoint
//  * 3. Our callback receives the file and stores it
//  * 
//  * This endpoint exists for frontend compatibility but does NOT trigger export.
//  */
// const save = async (req, res, next) => {
//     const requestId = req.requestId;
//     const userId = req.user.id;
//     const { draftId } = req.body;

//     console.log(`[REQ:${requestId}] [OI Controller] Save request for draft ${draftId}`);
//     console.log(`[REQ:${requestId}] [FORENSIC] NOTE: Export API is NOT supported by Office Integrator`);
//     console.log(`[REQ:${requestId}] [FORENSIC] Saving happens via Zoho editor's Save button → callback`);

//     try {
//         if (!draftId) {
//             const err = new Error('draftId is required');
//             err.statusCode = 400;
//             throw err;
//         }

//         // Verify document exists and user has access
//         const document = await Document.findByIdAndUser(draftId, userId, requestId);

//         if (!document) {
//             const err = new Error('Document not found or access denied');
//             err.statusCode = 404;
//             throw err;
//         }

//         // Return informational response
//         // The actual save happens when Zoho calls our callback
//         res.json({
//             success: true,
//             message: 'To save your document, use the Save button in the Zoho editor. The file will be automatically saved via callback.',
//             draftId,
//             status: document.status,
//             lastSyncedAt: document.last_synced_at
//         });

//     } catch (error) {
//         console.error(`[REQ:${requestId}] [OI Controller] ❌ Save check failed: ${error.message}`);

//         const statusCode = error.statusCode || 500;
//         res.status(statusCode).json({
//             success: false,
//             error: error.message,
//             code: error.code || 'SERVER_ERROR'
//         });
//     }
// };

// /**
//  * POST /drafting/oi/save-callback
//  * 
//  * Webhook called by Zoho Office Integrator when user saves in the editor.
//  * Zoho POSTs the saved document as multipart/form-data.
//  * 
//  * Expected request:
//  * - Query param: ?draftId={id}
//  * - Body: multipart/form-data with 'content' field containing the file
//  */
// const saveCallback = async (req, res, next) => {
//     const requestId = req.requestId || `cb-${Date.now()}`;
//     const startTime = Date.now();

//     // Extract draft ID from query params
//     const draftId = req.query.draftId;

//     console.log(`[REQ:${requestId}] [FORENSIC] ====== SAVE CALLBACK ENTRY ======`);
//     console.log(`[REQ:${requestId}] [FORENSIC] draftId: ${draftId}`);
//     console.log(`[REQ:${requestId}] [FORENSIC] Content-Type: ${req.headers['content-type']}`);
//     console.log(`[REQ:${requestId}] [FORENSIC] ===================================`);

//     // Validate draftId
//     if (!draftId) {
//         console.error(`[REQ:${requestId}] [OI Callback] ❌ Missing draftId in query params`);
//         return res.status(400).json({ error: 'draftId query param is required' });
//     }

//     // Prepare to receive file via Busboy
//     const chunks = [];
//     let fileName = 'document.docx';
//     let mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
//     let fileReceived = false;

//     try {
//         const busboy = Busboy({ headers: req.headers });

//         await new Promise((resolve, reject) => {
//             busboy.on('file', (fieldname, file, info) => {
//                 fileName = info.filename || 'document.docx';
//                 mimeType = info.mimeType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

//                 console.log(`[REQ:${requestId}] [FORENSIC] File field: ${fieldname}`);
//                 console.log(`[REQ:${requestId}] [FORENSIC] File name: ${fileName}`);
//                 console.log(`[REQ:${requestId}] [FORENSIC] MIME type: ${mimeType}`);
//                 console.log(`[REQ:${requestId}] [FORENSIC] File stream started...`);

//                 file.on('data', (chunk) => {
//                     chunks.push(chunk);
//                 });

//                 file.on('end', () => {
//                     fileReceived = true;
//                     console.log(`[REQ:${requestId}] [FORENSIC] File stream completed`);
//                 });
//             });

//             busboy.on('field', (name, value) => {
//                 console.log(`[REQ:${requestId}] [FORENSIC] Field: ${name}=${value?.substring?.(0, 100) || value}`);
//             });

//             busboy.on('finish', resolve);
//             busboy.on('error', reject);

//             req.pipe(busboy);
//         });

//         // Create buffer from chunks
//         const fileBuffer = Buffer.concat(chunks);
//         const fileSize = fileBuffer.length;

//         console.log(`[REQ:${requestId}] [FORENSIC] File receive complete`);
//         console.log(`[REQ:${requestId}] [FORENSIC]   File size: ${fileSize} bytes`);

//         if (fileSize === 0) {
//             console.warn(`[REQ:${requestId}] [OI Callback] ⚠️ Received empty file`);
//             return res.status(200).json({ status: 'received', warning: 'empty file' });
//         }

//         // Find document record
//         const document = await Document.findById(draftId, requestId);
//         if (!document) {
//             console.error(`[REQ:${requestId}] [OI Callback] ❌ Document ${draftId} not found`);
//             return res.status(200).json({ status: 'received', error: 'document not found' });
//         }

//         // Upload to GCS
//         const timestamp = Date.now();
//         const gcsPath = `oi-drafts/${document.user_id}/${draftId}/${timestamp}.docx`;

//         console.log(`[REQ:${requestId}] [FORENSIC] GCS upload starting...`);
//         console.log(`[REQ:${requestId}] [FORENSIC]   Path: ${gcsPath}`);

//         await gcsService.uploadBuffer(
//             fileBuffer,
//             gcsPath,
//             mimeType,
//             requestId
//         );

//         console.log(`[REQ:${requestId}] [FORENSIC] GCS upload SUCCESS`);

//         // Update documents table
//         console.log(`[REQ:${requestId}] [FORENSIC] DB update starting...`);
//         console.log(`[REQ:${requestId}] [FORENSIC]   Table: documents`);
//         console.log(`[REQ:${requestId}] [FORENSIC]   ID: ${draftId}`);

//         await Document.updateSyncStatus(draftId, requestId);

//         console.log(`[REQ:${requestId}] [FORENSIC] DB update SUCCESS`);

//         // Upsert draft record
//         await Draft.upsert({
//             userId: document.user_id,
//             title: document.title,
//             zohoDocId: document.zoho_file_id,
//             gcsPath,
//             status: 'synced'
//         }, requestId);

//         const duration = Date.now() - startTime;

//         console.log(`[REQ:${requestId}] [FORENSIC] ====== SAVE CALLBACK COMPLETE ======`);
//         console.log(`[REQ:${requestId}] [FORENSIC]   Duration: ${duration}ms`);
//         console.log(`[REQ:${requestId}] [FORENSIC]   File size: ${fileSize} bytes`);
//         console.log(`[REQ:${requestId}] [FORENSIC]   GCS path: ${gcsPath}`);
//         console.log(`[REQ:${requestId}] [FORENSIC] =====================================`);

//         // Return plain text to Zoho (JSON causes overlay display)
//         res.status(200).send('OK');

//     } catch (error) {
//         console.error(`[REQ:${requestId}] [OI Callback] ❌ Callback processing failed: ${error.message}`);
//         console.error(`[REQ:${requestId}] [OI Callback] Stack: ${error.stack}`);

//         // Still return 200 OK to Zoho (plain text, no JSON)
//         res.status(200).send('OK');
//     }
// };



// /**
//  * ✅ NEW
//  * GET /drafting/oi/list
//  * Return documents in the exact shape frontend expects.
//  */
// const listDrafts = async (req, res) => {
//     const requestId = req.requestId;
//     const userId = req.user.id;

//     console.log(`[REQ:${requestId}] [OI Controller] List drafts for user ${userId}`);

//     try {
//         const documents = await Document.findByUser(userId, requestId);

//         // Map DB snake_case → frontend camelCase
//         const mapped = (documents || []).map(d => ({
//             id: d.id,
//             title: d.title,
//             status: d.status || 'uploaded',
//             mimeType: d.mime_type || null,
//             fileType: getFileTypeLabel(d.mime_type, d.gcs_path),
//             createdAt: d.created_at,
//             lastSyncedAt: d.last_synced_at || null
//         }));

//         res.json({
//             success: true,
//             documents: mapped
//         });
//     } catch (error) {
//         console.error(`[REQ:${requestId}] [OI Controller] ❌ List drafts failed: ${error.message}`);
//         res.status(500).json({
//             success: false,
//             error: 'Failed to list drafts'
//         });
//     }
// };


// /**
//  * ✅ NEW
//  * GET /drafting/oi/:id/download
//  * Generate signed URL for the document's current gcs_path.
//  */
// const download = async (req, res) => {
//     const requestId = req.requestId;
//     const userId = req.user.id;
//     const { id } = req.params;

//     console.log(`[REQ:${requestId}] [OI Controller] Download requested for doc ${id} (user ${userId})`);

//     try {
//         const document = await Document.findByIdAndUser(id, userId, requestId);

//         if (!document) {
//             return res.status(404).json({ success: false, error: 'Document not found' });
//         }

//         if (!document.gcs_path) {
//             return res.status(400).json({ success: false, error: 'Download not available for cloud documents. Please use editor download option.' });
//         }

//         const downloadUrl = await gcsService.getSignedUrl(document.gcs_path, 60, requestId);

//         // Use .docx by default
//         const filename = `${(document.title || 'draft').replace(/[^\w\-]+/g, '_')}.docx`;

//         res.json({
//             success: true,
//             downloadUrl,
//             filename
//         });
//     } catch (error) {
//         console.error(`[REQ:${requestId}] [OI Controller] ❌ Download failed: ${error.message}`);
//         res.status(error.statusCode || 500).json({
//             success: false,
//             error: error.message || 'Download failed'
//         });
//     }
// };




// /**
//  * POST /drafting/oi/create-blank
//  * Create a new blank document (Word, Excel, or PowerPoint)
//  */
// /**
//  * POST /drafting/oi/create-blank
//  * Create a new blank document (Word, Excel, or PowerPoint)
//  */
// const createBlank = async (req, res, next) => {
//     const requestId = req.requestId;
//     const userId = req.user.id;
//     const { type = 'doc', title: customTitle } = req.body;

//     console.log(`[REQ:${requestId}] [BLANK] Creating blank document for user ${userId}`);
//     console.log(`[REQ:${requestId}] [BLANK] Type: ${type}`);

//     try {
//         // Validate type
//         const validTypes = ['doc', 'sheet', 'show'];
//         if (!validTypes.includes(type)) {
//             const err = new Error(`Invalid document type. Must be one of: ${validTypes.join(', ')}`);
//             err.statusCode = 400;
//             throw err;
//         }

//         // Generate title with timestamp
//         const now = new Date();
//         const timestamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
//         const typeNames = { doc: 'Document', sheet: 'Sheet', show: 'Presentation' };
//         const title = customTitle || `${typeNames[type]}-${timestamp}`;

//         // Config
//         const typeConfig = {
//             doc: {
//                 extension: '.docx',
//                 mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
//             },
//             sheet: {
//                 extension: '.xlsx',
//                 mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
//             },
//             show: {
//                 extension: '.pptx',
//                 mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
//             }
//         };

//         const config = typeConfig[type];

//         let gcsPath = null;

//         // 4️⃣ Blank Document Creation – CRITICAL FIX
//         if (type === 'doc') {
//             // For Writer (doc), keep existing behavior: upload minimal DOCX
//             const minimalDocxBuffer = createMinimalDocx();
//             gcsPath = `oi-originals/${userId}/${Date.now()}-blank-${title.toLowerCase().replace(/[^a-z0-9]/g, '-')}.docx`;
//             await gcsService.uploadBuffer(minimalDocxBuffer, gcsPath, config.mimeType, requestId);
//             console.log(`[REQ:${requestId}] [FORENSIC] Blank DOCX created: Buffer uploaded to ${gcsPath}`);
//         } else {
//             // For Sheet and Show, DO NOT upload empty file (Zoho creates it internally)
//             console.log(`[REQ:${requestId}] [FORENSIC][BLANK] Skipping GCS upload for Sheet/Show – letting Zoho create blank document`);
//             gcsPath = null; // Explicitly null
//         }

//         // Insert into documents table
//         const document = await Document.create({
//             userId,
//             title,
//             gcsPath, // Passed as null for Sheet/Show
//             mimeType: config.mimeType,
//             status: 'uploaded'
//         }, requestId);

//         // Create draft record
//         await Draft.upsert({
//             userId,
//             title,
//             zohoDocId: null,
//             gcsPath,
//             status: 'uploaded'
//         }, requestId);

//         console.log(`[REQ:${requestId}] [FORENSIC] Blank ${type.toUpperCase()} created: docId=${document.id}`);

//         res.status(201).json({
//             success: true,
//             docId: document.id,
//             title,
//             mimeType: config.mimeType,
//             fileType: type === 'doc' ? 'word' : type === 'sheet' ? 'excel' : 'powerpoint'
//         });

//     } catch (error) {
//         console.error(`[REQ:${requestId}] [OI Controller] ❌ Create blank failed: ${error.message}`);
//         res.status(error.statusCode || 500).json({
//             success: false,
//             error: error.message || 'Failed to create blank document'
//         });
//     }
// };

// /**
//  * Create a minimal valid DOCX file buffer
//  */
// function createMinimalDocx() {
//     const JSZip = require('jszip');
//     const zip = new JSZip();

//     zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
//   <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
//   <Default Extension="xml" ContentType="application/xml"/>
//   <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
// </Types>`);

//     zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
//   <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
// </Relationships>`);

//     zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
//   <w:body>
//     <w:p><w:r><w:t></w:t></w:r></w:p>
//   </w:body>
// </w:document>`);

//     return zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true });
// }

// /**
//  * Create a minimal valid XLSX file buffer
//  */
// function createMinimalXlsx() {
//     const JSZip = require('jszip');
//     const zip = new JSZip();

//     zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
//   <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
//   <Default Extension="xml" ContentType="application/xml"/>
//   <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
//   <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
// </Types>`);

//     zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
//   <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
// </Relationships>`);

//     const xl = zip.folder('xl');
//     xl.file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
//   <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
// </workbook>`);

//     xl.folder('_rels').file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
//   <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
// </Relationships>`);

//     xl.folder('worksheets').file('sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
//   <sheetData></sheetData>
// </worksheet>`);

//     return zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true });
// }

// /**
//  * Create a minimal valid PPTX file buffer
//  */
// function createMinimalPptx() {
//     const JSZip = require('jszip');
//     const zip = new JSZip();

//     zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
//   <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
//   <Default Extension="xml" ContentType="application/xml"/>
//   <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
//   <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
// </Types>`);

//     zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
//   <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
// </Relationships>`);

//     const ppt = zip.folder('ppt');
//     ppt.file('presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
//   <p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
// </p:presentation>`);

//     ppt.folder('_rels').file('presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
//   <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
// </Relationships>`);

//     ppt.folder('slides').file('slide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
// <p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
//   <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
// </p:sld>`);

//     return zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true });
// }


// /**
//  * POST /drafting/oi/:id/rename
//  * Rename document
//  */
// const renameDocument = async (req, res) => {
//     const requestId = req.requestId;
//     const userId = req.user.id;
//     const { id } = req.params;
//     const { title } = req.body;

//     console.log(`[REQ:${requestId}] [OI Controller] Rename doc ${id} to "${title}"`);

//     try {
//         if (!title || typeof title !== 'string' || title.trim().length === 0) {
//             return res.status(400).json({ success: false, error: 'Valid title is required' });
//         }

//         const document = await Document.findByIdAndUser(id, userId, requestId);
//         if (!document) {
//             return res.status(404).json({ success: false, error: 'Document not found or access denied' });
//         }

//         const updatedDoc = await Document.updateTitle(id, title.trim(), requestId);

//         // Also update draft record if exists
//         await Draft.upsert({
//             userId,
//             title: updatedDoc.title,
//             zohoDocId: document.zoho_file_id,
//             gcsPath: document.gcs_path,
//             status: document.status
//         }, requestId);

//         console.log(`[REQ:${requestId}] [FORENSIC][RENAME] User ${userId} renamed doc ${id} to "${updatedDoc.title}"`);

//         res.json({
//             success: true,
//             message: 'Document renamed successfully',
//             document: {
//                 id: updatedDoc.id,
//                 title: updatedDoc.title,
//                 updatedAt: updatedDoc.updated_at
//             }
//         });
//     } catch (error) {
//         console.error(`[REQ:${requestId}] [OI Controller] ❌ Rename failed: ${error.message}`);
//         res.status(500).json({ success: false, error: 'Failed to rename document' });
//     }
// };

// /**
//  * DELETE /drafting/oi/:id/delete
//  * Delete document (soft delete from DB, hard delete from GCS if exists)
//  */
// const deleteDocument = async (req, res) => {
//     const requestId = req.requestId;
//     const userId = req.user.id;
//     const { id } = req.params;

//     console.log(`[REQ:${requestId}] [OI Controller] Delete doc ${id} requested by user ${userId}`);

//     try {
//         const document = await Document.findByIdAndUser(id, userId, requestId);
//         if (!document) {
//             return res.status(404).json({ success: false, error: 'Document not found or access denied' });
//         }

//         // Logic:
//         // 1. If GCS path exists → Delete from GCS
//         // 2. If Sheet/Show (null GCS path) → Skip GCS delete
//         // 3. Mark DB record as deleted

//         if (document.gcs_path) {
//             const deleted = await gcsService.deleteFile(document.gcs_path);
//             if (deleted) {
//                 console.log(`[REQ:${requestId}] [FORENSIC][DELETE] GCS deleted: ${document.gcs_path}`);
//             } else {
//                 console.warn(`[REQ:${requestId}] [FORENSIC][DELETE] GCS delete returned false (file missing or error)`);
//             }
//         } else {
//             console.log(`[REQ:${requestId}] [FORENSIC][DELETE] Zoho cloud document – no GCS file to delete`);
//         }

//         // Soft delete in DB
//         await Document.softDelete(id, requestId);

//         console.log(`[REQ:${requestId}] [FORENSIC][DELETE] User ${userId} deleted doc ${id}`);

//         res.json({
//             success: true,
//             message: 'Document deleted successfully',
//             id
//         });
//     } catch (error) {
//         console.error(`[REQ:${requestId}] [OI Controller] ❌ Delete failed: ${error.message}`);
//         res.status(500).json({ success: false, error: 'Failed to delete document' });
//     }
// };

// module.exports = {
//     upload,
//     createSession,
//     save,
//     saveCallback,
//     listDrafts,
//     download,
//     createBlank,
//     renameDocument, // ✅ NEW
//     deleteDocument  // ✅ NEW
// };


/**
 * Office Integrator Controller
 * 
 * Handles all Office Integrator-related HTTP endpoints:
 * - POST /drafting/oi/upload - Upload file, create DB record
 * - POST /drafting/oi/session - Create editor session, return iframe URL
 * - POST /drafting/oi/save - Manual save (export from OI, store to GCS)
 * - POST /drafting/oi/save-callback - Webhook from Office Integrator on save
 */
const Busboy = require('busboy');
const Document = require('../models/Document');
const Draft = require('../models/Draft');
const gcsService = require('../services/gcsService');
const oiService = require('../services/officeIntegratorService');

// =============================================================================
// HELPER: Get file extension from MIME type or path
// =============================================================================
function getFileExtension(mimeType, gcsPath) {
 const mime = mimeType?.toLowerCase() || '';
 const path = gcsPath?.toLowerCase() || '';

 // Check MIME type first
 if (mime.includes('pdf')) return '.pdf';
 if (mime.includes('word') || mime.includes('msword')) return '.docx';
 if (mime.includes('sheet') || mime.includes('excel') || mime.includes('spreadsheet')) return '.xlsx';
 if (mime.includes('presentation') || mime.includes('powerpoint')) return '.pptx';

 // Fall back to path extension
 if (path.endsWith('.pdf')) return '.pdf';
 if (path.endsWith('.docx') || path.endsWith('.doc')) return '.docx';
 if (path.endsWith('.xlsx') || path.endsWith('.xls') || path.endsWith('.csv')) return '.xlsx';
 if (path.endsWith('.pptx') || path.endsWith('.ppt')) return '.pptx';

 return '.docx'; // Default
}

// =============================================================================
// HELPER: Get file type label for frontend
// =============================================================================
function getFileTypeLabel(mimeType, gcsPath) {
 const ext = getFileExtension(mimeType, gcsPath);
 switch (ext) {
 case '.pdf': return 'pdf';
 case '.docx': return 'word';
 case '.xlsx': return 'excel';
 case '.pptx': return 'powerpoint';
 default: return 'word';
 }
}

/**
 * POST /drafting/oi/upload
 * Upload file to GCS, create database record
 */
const upload = async (req, res, next) => {
 const requestId = req.requestId;
 const userId = req.user.id;
 const userEmail = req.user.email;
 const userName = req.user.name || req.user.email;

 console.log(`[REQ:${requestId}] [OI Controller] Upload started for user ${userId}`);

 const chunks = [];
 let filename = 'untitled.docx';
 let mimeType = 'application/octet-stream';

 try {
 const busboy = Busboy({ headers: req.headers });

 await new Promise((resolve, reject) => {
 busboy.on('file', (fieldname, file, info) => {
 filename = info.filename || 'untitled.docx';
 mimeType = info.mimeType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

 console.log(`[REQ:${requestId}] [OI Controller] Receiving file: ${filename} (${mimeType})`);

 file.on('data', (chunk) => chunks.push(chunk));
 file.on('end', () => console.log(`[REQ:${requestId}] [OI Controller] File stream completed`));
 });

 busboy.on('finish', resolve);
 busboy.on('error', reject);

 req.pipe(busboy);
 });

 const fileBuffer = Buffer.concat(chunks);
 console.log(`[REQ:${requestId}] [OI Controller] File size: ${fileBuffer.length} bytes`);

 if (fileBuffer.length === 0) {
 const err = new Error('No file uploaded');
 err.statusCode = 400;
 throw err;
 }

 // 1. Upload to GCS
 const gcsPath = gcsService.generateGcsPath(userId, filename, 'oi-originals');
 await gcsService.uploadBuffer(fileBuffer, gcsPath, mimeType, requestId);

 // 2. Create document record
 const title = filename.replace(/\.[^/.]+$/, '');
 const document = await Document.create({
 userId,
 title,
 gcsPath,
 mimeType,
 status: 'uploaded'
 }, requestId);

 // 3. Create draft record
 await Draft.upsert({
 userId,
 title,
 zohoDocId: null, // Will be set when session is created
 gcsPath,
 status: 'uploaded'
 }, requestId);

 console.log(`[REQ:${requestId}] [OI Controller] ✅ Upload complete: docId=${document.id}`);

 res.status(201).json({
 success: true,
 draftId: document.id,
 title,
 filename,
 mimeType
 });

 } catch (error) {
 console.error(`[REQ:${requestId}] [OI Controller] ❌ Upload failed: ${error.message}`);
 next(error);
 }
};

/**
 * POST /drafting/oi/session
 * Create Office Integrator embedded editor session (Writer/Sheet/Show) or PDF viewer
 */
const createSession = async (req, res, next) => {
 const requestId = req.requestId;
 const userId = req.user.id;
 const userEmail = req.user.email || '';
 const userName = req.user.name || req.user.email || `User ${userId}`;
 const { draftId } = req.body;

 console.log(`[REQ:${requestId}] [OI Controller] Create session for draft ${draftId} (user: ${userId})`);

 try {
 if (!draftId) {
 const err = new Error('draftId is required');
 err.statusCode = 400;
 throw err;
 }

 // 1. Find document and verify ownership
 const document = await Document.findByIdAndUser(draftId, userId, requestId);

 if (!document) {
 console.log(`[REQ:${requestId}] [OI Controller] Document ${draftId} not found for user ${userId}`);
 const err = new Error('Document not found or access denied');
 err.statusCode = 404;
 throw err;
 }

 // 2. Determine file extension and editor type
 const fileName = document.title + getFileExtension(document.mime_type, document.gcs_path);

 // Use service helper or local logic to determine type loosely for handling null gcs_path
 const isSheetOrShow = document.mime_type?.includes('spreadsheet') ||
 document.mime_type?.includes('presentation') ||
 document.mime_type?.includes('sheet') ||
 document.mime_type?.includes('show') ||
 document.mime_type?.includes('excel') ||
 document.mime_type?.includes('powerpoint');

 // Check for GCS path logic
 let signedUrl = null;

 if (!document.gcs_path) {
 // If gcs_path is missing, ONLY allow if it represents a blank Sheet/Show that hasn't been saved yet
 if (isSheetOrShow) {
 console.log(`[REQ:${requestId}] [FORENSIC][SESSION] gcs_path is NULL – allowed for Sheet/Show blank flow`);
 signedUrl = null;
 } else {
 const err = new Error('Document has no file stored');
 err.statusCode = 400;
 throw err;
 }
 } else {
 // Normal flow - generate signed URL
 // ========== PDF DETECTION: Read-only viewer for PDFs ==========
 const isPdf = document.mime_type === 'application/pdf' ||
 document.gcs_path?.toLowerCase().endsWith('.pdf');

 if (isPdf) {
 console.log(`[REQ:${requestId}] [FORENSIC] File type detected: application/pdf → opening in PDF viewer`);
 // Generate signed URL for PDF viewer (longer expiry for reading)
 const viewerUrl = await gcsService.getSignedUrl(document.gcs_path, 120, requestId);

 return res.json({
 success: true,
 type: 'pdf',
 editor: 'pdf',
 viewerUrl,
 draftId,
 title: document.title,
 mimeType: document.mime_type,
 readOnly: true
 });
 }

 // Generate signed URL for the document
 signedUrl = await gcsService.getSignedUrl(document.gcs_path, 120, requestId);
 }

 // 3. Use unified editor session creator
 console.log(`[REQ:${requestId}] [FORENSIC][EDITOR] Creating session for: ${fileName} (${document.mime_type})`);

 const result = await oiService.createEditorSession({
 signedUrl,
 fileName,
 mimeType: document.mime_type,
 draftId,
 user: { name: userName, email: userEmail }
 });

 // 4. Handle response based on editor type
 if (result.type === 'pdf') {
 // Should verify redundant logic isn't hit here, but safe to keep
 console.log(`[REQ:${requestId}] [FORENSIC][EDITOR] Opening in: PDF Viewer (read-only)`);
 return res.json({
 success: true,
 type: 'pdf',
 editor: 'pdf',
 viewerUrl: result.viewerUrl,
 draftId,
 title: document.title,
 mimeType: document.mime_type,
 readOnly: true
 });
 }

 // Zoho editor (Writer/Sheet/Show)
 console.log(`[REQ:${requestId}] [FORENSIC][EDITOR] Opening in: Zoho ${result.editor}`);

 // 5. Store zoho token (only for Zoho editors, not PDF)
 if (result.zohoDocumentToken) {
 console.log(`[REQ:${requestId}] [FORENSIC] Storing Zoho token: ${result.zohoDocumentToken?.substring(0, 40)}...`);
 try {
 await Document.updateZohoDocId(document.id, result.zohoDocumentToken, requestId);
 console.log(`[REQ:${requestId}] [FORENSIC] ✅ Stored zoho_file_id`);
 } catch (dbError) {
 console.error(`[REQ:${requestId}] [OI Controller] ❌ Could not store Zoho token: ${dbError.message}`);
 }
 }

 console.log(`[REQ:${requestId}] [OI Controller] ✅ Session created for ${result.editor}`);

 res.json({
 success: true,
 type: 'zoho',
 editor: result.editor,
 sessionId: result.sessionId,
 iframeUrl: result.iframeUrl,
 draftId,
 title: document.title,
 mimeType: document.mime_type
 });

 } catch (error) {
 console.error(`[REQ:${requestId}] [OI Controller] ❌ Create session failed: ${error.message}`);
 res.status(error.statusCode || 500).json({
 success: false,
 error: error.message || 'Failed to create editor session'
 });
 }
};

/**
 * POST /drafting/oi/save
 * 
 * IMPORTANT: Zoho Office Integrator does NOT support programmatic export.
 * Saving works via callback_settings.save_url:
 * 1. User clicks Save in Zoho editor
 * 2. Zoho saves and POSTs file to our /save-callback endpoint
 * 3. Our callback receives the file and stores it
 * 
 * This endpoint exists for frontend compatibility but does NOT trigger export.
 */
const save = async (req, res, next) => {
 const requestId = req.requestId;
 const userId = req.user.id;
 const { draftId } = req.body;

 console.log(`[REQ:${requestId}] [OI Controller] Save request for draft ${draftId}`);
 console.log(`[REQ:${requestId}] [FORENSIC] NOTE: Export API is NOT supported by Office Integrator`);
 console.log(`[REQ:${requestId}] [FORENSIC] Saving happens via Zoho editor's Save button → callback`);

 try {
 if (!draftId) {
 const err = new Error('draftId is required');
 err.statusCode = 400;
 throw err;
 }

 // Verify document exists and user has access
 const document = await Document.findByIdAndUser(draftId, userId, requestId);

 if (!document) {
 const err = new Error('Document not found or access denied');
 err.statusCode = 404;
 throw err;
 }

 // Return informational response
 // The actual save happens when Zoho calls our callback
 res.json({
 success: true,
 message: 'To save your document, use the Save button in the Zoho editor. The file will be automatically saved via callback.',
 draftId,
 status: document.status,
 lastSyncedAt: document.last_synced_at
 });

 } catch (error) {
 console.error(`[REQ:${requestId}] [OI Controller] ❌ Save check failed: ${error.message}`);

 const statusCode = error.statusCode || 500;
 res.status(statusCode).json({
 success: false,
 error: error.message,
 code: error.code || 'SERVER_ERROR'
 });
 }
};

/**
 * POST /drafting/oi/save-callback
 * 
 * Webhook called by Zoho Office Integrator when user saves in the editor.
 * Zoho POSTs the saved document as multipart/form-data.
 * 
 * Expected request:
 * - Query param: ?draftId={id}
 * - Body: multipart/form-data with 'content' field containing the file
 */
const saveCallback = async (req, res, next) => {
 const requestId = req.requestId || `cb-${Date.now()}`;
 const startTime = Date.now();

 // Extract draft ID from query params
 const draftId = req.query.draftId;

 console.log(`[REQ:${requestId}] [FORENSIC] ====== SAVE CALLBACK ENTRY ======`);
 console.log(`[REQ:${requestId}] [FORENSIC] draftId: ${draftId}`);
 console.log(`[REQ:${requestId}] [FORENSIC] Content-Type: ${req.headers['content-type']}`);
 console.log(`[REQ:${requestId}] [FORENSIC] ===================================`);

 // Validate draftId
 if (!draftId) {
 console.error(`[REQ:${requestId}] [OI Callback] ❌ Missing draftId in query params`);
 return res.status(400).json({ error: 'draftId query param is required' });
 }

 // Prepare to receive file via Busboy
 const chunks = [];
 let fileName = 'document.docx';
 let mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
 let fileReceived = false;

 try {
 const busboy = Busboy({ headers: req.headers });

 await new Promise((resolve, reject) => {
 busboy.on('file', (fieldname, file, info) => {
 fileName = info.filename || 'document.docx';
 mimeType = info.mimeType || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

 console.log(`[REQ:${requestId}] [FORENSIC] File field: ${fieldname}`);
 console.log(`[REQ:${requestId}] [FORENSIC] File name: ${fileName}`);
 console.log(`[REQ:${requestId}] [FORENSIC] MIME type: ${mimeType}`);
 console.log(`[REQ:${requestId}] [FORENSIC] File stream started...`);

 file.on('data', (chunk) => {
 chunks.push(chunk);
 });

 file.on('end', () => {
 fileReceived = true;
 console.log(`[REQ:${requestId}] [FORENSIC] File stream completed`);
 });
 });

 busboy.on('field', (name, value) => {
 console.log(`[REQ:${requestId}] [FORENSIC] Field: ${name}=${value?.substring?.(0, 100) || value}`);
 });

 busboy.on('finish', resolve);
 busboy.on('error', reject);

 req.pipe(busboy);
 });

 // Create buffer from chunks
 const fileBuffer = Buffer.concat(chunks);
 const fileSize = fileBuffer.length;

 console.log(`[REQ:${requestId}] [FORENSIC] File receive complete`);
 console.log(`[REQ:${requestId}] [FORENSIC] File size: ${fileSize} bytes`);

 if (fileSize === 0) {
 console.warn(`[REQ:${requestId}] [OI Callback] ⚠️ Received empty file`);
 return res.status(200).json({ status: 'received', warning: 'empty file' });
 }

 // Find document record
 const document = await Document.findById(draftId, requestId);
 if (!document) {
 console.error(`[REQ:${requestId}] [OI Callback] ❌ Document ${draftId} not found`);
 return res.status(200).json({ status: 'received', error: 'document not found' });
 }

 // Upload to GCS
 const timestamp = Date.now();
 const gcsPath = `oi-drafts/${document.user_id}/${draftId}/${timestamp}.docx`;

 console.log(`[REQ:${requestId}] [FORENSIC] GCS upload starting...`);
 console.log(`[REQ:${requestId}] [FORENSIC] Path: ${gcsPath}`);

 await gcsService.uploadBuffer(
 fileBuffer,
 gcsPath,
 mimeType,
 requestId
 );

 console.log(`[REQ:${requestId}] [FORENSIC] GCS upload SUCCESS`);

 // Update documents table
 console.log(`[REQ:${requestId}] [FORENSIC] DB update starting...`);
 console.log(`[REQ:${requestId}] [FORENSIC] Table: documents`);
 console.log(`[REQ:${requestId}] [FORENSIC] ID: ${draftId}`);

 await Document.updateSyncStatus(draftId, requestId);

 console.log(`[REQ:${requestId}] [FORENSIC] DB update SUCCESS`);

 // Upsert draft record
 await Draft.upsert({
 userId: document.user_id,
 title: document.title,
 zohoDocId: document.zoho_file_id,
 gcsPath,
 status: 'synced'
 }, requestId);

 const duration = Date.now() - startTime;

 console.log(`[REQ:${requestId}] [FORENSIC] ====== SAVE CALLBACK COMPLETE ======`);
 console.log(`[REQ:${requestId}] [FORENSIC] Duration: ${duration}ms`);
 console.log(`[REQ:${requestId}] [FORENSIC] File size: ${fileSize} bytes`);
 console.log(`[REQ:${requestId}] [FORENSIC] GCS path: ${gcsPath}`);
 console.log(`[REQ:${requestId}] [FORENSIC] =====================================`);

 // Return plain text to Zoho (JSON causes overlay display)
 res.status(200).send('OK');

 } catch (error) {
 console.error(`[REQ:${requestId}] [OI Callback] ❌ Callback processing failed: ${error.message}`);
 console.error(`[REQ:${requestId}] [OI Callback] Stack: ${error.stack}`);

 // Still return 200 OK to Zoho (plain text, no JSON)
 res.status(200).send('OK');
 }
};



/**
 * ✅ NEW
 * GET /drafting/oi/list
 * Return documents in the exact shape frontend expects.
 */
const listDrafts = async (req, res) => {
 const requestId = req.requestId;
 const userId = req.user.id;

 console.log(`[REQ:${requestId}] [OI Controller] List drafts for user ${userId}`);

 try {
 const documents = await Document.findByUser(userId, requestId);

 // Map DB snake_case → frontend camelCase
 const mapped = (documents || []).map(d => ({
 id: d.id,
 title: d.title,
 status: d.status || 'uploaded',
 mimeType: d.mime_type || null,
 fileType: getFileTypeLabel(d.mime_type, d.gcs_path),
 createdAt: d.created_at,
 lastSyncedAt: d.last_synced_at || null
 }));

 res.json({
 success: true,
 documents: mapped
 });
 } catch (error) {
 console.error(`[REQ:${requestId}] [OI Controller] ❌ List drafts failed: ${error.message}`);
 res.status(500).json({
 success: false,
 error: 'Failed to list drafts'
 });
 }
};


/**
 * ✅ NEW
 * GET /drafting/oi/:id/download
 * Generate signed URL for the document's current gcs_path.
 */
const download = async (req, res) => {
 const requestId = req.requestId;
 const userId = req.user.id;
 const { id } = req.params;

 console.log(`[REQ:${requestId}] [OI Controller] Download requested for doc ${id} (user ${userId})`);

 try {
 const document = await Document.findByIdAndUser(id, userId, requestId);

 if (!document) {
 return res.status(404).json({ success: false, error: 'Document not found' });
 }

 if (!document.gcs_path) {
 return res.status(400).json({ success: false, error: 'Download not available for cloud documents. Please use editor download option.' });
 }

 const downloadUrl = await gcsService.getSignedUrl(document.gcs_path, 60, requestId);

 // Use .docx by default
 const filename = `${(document.title || 'draft').replace(/[^\w\-]+/g, '_')}.docx`;

 res.json({
 success: true,
 downloadUrl,
 filename
 });
 } catch (error) {
 console.error(`[REQ:${requestId}] [OI Controller] ❌ Download failed: ${error.message}`);
 res.status(error.statusCode || 500).json({
 success: false,
 error: error.message || 'Download failed'
 });
 }
};




/**
 * POST /drafting/oi/create-blank
 * Create a new blank document (Word, Excel, or PowerPoint)
 */
/**
 * POST /drafting/oi/create-blank
 * Create a new blank document (Word, Excel, or PowerPoint)
 */
const createBlank = async (req, res, next) => {
 const requestId = req.requestId;
 const userId = req.user.id;
 const { type = 'doc', title: customTitle } = req.body;

 console.log(`[REQ:${requestId}] [BLANK] Creating blank document for user ${userId}`);
 console.log(`[REQ:${requestId}] [BLANK] Type: ${type}`);

 try {
 // Validate type
 const validTypes = ['doc', 'sheet', 'show'];
 if (!validTypes.includes(type)) {
 const err = new Error(`Invalid document type. Must be one of: ${validTypes.join(', ')}`);
 err.statusCode = 400;
 throw err;
 }

 // Generate title with timestamp
 const now = new Date();
 const timestamp = now.toISOString().slice(0, 16).replace(/[-:T]/g, '');
 const typeNames = { doc: 'Document', sheet: 'Sheet', show: 'Presentation' };
 const title = customTitle || `${typeNames[type]}-${timestamp}`;

 // Config
 const typeConfig = {
 doc: {
 extension: '.docx',
 mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
 },
 sheet: {
 extension: '.xlsx',
 mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
 },
 show: {
 extension: '.pptx',
 mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
 }
 };

 const config = typeConfig[type];

 let gcsPath = null;

 // 4️⃣ Blank Document Creation – CRITICAL FIX
 if (type === 'doc') {
 // For Writer (doc), keep existing behavior: upload minimal DOCX
 const minimalDocxBuffer = createMinimalDocx();
 gcsPath = `oi-originals/${userId}/${Date.now()}-blank-${title.toLowerCase().replace(/[^a-z0-9]/g, '-')}.docx`;
 await gcsService.uploadBuffer(minimalDocxBuffer, gcsPath, config.mimeType, requestId);
 console.log(`[REQ:${requestId}] [FORENSIC] Blank DOCX created: Buffer uploaded to ${gcsPath}`);
 } else {
 // For Sheet and Show, DO NOT upload empty file (Zoho creates it internally)
 console.log(`[REQ:${requestId}] [FORENSIC][BLANK] Skipping GCS upload for Sheet/Show – letting Zoho create blank document`);
 gcsPath = null; // Explicitly null
 }

 // Insert into documents table
 const document = await Document.create({
 userId,
 title,
 gcsPath, // Passed as null for Sheet/Show
 mimeType: config.mimeType,
 status: 'uploaded'
 }, requestId);

 // Create draft record
 await Draft.upsert({
 userId,
 title,
 zohoDocId: null,
 gcsPath,
 status: 'uploaded'
 }, requestId);

 console.log(`[REQ:${requestId}] [FORENSIC] Blank ${type.toUpperCase()} created: docId=${document.id}`);

 res.status(201).json({
 success: true,
 docId: document.id,
 title,
 mimeType: config.mimeType,
 fileType: type === 'doc' ? 'word' : type === 'sheet' ? 'excel' : 'powerpoint'
 });

 } catch (error) {
 console.error(`[REQ:${requestId}] [OI Controller] ❌ Create blank failed: ${error.message}`);
 res.status(error.statusCode || 500).json({
 success: false,
 error: error.message || 'Failed to create blank document'
 });
 }
};

/**
 * Create a minimal valid DOCX file buffer
 */
function createMinimalDocx() {
 const JSZip = require('jszip');
 const zip = new JSZip();

 zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`);

 zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`);

 zip.folder('word').file('document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
 <w:body>
 <w:p><w:r><w:t></w:t></w:r></w:p>
 </w:body>
</w:document>`);

 return zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true });
}

/**
 * Create a minimal valid XLSX file buffer
 */
function createMinimalXlsx() {
 const JSZip = require('jszip');
 const zip = new JSZip();

 zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
 <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`);

 zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);

 const xl = zip.folder('xl');
 xl.file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>`);

 xl.folder('_rels').file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`);

 xl.folder('worksheets').file('sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <sheetData></sheetData>
</worksheet>`);

 return zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true });
}

/**
 * Create a minimal valid PPTX file buffer
 */
function createMinimalPptx() {
 const JSZip = require('jszip');
 const zip = new JSZip();

 zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
 <Override PartName="/ppt/slides/slide1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
</Types>`);

 zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`);

 const ppt = zip.folder('ppt');
 ppt.file('presentation.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <p:sldIdLst><p:sldId id="256" r:id="rId2"/></p:sldIdLst>
</p:presentation>`);

 ppt.folder('_rels').file('presentation.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`);

 ppt.folder('slides').file('slide1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
 <p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld>
</p:sld>`);

 return zip.generateNodeStream({ type: 'nodebuffer', streamFiles: true });
}


/**
 * POST /drafting/oi/:id/rename
 * Rename document
 */
const renameDocument = async (req, res) => {
 const requestId = req.requestId;
 const userId = req.user.id;
 const { id } = req.params;
 const { title } = req.body;

 console.log(`[REQ:${requestId}] [OI Controller] Rename doc ${id} to "${title}"`);

 try {
 if (!title || typeof title !== 'string' || title.trim().length === 0) {
 return res.status(400).json({ success: false, error: 'Valid title is required' });
 }

 // Truncate title to 100 characters to match database VARCHAR(100) constraint
 const trimmedTitle = title.trim();
 const truncatedTitle = trimmedTitle.length > 100 ? trimmedTitle.substring(0, 100) : trimmedTitle;

 if (trimmedTitle.length > 100) {
 console.log(`[REQ:${requestId}] [OI Controller] Title truncated from ${trimmedTitle.length} to 100 characters`);
 }

 const document = await Document.findByIdAndUser(id, userId, requestId);
 if (!document) {
 return res.status(404).json({ success: false, error: 'Document not found or access denied' });
 }

 const updatedDoc = await Document.updateTitle(id, truncatedTitle, requestId);

 // Also update draft record if exists
 // Ensure title is also truncated for drafts table (which may also have VARCHAR(100) constraint)
 // updatedDoc.title should already be truncated, but ensure it's exactly 100 chars max
 const draftTitle = (updatedDoc.title || truncatedTitle).substring(0, 100);
 
 // Only update draft if zoho_file_id exists (draft record exists)
 if (document.zoho_file_id) {
  try {
   await Draft.upsert({
    userId,
    title: draftTitle,
    zohoDocId: document.zoho_file_id,
    gcsPath: document.gcs_path,
    status: document.status
   }, requestId);
   console.log(`[REQ:${requestId}] [OI Controller] ✅ Draft record updated successfully`);
  } catch (draftError) {
   // Log draft update error but don't fail the rename if document update succeeded
   console.error(`[REQ:${requestId}] [OI Controller] ⚠️ Warning: Document renamed but draft update failed: ${draftError.message}`);
   console.error(`[REQ:${requestId}] [OI Controller] ⚠️ Draft error stack:`, draftError.stack);
  }
 } else {
  console.log(`[REQ:${requestId}] [OI Controller] ℹ️ Skipping draft update - no zoho_file_id found`);
 }

 console.log(`[REQ:${requestId}] [FORENSIC][RENAME] User ${userId} renamed doc ${id} to "${updatedDoc.title}"`);

 res.json({
  success: true,
  message: 'Document renamed successfully',
  document: {
   id: updatedDoc.id,
   title: updatedDoc.title,
   updatedAt: updatedDoc.updated_at
  }
 });
 } catch (error) {
 console.error(`[REQ:${requestId}] [OI Controller] ❌ Rename failed: ${error.message}`);
 console.error(`[REQ:${requestId}] [OI Controller] ❌ Error stack:`, error.stack);
 res.status(500).json({ 
  success: false, 
  error: error.message.includes('too long') 
   ? 'Document title is too long. Maximum 100 characters allowed.'
   : 'Failed to rename document',
  details: process.env.NODE_ENV === 'development' ? error.message : undefined
 });
 }
};

/**
 * DELETE /drafting/oi/:id/delete
 * Delete document (soft delete from DB, hard delete from GCS if exists)
 */
const deleteDocument = async (req, res) => {
 const requestId = req.requestId;
 const userId = req.user.id;
 const { id } = req.params;

 console.log(`[REQ:${requestId}] [OI Controller] Delete doc ${id} requested by user ${userId}`);

 try {
 const document = await Document.findByIdAndUser(id, userId, requestId);
 if (!document) {
 return res.status(404).json({ success: false, error: 'Document not found or access denied' });
 }

 // Logic:
 // 1. If GCS path exists → Delete from GCS
 // 2. If Sheet/Show (null GCS path) → Skip GCS delete
 // 3. Mark DB record as deleted

 if (document.gcs_path) {
 const deleted = await gcsService.deleteFile(document.gcs_path);
 if (deleted) {
 console.log(`[REQ:${requestId}] [FORENSIC][DELETE] GCS deleted: ${document.gcs_path}`);
 } else {
 console.warn(`[REQ:${requestId}] [FORENSIC][DELETE] GCS delete returned false (file missing or error)`);
 }
 } else {
 console.log(`[REQ:${requestId}] [FORENSIC][DELETE] Zoho cloud document – no GCS file to delete`);
 }

 // Soft delete in DB
 await Document.softDelete(id, requestId);

 console.log(`[REQ:${requestId}] [FORENSIC][DELETE] User ${userId} deleted doc ${id}`);

 res.json({
 success: true,
 message: 'Document deleted successfully',
 id
 });
 } catch (error) {
 console.error(`[REQ:${requestId}] [OI Controller] ❌ Delete failed: ${error.message}`);
 res.status(500).json({ success: false, error: 'Failed to delete document' });
 }
};

module.exports = {
 upload,
 createSession,
 save,
 saveCallback,
 listDrafts,
 download,
 createBlank,
 renameDocument, // ✅ NEW
 deleteDocument // ✅ NEW
};

