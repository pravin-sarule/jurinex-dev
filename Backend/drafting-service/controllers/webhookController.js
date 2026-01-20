const Draft = require('../models/Draft');

/**
 * Webhook Controller
 * Handles Google Drive Push Notifications (Webhooks)
 * 
 * Implements debouncing/quiet period to avoid excessive exports during active editing
 */

// In-memory store for pending sync operations (debouncing)
// Key: googleFileId, Value: { timeout, lastUpdate }
const pendingSyncs = new Map();

// Quiet period in milliseconds (wait 5 seconds after last edit before syncing)
const QUIET_PERIOD_MS = 5000;

/**
 * POST /api/webhooks/google-drive
 * Webhook endpoint for Google Drive Push Notifications
 * 
 * Headers:
 * - x-goog-resource-id: The Google Drive file ID
 * - x-goog-resource-state: The state (sync, update, etc.)
 * - x-goog-resource-uri: The resource URI
 * - x-goog-channel-id: The channel ID
 * - x-goog-channel-expiration: The expiration time
 * 
 * Returns 200 or 204 immediately to acknowledge receipt
 * Implements debouncing: waits for a quiet period before syncing
 */
const handleGoogleDriveWebhook = async (req, res) => {
  // IMPORTANT: Return 200/204 immediately to acknowledge receipt
  // Process the webhook asynchronously to avoid Google retries
  res.status(200).send('OK');

  // Process webhook asynchronously
  setImmediate(async () => {
    try {
      // Extract headers
      const resourceId = req.headers['x-goog-resource-id'];
      const resourceState = req.headers['x-goog-resource-state'];
      const resourceUri = req.headers['x-goog-resource-uri'];
      const channelId = req.headers['x-goog-channel-id'];
      const channelExpiration = req.headers['x-goog-channel-expiration'];

      console.log(`[Webhook] Received Google Drive webhook:`);
      console.log(`[Webhook]    Resource ID: ${resourceId}`);
      console.log(`[Webhook]    Resource State: ${resourceState}`);
      console.log(`[Webhook]    Channel ID: ${channelId}`);

      // Validate required headers
      if (!resourceId) {
        console.warn(`[Webhook] ⚠️  Missing x-goog-resource-id header`);
        return;
      }

      // Handle the 'sync' state (Google's initial test message) by ignoring it
      if (resourceState === 'sync') {
        console.log(`[Webhook] Ignoring 'sync' state (initial test message)`);
        return;
      }

      // Only process 'update' state
      if (resourceState !== 'update') {
        console.log(`[Webhook] Ignoring state '${resourceState}' (only processing 'update')`);
        return;
      }

      // Extract draft ID from channel ID
      // Channel ID format: webhook-{draftId}-{timestamp}
      let draft = null;
      if (channelId && channelId.startsWith('webhook-')) {
        const parts = channelId.split('-');
        if (parts.length >= 2) {
          const draftId = parseInt(parts[1]);
          if (!isNaN(draftId)) {
            draft = await Draft.findById(draftId);
            if (draft) {
              console.log(`[Webhook] Found draft ${draftId} from channel ID`);
            }
          }
        }
      }

      // Fallback: Try to find by resourceId (in case channel ID format changes)
      if (!draft && resourceId) {
        // Note: resourceId is Google's webhook resource ID, not the file ID
        // But we can try to find drafts that might have this stored
        console.log(`[Webhook] Trying to find draft by resourceId: ${resourceId}`);
        // For now, we'll rely on channel ID extraction above
      }

      // If still not found, try to find by any google_file_id (last resort)
      // This won't work with resourceId, but we log it for debugging
      if (!draft) {
        console.warn(`[Webhook] ⚠️  Could not find draft from channel ID: ${channelId}`);
        console.warn(`[Webhook] ⚠️  Resource ID: ${resourceId} (this is Google's webhook ID, not file ID)`);
        return;
      }

      // Get the actual google_file_id from the draft
      const googleFileId = draft.google_file_id;
      if (!googleFileId) {
        console.warn(`[Webhook] ⚠️  Draft ${draft.id} does not have a google_file_id`);
        return;
      }

      console.log(`[Webhook] File change detected for draft ${draft.id} (${draft.title})`);
      console.log(`[Webhook]    Google File ID: ${googleFileId}`);

      // Use draft ID as the key for debouncing (more reliable than google_file_id)
      const syncKey = `draft-${draft.id}`;

      // Debouncing: Cancel any pending sync for this draft
      if (pendingSyncs.has(syncKey)) {
        const pending = pendingSyncs.get(syncKey);
        clearTimeout(pending.timeout);
        console.log(`[Webhook] Cancelled pending sync for draft ${draft.id} (new change detected)`);
      }

      // Schedule a new sync after the quiet period
      const timeout = setTimeout(async () => {
        try {
          console.log(`[Webhook] Quiet period ended. Syncing draft ${draft.id} to GCS...`);
          console.log(`[Webhook]    Draft gcs_path: ${draft.gcs_path || 'NOT SET (will be created)'}`);
          console.log(`[Webhook]    Google File ID: ${googleFileId}`);
          
          // Get User OAuth client for export (User OAuth is required for Drive operations)
          const { getAuthorizedClient } = require('../utils/oauth2Client');
          const userOAuthClient = await getAuthorizedClient(draft.user_id);
          
          // Sync the document: export and overwrite in GCS
          // This will create gcs_path if it doesn't exist
          const { syncGoogleDocToGCS } = require('../services/fileUploadService');
          const result = await syncGoogleDocToGCS(googleFileId, 'docx', userOAuthClient);

          console.log(`[Webhook] ✅ Successfully synced draft ${draft.id} to GCS`);
          console.log(`[Webhook]    GCS Path: ${result.gcsPath}`);
          console.log(`[Webhook]    Synced at: ${result.syncedAt}`);
          console.log(`[Webhook]    File size: ${result.fileSize || 'unknown'} bytes`);

          // Remove from pending syncs
          pendingSyncs.delete(syncKey);
        } catch (syncError) {
          console.error(`[Webhook] ❌ Error syncing draft ${draft.id}:`, syncError.message);
          // Remove from pending syncs even on error
          pendingSyncs.delete(syncKey);
        }
      }, QUIET_PERIOD_MS);

      // Store the pending sync
      pendingSyncs.set(syncKey, {
        timeout,
        lastUpdate: new Date(),
        draftId: draft.id,
        googleFileId: googleFileId
      });

      console.log(`[Webhook] Scheduled sync for draft ${draft.id} after ${QUIET_PERIOD_MS}ms quiet period`);

    } catch (error) {
      console.error(`[Webhook] ❌ Error processing webhook:`, error);
      // Don't throw - we've already returned 200, so Google won't retry
      // Log the error for monitoring/debugging
    }
  });
};

