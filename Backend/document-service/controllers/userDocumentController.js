const pool = require('../config/db');
const { google } = require('googleapis');
const { getDriveClientWithToken } = require('../services/googleDriveService');

/**
 * Save a Google Doc reference to the database
 * POST /api/documents/save
 * Body: { fileId, name, accessToken }
 */
const saveDocument = async (req, res) => {
  try {
    const userId = req.user.id;
    const { fileId, name } = req.body;

    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' });
    }

    if (!name) {
      return res.status(400).json({ error: 'name is required' });
    }

    console.log(`[UserDocument] Saving document for user ${userId}: ${name} (${fileId})`);

    // Insert or update (upsert) the document reference
    const query = `
      INSERT INTO user_documents (user_id, google_file_id, document_name)
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, google_file_id) 
      DO UPDATE SET document_name = EXCLUDED.document_name, created_at = NOW()
      RETURNING *
    `;
    
    const { rows } = await pool.query(query, [userId, fileId, name]);
    const savedDoc = rows[0];

    console.log(`[UserDocument] Document saved successfully: ${savedDoc.id}`);

    res.status(201).json({
      success: true,
      message: 'Document saved successfully',
      document: {
        id: savedDoc.id,
        google_file_id: savedDoc.google_file_id,
        document_name: savedDoc.document_name,
        created_at: savedDoc.created_at,
        embedUrl: `https://docs.google.com/document/d/${savedDoc.google_file_id}/edit?rm=minimal`
      }
    });
  } catch (error) {
    console.error('[UserDocument] Save error:', error);
    res.status(500).json({
      error: 'Failed to save document',
      details: error.message
    });
  }
};

/**
 * Verify and optionally grant writer access to a Google Doc
 * GET /api/documents/verify-access/:fileId
 * Query: accessToken (required for Drive API calls)
 */
const verifyAccess = async (req, res) => {
  try {
    const userId = req.user.id;
    const userEmail = req.user.email;
    const { fileId } = req.params;
    const { accessToken } = req.query;

    if (!fileId) {
      return res.status(400).json({ error: 'fileId is required' });
    }

    if (!accessToken) {
      return res.status(400).json({ error: 'accessToken is required' });
    }

    if (!userEmail) {
      return res.status(400).json({ error: 'User email not available. Please ensure you are logged in with email.' });
    }

    console.log(`[UserDocument] Verifying access for user ${userId} (${userEmail}) on file ${fileId}`);

    const { drive } = getDriveClientWithToken(accessToken);

    // Check current permissions
    let hasWriterAccess = false;
    let permissionId = null;

    try {
      const permissionsResponse = await drive.permissions.list({
        fileId,
        fields: 'permissions(id, emailAddress, role, type)',
        supportsAllDrives: true
      });

      const permissions = permissionsResponse.data.permissions || [];
      console.log(`[UserDocument] Found ${permissions.length} permissions on file`);

      // Check if current user already has writer or owner access
      for (const perm of permissions) {
        if (perm.emailAddress?.toLowerCase() === userEmail.toLowerCase()) {
          if (perm.role === 'writer' || perm.role === 'owner') {
            hasWriterAccess = true;
            permissionId = perm.id;
            console.log(`[UserDocument] User already has ${perm.role} access`);
          }
          break;
        }
      }
    } catch (listError) {
      // If we can't list permissions, the user might still be able to edit
      // This can happen if user is a viewer - they can't list permissions
      console.log(`[UserDocument] Cannot list permissions: ${listError.message}`);
      
      // Try to check file metadata for capabilities
      try {
        const fileMetadata = await drive.files.get({
          fileId,
          fields: 'capabilities(canEdit)',
          supportsAllDrives: true
        });
        hasWriterAccess = fileMetadata.data.capabilities?.canEdit || false;
        console.log(`[UserDocument] User canEdit: ${hasWriterAccess}`);
      } catch (metaError) {
        console.log(`[UserDocument] Cannot check capabilities: ${metaError.message}`);
      }
    }

    // If user doesn't have writer access, try to grant it
    let accessGranted = false;
    if (!hasWriterAccess) {
      console.log(`[UserDocument] Attempting to grant writer access to ${userEmail}`);
      
      try {
        const createResponse = await drive.permissions.create({
          fileId,
          requestBody: {
            type: 'user',
            role: 'writer',
            emailAddress: userEmail
          },
          sendNotificationEmail: false,
          supportsAllDrives: true
        });

        accessGranted = true;
        hasWriterAccess = true;
        permissionId = createResponse.data.id;
        console.log(`[UserDocument] Writer access granted successfully`);
      } catch (grantError) {
        console.error(`[UserDocument] Failed to grant access: ${grantError.message}`);
        
        // Provide specific error messages
        if (grantError.code === 403) {
          return res.status(403).json({
            error: 'Cannot grant access. You may not have permission to share this file.',
            hasAccess: false,
            granted: false,
            details: grantError.message
          });
        }
        
        return res.status(500).json({
          error: 'Failed to grant access',
          hasAccess: false,
          granted: false,
          details: grantError.message
        });
      }
    }

    res.json({
      success: true,
      hasAccess: hasWriterAccess,
      granted: accessGranted,
      permissionId,
      embedUrl: `https://docs.google.com/document/d/${fileId}/edit?rm=minimal`
    });
  } catch (error) {
    console.error('[UserDocument] Verify access error:', error);
    res.status(500).json({
      error: 'Failed to verify access',
      hasAccess: false,
      granted: false,
      details: error.message
    });
  }
};

/**
 * Get all documents for the current user
 * GET /api/documents
 */
const getDocuments = async (req, res) => {
  try {
    const userId = req.user.id;

    const query = `
      SELECT id, google_file_id, document_name, created_at
      FROM user_documents
      WHERE user_id = $1
      ORDER BY created_at DESC
    `;
    
    const { rows } = await pool.query(query, [userId]);

    res.json({
      success: true,
      documents: rows.map(doc => ({
        ...doc,
        embedUrl: `https://docs.google.com/document/d/${doc.google_file_id}/edit?rm=minimal`
      }))
    });
  } catch (error) {
    console.error('[UserDocument] Get documents error:', error);
    res.status(500).json({
      error: 'Failed to get documents',
      details: error.message
    });
  }
};

module.exports = {
  saveDocument,
  verifyAccess,
  getDocuments
};
