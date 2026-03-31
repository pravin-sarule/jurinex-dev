const checkDocumentUploadLimits = async (req, res, next) => {
    try {
        const userId = req.user?.id || req.userId;
        if (!userId) return res.status(401).json({ message: 'Unauthorized: User ID not found.' });

        // Global behavior: allow all authenticated users to upload and use the service
        // without enforcing subscription/plan or payment-based limits.
        return next();

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
    checkDocumentUploadLimits
};