/**
 * POST /api/drafts/:draftId/watch
 * Setup a webhook watcher for a draft
 * 
 * Body: { webhookUrl?: string } (optional, defaults to configured webhook URL)
 */
const setupDraftWatcher = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const draftId = parseInt(req.params.draftId);
    const { webhookUrl } = req.body;

    // Get draft
    const draft = await Draft.findById(draftId);
    
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }

    // Verify ownership
    if (draft.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Permission denied' });
    }

    if (!draft.google_file_id) {
      return res.status(400).json({ success: false, error: 'Draft does not have a Google file ID' });
    }

    // Get webhook URL from environment or request body
    const { getWebhookUrl, validateWebhookUrl } = require('../utils/webhookUrl');
    
    // Validate webhook URL configuration
    const validation = validateWebhookUrl();
    if (!validation.isValid && !webhookUrl) {
      return res.status(400).json({
        success: false,
        error: 'Webhook URL not configured',
        message: validation.message,
        suggestion: validation.suggestion
      });
    }
    
    const finalWebhookUrl = webhookUrl || getWebhookUrl();

    console.log(`[Webhook] Setting up watcher for draft ${draftId} (${draft.google_file_id})`);

    // Get User OAuth client for webhook setup (file is user-owned, service account can't access it)
    const { getAuthorizedClient } = require('../utils/oauth2Client');
    const userOAuthClient = await getAuthorizedClient(draft.user_id);

    const { setupDriveWatcher } = require('../services/driveWebhookService');
    const watcherInfo = await setupDriveWatcher(draft.google_file_id, draftId, finalWebhookUrl, userOAuthClient);

    res.status(200).json({
      success: true,
      message: 'Webhook watcher registered successfully',
      watcher: {
        channelId: watcherInfo.channelId,
        resourceId: watcherInfo.resourceId,
        expiration: watcherInfo.expiration,
        webhookUrl: finalWebhookUrl
      },
      note: `Watcher will expire on ${watcherInfo.expiration.toISOString()}. Renew before expiration.`
    });

  } catch (error) {
    console.error('[Webhook] Error setting up watcher:', error);
    
    if (error.message?.includes('GCS_KEY_BASE64') || error.message?.includes('Service Account')) {
      return res.status(500).json({ 
        success: false, 
        error: 'Service Account configuration error. Please check GCS_KEY_BASE64 environment variable.',
        details: error.message 
      });
    }

    res.status(500).json({ success: false, error: 'Failed to setup watcher', details: error.message });
  }
};

/**
 * DELETE /api/drafts/:draftId/watch
 * Stop a webhook watcher for a draft
 * 
 * Body: { channelId: string, resourceId: string }
 */
const stopDraftWatcher = async (req, res) => {
  try {
    const userId = parseInt(req.user.id);
    const draftId = parseInt(req.params.draftId);
    const { channelId, resourceId } = req.body;

    if (!channelId || !resourceId) {
      return res.status(400).json({ success: false, error: 'channelId and resourceId are required' });
    }

    // Get draft
    const draft = await Draft.findById(draftId);
    
    if (!draft) {
      return res.status(404).json({ success: false, error: 'Draft not found' });
    }

    // Verify ownership
    if (draft.user_id !== userId) {
      return res.status(403).json({ success: false, error: 'Permission denied' });
    }

    const { stopDriveWatcher } = require('../services/driveWebhookService');
    await stopDriveWatcher(channelId, resourceId);

    res.status(200).json({
      success: true,
      message: 'Webhook watcher stopped successfully'
    });

  } catch (error) {
    console.error('[Webhook] Error stopping watcher:', error);
    res.status(500).json({ success: false, error: 'Failed to stop watcher', details: error.message });
  }
};

module.exports = {
  handleGoogleDriveWebhook,
  setupDraftWatcher,
  stopDraftWatcher
};

