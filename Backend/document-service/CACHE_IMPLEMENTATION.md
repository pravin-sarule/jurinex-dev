# LLM Response Caching Implementation

## Overview
This implementation provides user-specific LLM response caching with automatic invalidation when users upload new documents. The system uses SHA-256 hashing for prompt identification and PostgreSQL for storage.

## Database Schema

### Tables Created
1. **prompt_cache** - Stores cached LLM responses with context isolation
2. **user_metadata** - Tracks last document upload timestamp for cache invalidation

### Key Features
- **Context Isolation**: Cache entries are isolated by `chat_type` ('folder' or 'file') and `context_id` (folder_name or file_id)
- **Prevents Cross-Contamination**: A prompt in "Case A" won't accidentally return a cached result from "Case B"
- **Unique Constraint**: `(user_id, context_id, prompt_hash)` ensures one cache entry per user per context per prompt

### Migrations
Run the migrations in order:
```bash
# Step 1: Create initial tables
psql -d your_database -f Backend/document-service/db/migrations/create_prompt_cache_tables.sql

# Step 2: Add context support (if upgrading existing installation)
psql -d your_database -f Backend/document-service/db/migrations/update_prompt_cache_add_context.sql
```

## Architecture

### Core Components

1. **promptCacheService.js** - Main caching service
   - `getCachedResponse()` - Check cache before LLM call
   - `setCachedResponse()` - Store response after LLM call
   - `updateLastDocUpload()` - Invalidate cache on document upload
   - `cleanupExpiredCache()` - Remove expired entries
   - `cleanupOldCache()` - Remove old entries (30+ days)

2. **Cache Invalidation**
   - Automatically triggered when `updateFileProcessedAt()` is called
   - Updates `user_metadata.last_doc_upload` timestamp
   - All cache entries created before this timestamp are considered stale

3. **Cache Key Generation**
   - Prompts are normalized (lowercased, trimmed, whitespace normalized)
   - SHA-256 hash is generated from normalized prompt
   - Hash is used as the cache key

## Integration Points

### 1. intelligentFolderChatController.js
- **Non-streaming endpoint** (`intelligentFolderChat`):
  - Checks cache before RAG LLM call
  - Stores response in cache after successful LLM call
  - Cache key: base prompt text (before context addition)

- **Streaming endpoint** (`intelligentFolderChatStream`):
  - Caches response after streaming completes
  - Note: Streaming responses can't use cache before streaming, but cached responses can be used for future non-streaming requests

### 2. documentModel.js
- **updateFileProcessedAt()**:
  - Automatically invalidates user cache when document processing completes
  - Calls `updateLastDocUpload()` to update user metadata

## Configuration

### Environment Variables
- `CACHE_STORE_PROMPTS` (optional): Set to `'true'` to store original prompt text in cache (default: false for privacy)

### Cache TTL
- Default TTL: 30 days
- Can be configured per cache entry via `ttlDays` parameter

## Usage Examples

### Check Cache Before LLM Call

**For Folder Chats:**
```javascript
const { getCachedResponse, setCachedResponse } = require('../services/promptCacheService');

const cacheKey = promptText;
const cachedResult = await getCachedResponse(userId, cacheKey, {
  methodUsed: 'rag',
  chatType: 'folder', // Required: 'folder' or 'file'
  contextId: folderName // Required: folder_name for folder chats
});

if (cachedResult) {
  answer = cachedResult.output; // Use cached response
} else {
  answer = await callLLM(...); // Generate new response
  
  // Store in cache
  await setCachedResponse(userId, cacheKey, answer, {
    methodUsed: 'rag',
    chatType: 'folder',
    contextId: folderName,
    sessionId: sessionId,
    ttlDays: 30
  });
}
```

**For File Chats:**
```javascript
const { getCachedResponse, setCachedResponse } = require('../services/promptCacheService');

const cacheKey = storedQuestion;
const cachedResult = await getCachedResponse(userId, cacheKey, {
  methodUsed: 'rag',
  chatType: 'file', // Required: 'file' for single document chats
  contextId: file_id.toString() // Required: file_id for file chats
});

if (cachedResult) {
  answer = cachedResult.output; // Use cached response
} else {
  answer = await callLLM(...); // Generate new response
  
  // Store in cache
  await setCachedResponse(userId, cacheKey, answer, {
    methodUsed: 'rag',
    chatType: 'file',
    contextId: file_id.toString(),
    sessionId: sessionId,
    ttlDays: 30
  });
}
```

### Invalidate Cache on Document Upload
```javascript
const { updateLastDocUpload } = require('../services/promptCacheService');

// When document processing completes
await updateLastDocUpload(userId);
```

## Cache Validation Logic

1. **Hash Match**: Check if prompt hash exists in cache
2. **TTL Check**: Verify cache entry hasn't expired
3. **Staleness Check**: Compare `cache.created_at` with `user_metadata.last_doc_upload`
   - If `cache.created_at < last_doc_upload`, cache is stale (new document uploaded)
4. **Method/Folder Match**: Optional validation for method and folder consistency

## Maintenance

### Cleanup Jobs
Run periodic cleanup to remove old cache entries:

```javascript
const { cleanupExpiredCache, cleanupOldCache } = require('../services/promptCacheService');

// Remove expired entries (TTL-based)
await cleanupExpiredCache();

// Remove entries older than 30 days
await cleanupOldCache(30);
```

### Statistics
Get cache performance statistics:

```javascript
const { getCacheStats } = require('../services/promptCacheService');
const stats = await getCacheStats(userId);

console.log(stats);
// {
//   totalCacheEntries: 150,
//   totalCacheHits: 1200,
//   totalCacheMisses: 800,
//   hitRate: '60.00%',
//   lastDocUpload: '2024-01-15T10:30:00Z',
//   lastCacheInvalidation: '2024-01-15T10:30:00Z'
// }
```

## Production Considerations

1. **Storage Costs**: Monitor `prompt_cache` table size. Consider:
   - Regular cleanup of old entries (30+ days)
   - TTL-based expiration
   - Periodic archiving

2. **Performance**: 
   - Indexes are created for fast lookups
   - Cache hits are significantly faster than LLM calls
   - Cache misses have minimal overhead

3. **Security**:
   - Prompts are hashed (not stored by default)
   - Cached outputs are stored as plain text (ensure database encryption at rest)
   - User-specific isolation (cache entries are user-scoped)

4. **Scalability**:
   - Cache is user-specific, so it scales with user count
   - Consider Redis for high-traffic scenarios (future enhancement)

## Error Handling

- Cache failures are non-critical and don't break the main flow
- Errors are logged but don't prevent LLM calls
- Cache storage failures are caught and logged as warnings

## Testing

To test the caching system:

1. Make a query to `intelligentFolderChat`
2. Check logs for "Cache MISS" message
3. Make the same query again
4. Check logs for "Cache HIT" message
5. Upload a new document
6. Make the same query again - should see "Cache MISS" (cache invalidated)

## Future Enhancements

1. **Redis Integration**: Move cache to Redis for better performance
2. **Cache Warming**: Pre-populate cache for common queries
3. **Partial Cache**: Cache intermediate results (embeddings, chunk selections)
4. **Cache Analytics**: Dashboard for cache hit rates and performance metrics

