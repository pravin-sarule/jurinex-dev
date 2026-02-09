/**
 * Modified saveAssembledDraft function
 * This should replace the existing saveAssembledDraft function in draftController.js
 * 
 * Changes:
 * - Checks for existing_google_file_id in request body
 * - If exists, updates the existing Google Doc instead of creating new one
 * - Uses Google Drive API's files.update() to replace content
 */

const saveAssembledDraft = async (req, res) => {
    try {
        const userId = parseInt(req.headers['x-user-id'] || req.user?.id);
        const { title, draft_id: agentDraftId, existing_google_file_id } = req.body;
        const file = req.file;

        if (!file) {
            return res.status(400).json({ success: false, error: 'No DOCX file provided' });
        }
        if (!userId) {
            return res.status(401).json({ success: false, error: 'User ID is required' });
        }

        console.log(`[Draft] Finalizing assembled draft for user ${userId}, agent draft: ${agentDraftId}`);

        const { getAuthorizedClient } = require('../utils/oauth2Client');
        const { google } = require('googleapis');
        const { Readable } = require('stream');

        // Get authorized client for the user
        const userOAuthClient = await getAuthorizedClient(userId);
        const drive = google.drive({ version: 'v3', auth: userOAuthClient });

        let googleFileId;
        let result;

        // Check if we should update existing file or create new one
        if (existing_google_file_id && existing_google_file_id.trim() !== '') {
            console.log(`[Draft] 🔄 UPDATING existing Google Doc: ${existing_google_file_id}`);

            try {
                // Convert buffer to stream
                const fileStream = Readable.from(file.buffer);

                // Update the existing Google Doc with new content
                const updateResponse = await drive.files.update({
                    fileId: existing_google_file_id,
                    media: {
                        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        body: fileStream
                    },
                    fields: 'id, name, mimeType, webViewLink'
                });

                googleFileId = updateResponse.data.id;
                console.log(`[Draft] ✅ Successfully UPDATED existing Google Doc: ${googleFileId}`);

                // Get the existing draft from database to preserve GCS path
                const Draft = require('../models/Draft');
                const existingDraft = await Draft.findByGoogleFileId(googleFileId);

                if (existingDraft) {
                    // Update the draft's last_synced_at
                    await Draft.update(existingDraft.id, {
                        last_synced_at: new Date(),
                        title: title || existingDraft.title
                    });

                    result = {
                        draft: {
                            id: existingDraft.id,
                            google_file_id: googleFileId,
                            gcs_path: existingDraft.gcs_path,
                            title: title || existingDraft.title
                        }
                    };
                } else {
                    // Draft not found in database, create minimal result
                    result = {
                        draft: {
                            google_file_id: googleFileId,
                            title: title || 'Assembled_Draft'
                        }
                    };
                }

            } catch (updateError) {
                console.error(`[Draft] ❌ Failed to update existing file ${existing_google_file_id}:`, updateError.message);
                console.log(`[Draft] 🔄 Falling back to creating new file`);

                // Fall back to creating new file if update fails
                const { uploadToUserDriveAsGoogleDoc } = require('../services/fileUploadService');
                result = await uploadToUserDriveAsGoogleDoc(
                    file.buffer,
                    userId,
                    `${title || 'Assembled_Draft'}.docx`,
                    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                    title,
                    userOAuthClient
                );
                googleFileId = result.draft.google_file_id;
            }

        } else {
            console.log(`[Draft] ✨ CREATING new Google Doc`);

            // Create new file (original behavior)
            const { uploadToUserDriveAsGoogleDoc } = require('../services/fileUploadService');
            result = await uploadToUserDriveAsGoogleDoc(
                file.buffer,
                userId,
                `${title || 'Assembled_Draft'}.docx`,
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                title,
                userOAuthClient
            );
            googleFileId = result.draft.google_file_id;
        }

        // Save to generated_documents table for versioning (if agentDraftId is provided)
        if (agentDraftId) {
            try {
                const pool = require('../config/db');

                // Get next version number
                const versionQuery = 'SELECT COALESCE(MAX(version), 0) + 1 as next_version FROM generated_documents WHERE draft_id = $1';
                const versionRes = await pool.query(versionQuery, [agentDraftId]);
                const nextVersion = versionRes.rows[0].next_version;

                const genDocQuery = `
          INSERT INTO generated_documents (document_id, draft_id, version, is_final, generated_at, file_size, file_name, file_path, file_type)
          VALUES (gen_random_uuid(), $1, $2, $3, NOW(), $4, $5, $6, $7)
          RETURNING *
        `;
                const genDocValues = [
                    agentDraftId,
                    nextVersion,
                    true, // mark as final for now
                    file.size,
                    `${title || 'Assembled_Draft'}.docx`,
                    result.draft.gcs_path || '',
                    'docx'
                ];

                await pool.query(genDocQuery, genDocValues);
                console.log(`[Draft] ✅ Saved to generated_documents. Version: ${nextVersion}`);
            } catch (dbError) {
                console.warn(`[Draft] ⚠️  Failed to save to generated_documents (non-critical):`, dbError.message);
            }
        }

        console.log(`[Draft] ✅ Assembled draft finished. Google File ID: ${googleFileId}`);

        res.status(200).json({
            success: true,
            message: existing_google_file_id ? 'Draft updated successfully' : 'Draft assembled and saved successfully',
            googleFileId: googleFileId,
            iframeUrl: `https://docs.google.com/document/d/${googleFileId}/edit?embedded=true`,
            draft: result.draft,
            updated: !!existing_google_file_id  // Flag to indicate if it was an update
        });

    } catch (error) {
        console.error('[Draft] Error saving assembled draft:', error);
        res.status(500).json({ success: false, error: 'Failed to save assembled draft', details: error.message });
    }
};

// Export this function
module.exports = { saveAssembledDraft };
