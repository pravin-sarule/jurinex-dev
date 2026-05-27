const { getLLMConfig } = require('../services/llmConfigService');
const { assertUploadAllowed } = require('../services/llmChatPolicyService');

function statusForUpload(code) {
  if (code === 'DAILY_UPLOAD_LIMIT') return 429;
  if (code === 'FILE_TOO_LARGE' || code === 'DOCUMENT_TOO_MANY_PAGES') return 413;
  return 400;
}

/**
 * After `protect` + `upload.single(...)`: enforces Dashboard Chat upload rules.
 */
async function enforceDashboardUploadPolicy(req, res, next) {
  try {
    const userId = req.user?.id ?? req.userId;
    if (userId == null) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No file uploaded' });
    }

    const config = await getLLMConfig(userId, 'chat');
    req.llmChatConfig = config;

    const filesInRequest = Array.isArray(req.files)
      ? req.files.length
      : req.file
        ? 1
        : 0;
    const maxUploadFiles = Number(config.max_upload_files) || 0;
    if (maxUploadFiles > 0 && filesInRequest > maxUploadFiles) {
      return res.status(400).json({
        success: false,
        code: 'TOO_MANY_FILES_IN_REQUEST',
        message: `Maximum files per upload request is ${maxUploadFiles}.`,
        details: { max_upload_files: maxUploadFiles, files_in_request: filesInRequest },
      });
    }

    const result = await assertUploadAllowed(Number(userId), config, {
      sizeBytes: req.file.size,
      buffer: req.file.buffer,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
    });

    if (!result.ok) {
      return res.status(statusForUpload(result.code)).json({
        success: false,
        code: result.code,
        message: result.message,
        details: result.details,
      });
    }

    next();
  } catch (err) {
    console.error('[Dashboard Upload Policy] error:', err.message);
    return res.status(503).json({
      success: false,
      message: 'Could not verify upload limits. Please try again shortly.',
    });
  }
}

module.exports = { enforceDashboardUploadPolicy };
