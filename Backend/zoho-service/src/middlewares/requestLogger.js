/**
 * Request Logger Middleware
 * Structured logging with timing and diagnostics
 */
const { generateRequestId, getProcessDiagnostics, getTokenHash } = require('../utils/logger');

/**
 * Log all incoming requests with timing
 */
const requestLogger = (req, res, next) => {
    const requestId = generateRequestId();
    const startTime = Date.now();
    const diag = getProcessDiagnostics();

    // Attach to request for downstream use
    req.requestId = requestId;
    req.startTime = startTime;

    // Extract token hash for logging (never log full token)
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    const tokenHash = getTokenHash(token);

    // Log request entry
    console.log(`[REQ:${requestId}] ▶ ${req.method} ${req.originalUrl}`);
    console.log(`[REQ:${requestId}]   Instance=${diag.instanceId} PID=${diag.pid} Uptime=${diag.uptimeSec}s Heap=${diag.heapUsedMB}MB`);
    console.log(`[REQ:${requestId}]   Token=${tokenHash}`);

    // Log response on finish
    res.on('finish', () => {
        const duration = Date.now() - startTime;
        const status = res.statusCode;
        const statusIcon = status >= 400 ? '❌' : '✅';
        console.log(`[REQ:${requestId}] ◀ ${statusIcon} ${status} (${duration}ms)`);
    });

    next();
};

module.exports = { requestLogger };
