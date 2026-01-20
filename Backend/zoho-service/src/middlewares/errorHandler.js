/**
 * Centralized Error Handler Middleware
 * Safe error messages for production
 */

/**
 * Handle all errors
 */
const errorHandler = (err, req, res, next) => {
    const requestId = req.requestId || 'unknown';

    // Log full error internally
    console.error(`[REQ:${requestId}] ❌ Error: ${err.message}`);
    console.error(`[REQ:${requestId}]   Stack: ${err.stack}`);

    // Determine status code
    const statusCode = err.statusCode || err.status || 500;

    // Safe error response for production
    const response = {
        success: false,
        error: statusCode >= 500 ? 'Internal server error' : err.message,
        code: err.code || 'UNKNOWN_ERROR',
        requestId
    };

    // Include details in development only
    if (process.env.NODE_ENV === 'development') {
        response.stack = err.stack;
    }

    res.status(statusCode).json(response);
};

/**
 * Handle 404 Not Found
 */
const notFound = (req, res) => {
    const requestId = req.requestId || 'unknown';
    console.log(`[REQ:${requestId}] ❌ 404 Not Found: ${req.method} ${req.originalUrl}`);

    res.status(404).json({
        success: false,
        error: 'Endpoint not found',
        code: 'NOT_FOUND',
        requestId
    });
};

module.exports = { errorHandler, notFound };
