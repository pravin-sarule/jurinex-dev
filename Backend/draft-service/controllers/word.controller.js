const WordService = require('../services/word.service');
const { Document } = require('../models');

exports.exportToWord = async (req, res) => {
  try {
    const { title, content, documentId } = req.body;

    // req.user.ms_access_token is already set by requireMicrosoftAuth middleware
    if (!req.user.ms_access_token) {
      return res.status(401).json({ message: 'Microsoft account not connected' });
    }

    // Option A (BEST & SIMPLE - MVP): Simple Word Online redirect
    // Microsoft handles license verification - we don't verify licenses
    const wordOnlineUrl = WordService.getWordOnlineUrl();

    // Option B (Optional Fallback): Try to create document in OneDrive
    // If this fails, we still return Option A URL
    let oneDriveFileUrl = null;
    let wordFileId = null;

    try {
      const wordDoc = await WordService.createDocumentInOneDrive(
        req.user.ms_access_token,
        title,
        content
      );
      oneDriveFileUrl = wordDoc.webUrl;
      wordFileId = wordDoc.id;
      console.log('[word.controller] Option B succeeded: Document created in OneDrive');
    } catch (oneDriveError) {
      // Option B failed - fallback to Option A (simple redirect)
      console.warn('[word.controller] Option B failed, using Option A fallback:', oneDriveError.message);
      // Continue with Option A - still valid
    }

    // Update document if documentId provided and Option B succeeded
    // 🔐 CRITICAL: Always verify ownership (user_id matches JWT userId)
    if (documentId && wordFileId) {
      const doc = await Document.findOne({
        where: { 
          id: documentId, 
          user_id: req.userId // 🔐 CRITICAL: Verify ownership
        }
      });
      
      if (doc) {
        await doc.update({
          word_file_id: wordFileId,
          word_web_url: oneDriveFileUrl || wordOnlineUrl,
          last_synced_at: new Date()
        });
        console.log('[word.controller] Document updated with Word integration:', {
          documentId,
          userId: req.userId,
          wordFileId
        });
      } else {
        console.warn('[word.controller] Document not found or access denied:', {
          documentId,
          userId: req.userId
        });
      }
    }

    // Always return Word Online URL
    // If Option B succeeded, prefer OneDrive file URL, otherwise use simple Word Online launch
    res.json({
      message: 'Opening Word Online',
      webUrl: oneDriveFileUrl || wordOnlineUrl, // Prefer Option B URL if available, else Option A
      wordFileId: wordFileId || null, // Only present if Option B succeeded
      method: oneDriveFileUrl ? 'onedrive' : 'direct', // Indicate which method was used
      note: 'Microsoft will verify license when Word Online opens'
    });
  } catch (error) {
    console.error('Export to Word error:', error);
    res.status(500).json({ message: 'Export failed' });
  }
};

exports.syncFromWord = async (req, res) => {
  try {
    const { documentId } = req.params;
    const userId = req.userId; // From JWT token

    // req.user.ms_access_token is already set by requireMicrosoftAuth middleware
    if (!req.user.ms_access_token) {
      return res.status(401).json({ message: 'Microsoft account not connected' });
    }

    // 🔐 STEP 1: Verify ownership (user_id must match JWT userId)
    const document = await Document.findOne({
      where: {
        id: documentId,
        user_id: userId // 🔐 CRITICAL: Always verify ownership
      }
    });

    if (!document) {
      console.warn('[word.controller] Document not found or access denied:', { documentId, userId });
      return res.status(404).json({ message: 'Document not found' });
    }

    if (!document.word_file_id) {
      return res.status(404).json({ message: 'Document not linked to Word. Please export to Word first.' });
    }

    // Fetch document details and content from Word
    const wordDoc = await WordService.getDocument(
      req.user.ms_access_token,
      document.word_file_id
    );

    // Fetch the actual content from Word document
    const contentData = await WordService.fetchDocumentContent(
      req.user.ms_access_token,
      document.word_file_id
    );

    // Update document with synced content and metadata
    await document.update({
      content: contentData.content, // Update content from Word
      word_web_url: wordDoc.webUrl,
      last_synced_at: new Date()
    });

    console.log('[word.controller] Document synced from Word:', {
      documentId,
      wordFileId: document.word_file_id,
      contentLength: contentData.content?.length
    });

    res.json({
      message: 'Document synced from Word successfully',
      document: {
        ...document.toJSON(),
        content: contentData.content
      },
      syncedAt: new Date()
    });
  } catch (error) {
    console.error('[word.controller] Sync from Word error:', error);
    res.status(500).json({ 
      message: 'Sync failed',
      error: error.message 
    });
  }
};

/**
 * Re-open existing Word document in Word Online
 * Uses stored word_web_url (BEST PRACTICE - reuses session)
 */
exports.reopenWordDocument = async (req, res) => {
  try {
    const { documentId } = req.params;

    // req.user.ms_access_token is already set by requireMicrosoftAuth middleware
    if (!req.user.ms_access_token) {
      return res.status(401).json({ message: 'Microsoft account not connected' });
    }

    const document = await Document.findOne({
      where: {
        id: documentId,
        userId: req.userId
      }
    });

    if (!document) {
      return res.status(404).json({ 
        message: 'Document not found' 
      });
    }

    // ✅ BEST PRACTICE: Use stored word_web_url (reuses Microsoft session)
    // This prevents repeated logins because webUrl is tied to user + tenant + file
    if (document.word_web_url) {
      console.log('[word.controller] Using stored word_web_url for document:', documentId);
      
      // Optionally verify the file still exists and update URL if needed
      if (document.word_file_id) {
        try {
          const wordDoc = await WordService.getDocument(
            req.user.ms_access_token,
            document.word_file_id
          );
          
          // Update webUrl if it changed
          if (wordDoc.webUrl !== document.word_web_url) {
            await document.update({
              word_web_url: wordDoc.webUrl,
              last_synced_at: new Date()
            });
          }
          
          return res.json({
            message: 'Opening Word document',
            webUrl: wordDoc.webUrl || document.word_web_url, // Use latest URL
            fileId: document.word_file_id,
            name: wordDoc.name || document.title
          });
        } catch (error) {
          // If file doesn't exist, still try to use stored URL
          console.warn('[word.controller] Could not verify file, using stored URL:', error.message);
        }
      }
      
      // Return stored URL (reuses session - no login required)
      return res.json({
        message: 'Opening Word document',
        webUrl: document.word_web_url,
        fileId: document.word_file_id,
        name: document.title
      });
    }

    // If no word_web_url, document hasn't been exported to Word yet
    return res.status(404).json({ 
      message: 'This document has not been exported to Word yet. Please export it first.',
      code: 'NOT_EXPORTED'
    });
  } catch (error) {
    console.error('[word.controller] Reopen Word document error:', error);
    res.status(500).json({ 
      message: 'Failed to open Word document',
      error: error.message 
    });
  }
};
