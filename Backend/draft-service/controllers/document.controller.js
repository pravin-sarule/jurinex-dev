const { Document } = require('../models');
const { Op } = require('sequelize') || {}; // For SQL operators

/**
 * Get all documents for the current user
 * ✅ SECURITY: Only returns documents where user_id matches JWT userId
 */
exports.getDocuments = async (req, res) => {
  try {
    const userId = req.userId; // From JWT token (authenticateToken middleware)
    
    console.log('[document.controller] Getting documents for user:', userId);

    const documents = await Document.findAll({
      where: { user_id: userId }, // 🔐 CRITICAL: Always filter by user_id
      order: [['updated_at', 'DESC']]
    });

    // Format documents to include Word integration status
    const formattedDocuments = documents.map(doc => ({
      id: doc.id,
      title: doc.title,
      content: doc.content,
      user_id: doc.user_id,
      word_file_id: doc.word_file_id,
      word_web_url: doc.word_web_url,
      last_synced_at: doc.last_synced_at,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
      // Helper fields for frontend
      hasWordIntegration: !!doc.word_file_id,
      canOpenInWord: !!doc.word_web_url,
      lastSynced: doc.last_synced_at ? new Date(doc.last_synced_at).toISOString() : null
    }));

    console.log('[document.controller] Found documents:', formattedDocuments.length);

    res.json({ 
      documents: formattedDocuments,
      count: formattedDocuments.length,
      wordLinkedCount: formattedDocuments.filter(d => d.hasWordIntegration).length
    });
  } catch (error) {
    console.error('[document.controller] Get documents error:', error);
    res.status(500).json({ message: 'Error fetching documents' });
  }
};

/**
 * Get only Word-linked documents for the current user
 * ✅ SECURITY: Only returns documents where user_id matches AND word_file_id is not null
 */
exports.getWordDocuments = async (req, res) => {
  try {
    const userId = req.userId; // From JWT token
    
    console.log('[document.controller] Getting Word-linked documents for user:', userId);

    // Use Sequelize-style or raw SQL - handle both cases
    const whereClause = {
      user_id: userId,
      word_file_id: { [Op.ne]: null } // Not null
    };

    const documents = await Document.findAll({
      where: whereClause,
      order: [['updated_at', 'DESC']],
      attributes: [
        'id',
        'title',
        'word_file_id',
        'word_web_url',
        'last_synced_at',
        'created_at',
        'updated_at'
      ]
    });

    console.log('[document.controller] Found Word-linked documents:', documents.length);

    res.json({ 
      documents: documents.map(doc => ({
        id: doc.id,
        title: doc.title,
        word_file_id: doc.word_file_id,
        word_web_url: doc.word_web_url,
        last_synced_at: doc.last_synced_at,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
        hasWordIntegration: true,
        canOpenInWord: !!doc.word_web_url
      })),
      count: documents.length
    });
  } catch (error) {
    console.error('[document.controller] Get Word documents error:', error);
    // Fallback to raw SQL if Sequelize operators don't work
    try {
      const pool = require('../config/db');
      const result = await pool.query(
        `SELECT id, title, word_file_id, word_web_url, last_synced_at, created_at, updated_at 
         FROM word_documents 
         WHERE user_id = $1 AND word_file_id IS NOT NULL 
         ORDER BY updated_at DESC`,
        [userId]
      );
      
      res.json({ 
        documents: result.rows,
        count: result.rows.length
      });
    } catch (sqlError) {
      console.error('[document.controller] SQL fallback error:', sqlError);
      res.status(500).json({ message: 'Error fetching Word documents' });
    }
  }
};

/**
 * Get a single document by ID
 * ✅ SECURITY: Verifies ownership - only returns if user_id matches
 */
exports.getDocument = async (req, res) => {
  try {
    const userId = req.userId; // From JWT token
    const documentId = req.params.id;
    
    console.log('[document.controller] Getting document:', { documentId, userId });

    const document = await Document.findOne({
      where: { 
        id: documentId,
        user_id: userId // 🔐 CRITICAL: Always verify ownership
      }
    });

    if (!document) {
      console.warn('[document.controller] Document not found or access denied:', { documentId, userId });
      return res.status(404).json({ message: 'Document not found' });
    }

    // Format response with Word integration status
    // Document is a plain object from database, not a Sequelize model instance
    const formattedDoc = {
      ...document, // Spread the plain object
      hasWordIntegration: !!document.word_file_id,
      canOpenInWord: !!document.word_web_url
    };

    res.json({ document: formattedDoc });
  } catch (error) {
    console.error('[document.controller] Get document error:', error);
    res.status(500).json({ message: 'Error fetching document' });
  }
};

/**
 * Create a new document
 * ✅ SECURITY: Always sets user_id from JWT token
 */
exports.createDocument = async (req, res) => {
  try {
    const { title, content = '' } = req.body;
    const userId = req.userId; // From JWT token

    if (!title) {
      return res.status(400).json({ message: 'Title is required' });
    }

    console.log('[document.controller] Creating document for user:', userId);

    // 🔐 CRITICAL: Always set user_id from JWT token
    const document = await Document.create({
      title,
      content,
      userId: userId // Model will map to user_id in database
    });

    res.status(201).json({ 
      message: 'Document created',
      document 
    });
  } catch (error) {
    console.error('[document.controller] Create document error:', error);
    res.status(500).json({ message: 'Error creating document' });
  }
};

/**
 * Update a document
 * ✅ SECURITY: Verifies ownership before allowing update
 */
exports.updateDocument = async (req, res) => {
  try {
    const userId = req.userId; // From JWT token
    const documentId = req.params.id;
    const { title, content } = req.body;

    console.log('[document.controller] Updating document:', { documentId, userId });

    const document = await Document.findOne({
      where: {
        id: documentId,
        user_id: userId // 🔐 CRITICAL: Always verify ownership
      }
    });

    if (!document) {
      console.warn('[document.controller] Document not found or access denied:', { documentId, userId });
      return res.status(404).json({ message: 'Document not found' });
    }

    await document.update({ title, content });

    res.json({ 
      message: 'Document updated',
      document 
    });
  } catch (error) {
    console.error('[document.controller] Update document error:', error);
    res.status(500).json({ message: 'Error updating document' });
  }
};

/**
 * Delete a document
 * ✅ SECURITY: Verifies ownership before allowing deletion
 */
exports.deleteDocument = async (req, res) => {
  try {
    const userId = req.userId; // From JWT token
    const documentId = req.params.id;

    console.log('[document.controller] Deleting document:', { documentId, userId });

    const document = await Document.findOne({
      where: {
        id: documentId,
        user_id: userId // 🔐 CRITICAL: Always verify ownership
      }
    });

    if (!document) {
      console.warn('[document.controller] Document not found or access denied:', { documentId, userId });
      return res.status(404).json({ message: 'Document not found' });
    }

    await document.destroy();

    res.json({ message: 'Document deleted' });
  } catch (error) {
    console.error('[document.controller] Delete document error:', error);
    res.status(500).json({ message: 'Error deleting document' });
  }
};
