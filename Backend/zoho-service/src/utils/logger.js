/**
 * Forensic Logger for Drafting Service
 * Production-grade structured logging with diagnostics
 */
const crypto = require('crypto');

// Process identity - stable across lifetime
const PROCESS_INSTANCE_ID = crypto.randomBytes(4).toString('hex');
const PROCESS_START_TIME = Date.now();
let requestCounter = 0;

/**
 * Generate unique request correlation ID
 */
const generateRequestId = () => {
    requestCounter++;
    return `${PROCESS_INSTANCE_ID}-${requestCounter}-${Date.now()}`;
};

/**
 * Get process diagnostics
 */
const getProcessDiagnostics = () => {
    const memUsage = process.memoryUsage();
    return {
        pid: process.pid,
        instanceId: PROCESS_INSTANCE_ID,
        uptimeSec: Math.floor((Date.now() - PROCESS_START_TIME) / 1000),
        heapUsedMB: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotalMB: Math.round(memUsage.heapTotal / 1024 / 1024),
        rssMB: Math.round(memUsage.rss / 1024 / 1024)
    };
};

/**
 * Get token hash for logging (never log full token)
 */
const getTokenHash = (token) => {
    if (!token) return 'NULL';
    try {
        return crypto.createHash('sha256').update(token).digest('hex').substring(0, 8);
    } catch {
        return 'HASH_ERR';
    }
};

/**
 * Log startup banner
 */
const logStartup = () => {
    const diag = getProcessDiagnostics();
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║             DRAFTING SERVICE FORENSIC STARTUP                ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Instance ID:  ${diag.instanceId.padEnd(46)}║`);
    console.log(`║  PID:          ${String(diag.pid).padEnd(46)}║`);
    console.log(`║  Started at:   ${new Date().toISOString().padEnd(46)}║`);
    console.log(`║  Heap:         ${(diag.heapUsedMB + '/' + diag.heapTotalMB + ' MB').padEnd(46)}║`);
    console.log(`║  JWT_SECRET:   ${(process.env.JWT_SECRET ? 'PRESENT' : 'MISSING!').padEnd(46)}║`);
    console.log(`║  GCS Bucket:   ${(process.env.GCS_BUCKET_NAME || 'NOT SET').padEnd(46)}║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
};

/**
 * Log shutdown
 */
const logShutdown = (signal) => {
    const diag = getProcessDiagnostics();
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║             DRAFTING SERVICE FORENSIC SHUTDOWN               ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');
    console.log(`║  Signal:       ${signal.padEnd(46)}║`);
    console.log(`║  Instance ID:  ${diag.instanceId.padEnd(46)}║`);
    console.log(`║  Total uptime: ${(diag.uptimeSec + ' seconds').padEnd(46)}║`);
    console.log(`║  Requests:     ${String(requestCounter).padEnd(46)}║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');
};

/**
 * Register lifecycle handlers
 */
const registerLifecycleHandlers = () => {
    process.on('SIGTERM', () => {
        logShutdown('SIGTERM');
        process.exit(0);
    });

    process.on('SIGINT', () => {
        logShutdown('SIGINT');
        process.exit(0);
    });

    process.on('uncaughtException', (error) => {
        console.error('');
        console.error('🚨🚨🚨 UNCAUGHT EXCEPTION 🚨🚨🚨');
        console.error(`Instance: ${PROCESS_INSTANCE_ID}, PID: ${process.pid}`);
        console.error(`Error: ${error.message}`);
        console.error(`Stack: ${error.stack}`);
        console.error('');
        process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
        console.error('');
        console.error('⚠️⚠️⚠️ UNHANDLED REJECTION ⚠️⚠️⚠️');
        console.error(`Instance: ${PROCESS_INSTANCE_ID}, PID: ${process.pid}`);
        console.error(`Reason: ${reason}`);
        console.error('');
    });
};

/**
 * Log operation timing
 */
const logTiming = (requestId, operation, durationMs, success = true) => {
    const status = success ? '✅' : '❌';
    console.log(`[REQ:${requestId}] ${status} ${operation}: ${durationMs}ms`);
};

module.exports = {
    PROCESS_INSTANCE_ID,
    generateRequestId,
    getProcessDiagnostics,
    getTokenHash,
    logStartup,
    logShutdown,
    registerLifecycleHandlers,
    logTiming
};
