/**
 * JWT Authentication Middleware
 * Validates Bearer token and extracts user info
 */
const jwt = require('jsonwebtoken');
const { getTokenHash } = require('../utils/logger');

/**
 * Protect routes with JWT authentication
 */
const protect = async (req, res, next) => {
    const requestId = req.requestId || 'unknown';

    try {
        // Extract token from Authorization header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            console.log(`[REQ:${requestId}] ❌ No Authorization header`);
            return res.status(401).json({
                success: false,
                error: 'Authentication required',
                code: 'NO_TOKEN'
            });
        }

        const token = authHeader.split(' ')[1];
        const tokenHash = getTokenHash(token);

        // Check JWT_SECRET
        if (!process.env.JWT_SECRET) {
            console.error(`[REQ:${requestId}] ❌ JWT_SECRET not configured`);
            return res.status(500).json({
                success: false,
                error: 'Server configuration error',
                code: 'CONFIG_ERROR'
            });
        }

        // Verify token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Attach user info to request
        req.user = {
            id: decoded.id,
            email: decoded.email
        };
        req.tokenHash = tokenHash;

        console.log(`[REQ:${requestId}] ✅ Authenticated user: ${decoded.id} (${decoded.email})`);

        next();
    } catch (error) {
        console.error(`[REQ:${requestId}] ❌ Auth failed: ${error.name} - ${error.message}`);

        if (error.name === 'TokenExpiredError') {
            return res.status(401).json({
                success: false,
                error: 'Token expired',
                code: 'TOKEN_EXPIRED'
            });
        }

        if (error.name === 'JsonWebTokenError') {
            return res.status(401).json({
                success: false,
                error: 'Invalid token',
                code: 'INVALID_TOKEN'
            });
        }

        return res.status(401).json({
            success: false,
            error: 'Authentication failed',
            code: 'AUTH_FAILED'
        });
    }
};

module.exports = { protect };
