/**
 * Drafting Service Entry Point
 * Production-grade microservice for document drafting with Zoho Writer
 */
require('dotenv').config();

const app = require('./src/app');
const { logStartup, registerLifecycleHandlers } = require('./src/utils/logger');
const pool = require('./src/config/database');

// Register lifecycle handlers immediately
registerLifecycleHandlers();

const PORT = process.env.PORT || 5005;

// Test database connection before starting
const startServer = async () => {
    try {
        // Test DB connection
        const client = await pool.connect();
        console.log('✅ [DraftingService] Database connected successfully');
        client.release();

        // Start server
        app.listen(PORT, () => {
            logStartup();
            console.log(`✅ [DraftingService] Running on port ${PORT}`);
        });
    } catch (error) {
        console.error('❌ [DraftingService] Failed to start:', error.message);
        process.exit(1);
    }
};

startServer();
