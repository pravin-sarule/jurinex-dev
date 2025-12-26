const fs = require('fs');
const path = require('path');
const jobQueue = require('../services/jobQueue');
const Job = require('../models/Job');
const config = require('../config/env');

/**
 * Submit translation job (async processing)
 */
async function translateDocument(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded',
      });
    }

    const { targetLanguage, sourceLanguage } = req.body;

    if (!targetLanguage) {
      // Clean up uploaded file
      if (req.file && req.file.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          // Ignore
        }
      }
      return res.status(400).json({
        success: false,
        error: 'Target language is required',
      });
    }

    // Validate file size
    const fileSize = req.file.size;
    const maxFileSize = config.upload.maxFileSize;
    if (fileSize > maxFileSize) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        // Ignore
      }
      return res.status(400).json({
        success: false,
        error: `File size exceeds maximum limit of ${maxFileSize / 1024 / 1024}MB`,
      });
    }

    // Create async job
    const job = await jobQueue.addJob({
      filePath: req.file.path,
      mimeType: req.file.mimetype,
      originalFileName: req.file.originalname,
      targetLanguage,
      sourceLanguage: sourceLanguage || null,
      fileSize,
    });

    // Return job info immediately
    res.status(202).json({
      success: true,
      message: 'Translation job submitted successfully',
      data: {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        statusUrl: `/api/translation/status/${job.id}`,
        createdAt: job.createdAt,
      },
    });
  } catch (error) {
    console.error('Translation controller error:', error);

    // Clean up uploaded file if it exists
    if (req.file && req.file.path) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error('Error cleaning up file:', unlinkError);
      }
    }

    res.status(500).json({
      success: false,
      error: error.message || 'Failed to submit translation job',
    });
  }
}

/**
 * Get job status
 */
async function getJobStatus(req, res) {
  try {
    const { jobId } = req.params;
    const job = Job.get(jobId);

    if (!job) {
      return res.status(404).json({
        success: false,
        error: 'Job not found',
      });
    }

    res.json({
      success: true,
      data: {
        id: job.id,
        status: job.status,
        progress: job.progress,
        message: job.message,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        fileType: job.fileType,
        isDigitalNative: job.isDigitalNative,
        targetLanguage: job.targetLanguage,
        sourceLanguage: job.sourceLanguage,
        translatedFile: job.translatedFile,
        downloadUrl: job.downloadUrl,
        error: job.error,
      },
    });
  } catch (error) {
    console.error('Get job status error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get job status',
    });
  }
}

/**
 * Download translated document
 */
async function downloadTranslatedDocument(req, res) {
  try {
    const { filename } = req.params;
    const filePath = path.join(config.upload.uploadDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        error: 'File not found',
      });
    }

    res.download(filePath, (err) => {
      if (err) {
        console.error('Download error:', err);
        res.status(500).json({
          success: false,
          error: 'Failed to download file',
        });
      }
    });
  } catch (error) {
    console.error('Download controller error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Download failed',
    });
  }
}

/**
 * Health check endpoint
 */
async function healthCheck(req, res) {
  res.json({
    success: true,
    message: 'Translation service is running',
    timestamp: new Date().toISOString(),
  });
}

module.exports = {
  translateDocument,
  getJobStatus,
  downloadTranslatedDocument,
  healthCheck,
};

