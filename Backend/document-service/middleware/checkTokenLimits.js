

const TokenUsageService = require('../services/tokenUsageService');

const DOCUMENT_UPLOAD_COST_TOKENS = 10;
const DOCUMENT_STORAGE_COST_GB = 0.01;

const checkDocumentUploadLimits = async (req, res, next) => {
    try {
        const userId = req.user?.id || req.userId;
        if (!userId) return res.status(401).json({ message: 'Unauthorized: User ID not found.' });

        const authorizationHeader = req.headers.authorization;
        if (!authorizationHeader) return res.status(401).json({ message: 'Authorization header missing.' });

        // Fetch usage & plan (real plan only)
        const { usage, plan } = await TokenUsageService.getUserUsageAndPlan(userId, authorizationHeader);
        if (!plan) return res.status(403).json({ success: false, message: 'Failed to retrieve user plan.' });

        // Requested resources
        const requestedResources = {
            tokens: DOCUMENT_UPLOAD_COST_TOKENS,
            documents: 1,
            storage_gb: DOCUMENT_STORAGE_COST_GB,
        };

        // Enforce limits (only block if tokens exhausted)
        const limitCheck = await TokenUsageService.enforceLimits(userId, usage, plan, requestedResources);
        if (!limitCheck.allowed) {
            return res.status(403).json({
                success: false,
                message: limitCheck.message,
                nextRenewalTime: limitCheck.nextRenewalTime
            });
        }

        // Attach info for controller
        req.userUsage = usage;
        req.userPlan = plan;
        req.requestedResources = requestedResources;

        next();

    } catch (error) {
        console.error('❌ Error in checkDocumentUploadLimits:', error.message);

        if (error.response?.status === 404) {
            return res.status(403).json({
                success: false,
                message: 'Failed to retrieve user plan. Ensure the plan service is accessible.',
                details: error.message
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Internal server error during limit check.',
            details: error.message
        });
    }
};

module.exports = {
    checkDocumentUploadLimits,
    DOCUMENT_UPLOAD_COST_TOKENS,
    DOCUMENT_STORAGE_COST_GB
};
