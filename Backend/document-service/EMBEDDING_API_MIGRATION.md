# Gemini Embedding API Migration - Complete Fix

## Problem Summary
1. **Files not being stored**: Upload process was failing
2. **Embedding errors**: Old embedding API was being used incorrectly
3. **Database storage issues**: Chunks and embeddings were not being saved

## Root Causes Identified

### 1. Incorrect Embedding API Usage
- **Old Code**: Used `@google/generative-ai` with `batchEmbedContents`
- **Issue**: This method is deprecated and doesn't work with the latest Gemini models
- **New Code**: Uses `@google/genai` with `embedContent` method

### 2. Wrong Model Name
- **Old**: `embedding-001` or `text-embedding-001`
- **Correct**: `gemini-embedding-001`

### 3. Missing Configuration
- No task type specification (needed for RAG optimization)
- No output dimensionality configuration
- No normalization for non-3072 dimensions

## Complete Solution Implemented

### 1. Updated Embedding Service (`services/embeddingService.js`)

#### Key Changes:
```javascript
// OLD (Incorrect)
const { GoogleGenerativeAI } = require('@google/generative-ai');
const model = genAI.getGenerativeModel({ model: 'text-embedding-001' });
const response = await model.batchEmbedContents({ requests });

// NEW (Correct)
const { genai } = require('@google/genai');
const client = new genai.Client({ apiKey: process.env.GEMINI_API_KEY });
const result = await client.models.embedContent({
  model: 'gemini-embedding-001',
  contents: texts,
  config: {
    taskType: 'RETRIEVAL_DOCUMENT',  // Optimized for RAG
    outputDimensionality: 768         // Configurable dimension
  }
});
```

#### Features Added:
1. **Task Type Specification**: `RETRIEVAL_DOCUMENT` for optimal RAG performance
2. **Configurable Dimensions**: Support for 768, 1536, or 3072 dimensions
3. **Automatic Normalization**: Normalizes embeddings for dimensions < 3072
4. **Better Error Handling**: Clearer error messages and validation
5. **Comprehensive Logging**: Tracks every step of the embedding process

### 2. Updated Environment Configuration (`.env`)

```bash
# OLD
GEMINI_EMBEDDING_MODEL=embedding-001
GEMINI_EMBEDDING_MAX_CHARS=8000

# NEW
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
GEMINI_EMBEDDING_DIMENSION=768
GEMINI_EMBEDDING_MAX_CHARS=10000
```

### 3. Enhanced Document Processing (`controllers/documentController.js`)

Added comprehensive verification:
- ✅ Verifies chunks are saved
- ✅ Verifies embeddings are saved
- ✅ Checks embedding coverage
- ✅ Logs all chunk IDs
- ✅ Throws errors immediately if anything fails

### 4. New Diagnostic Endpoint

**Route**: `GET /api/documents/verify/:file_id`

Returns complete verification status:
```json
{
  "verification": {
    "chunks_saved": true,
    "embeddings_saved": true,
    "processing_complete": true,
    "all_checks_passed": true
  },
  "embeddings": {
    "total": 50,
    "coverage_percentage": 100,
    "is_complete": true
  }
}
```

## Technical Details

### Embedding Dimensions Explained

According to Gemini documentation:
- **3072 dimensions**: Default, pre-normalized, highest accuracy
- **1536 dimensions**: Good balance, requires normalization
- **768 dimensions**: ✅ **Recommended** - Best storage/performance ratio, requires normalization
- **512 dimensions**: Smaller, slight accuracy loss
- **256 dimensions**: Minimal, more accuracy loss

**We chose 768 dimensions** because:
- 67.99% MTEB score (vs 68.16% for 3072)
- 4x less storage space
- Faster similarity searches
- Minimal accuracy loss

### Normalization Formula

For dimensions < 3072, we normalize using L2 norm:

```javascript
magnitude = √(Σ(value²))
normalized_value = value / magnitude
```

This ensures:
- Vector magnitude = 1.0
- Cosine similarity works correctly
- Semantic search accuracy is maintained

## Files Modified

1. **`services/embeddingService.js`** - Complete rewrite with new API
2. **`controllers/documentController.js`** - Added verification and logging
3. **`routes/documentRoutes.js`** - Added diagnostic endpoint
4. **`.env`** - Updated embedding configuration

## Testing Instructions

### 1. Restart the Document Service

The service should already be running. Check the logs for:

```bash
[EmbeddingService] Initialized with model: gemini-embedding-001
[EmbeddingService] Output dimensionality: 768
```

### 2. Upload a Test File

```bash
curl -X POST http://localhost:5002/api/documents/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "document=@/path/to/test.pdf"
```

### 3. Monitor the Logs

You should see:
```
[processDocument] 🚀 Starting document processing
...
[EmbeddingService] Processing X texts in Y batches
[EmbeddingService] ✅ Successfully embedded X texts
✅ [processDocument] Chunk IDs saved: <id1>, <id2>, <id3>...
✅ [processDocument] Saved X embeddings to database
✅ [processDocument] Verified X embeddings in database
✅ [processDocument] Final verification - Chunks: X, Embeddings: X, Coverage: 100.00%
```

### 4. Verify with Diagnostic Endpoint

```bash
curl -X GET "http://localhost:5002/api/documents/verify/<FILE_ID>" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Expected response:
```json
{
  "success": true,
  "verification": {
    "chunks_saved": true,
    "embeddings_saved": true,
    "processing_complete": true,
    "all_checks_passed": true
  },
  "embeddings": {
    "total": 50,
    "coverage_percentage": 100,
    "is_complete": true,
    "sample": [
      {
        "chunk_id": "...",
        "has_embedding": true,
        "embedding_dimension": 768
      }
    ]
  }
}
```

## What Was Fixed

### Before:
- ❌ Using deprecated `@google/generative-ai` SDK
- ❌ Wrong model name (`embedding-001`)
- ❌ No task type specification
- ❌ No dimension configuration
- ❌ No normalization
- ❌ Silent failures
- ❌ No verification

### After:
- ✅ Using latest `@google/genai` SDK
- ✅ Correct model name (`gemini-embedding-001`)
- ✅ Task type: `RETRIEVAL_DOCUMENT` (optimized for RAG)
- ✅ Configurable dimensions (768 recommended)
- ✅ Automatic normalization for accuracy
- ✅ Comprehensive error handling
- ✅ Full verification and logging

## Performance Improvements

1. **Storage**: 4x reduction (768 vs 3072 dimensions)
2. **Speed**: Faster similarity searches with smaller vectors
3. **Cost**: Same API cost, better value
4. **Accuracy**: 67.99% MTEB score (minimal loss from 68.16%)

## Troubleshooting

### If embeddings still fail:

1. **Check API Key**:
   ```bash
   echo $GEMINI_API_KEY
   ```

2. **Check Model Access**:
   - Ensure your API key has access to `gemini-embedding-001`
   - Check quota limits in Google Cloud Console

3. **Check Logs**:
   - Look for `[EmbeddingService]` messages
   - Check for rate limit errors
   - Verify normalization is working

4. **Verify Database**:
   ```sql
   SELECT COUNT(*) FROM chunk_vectors WHERE file_id = 'YOUR_FILE_ID';
   ```

### If files still don't store:

1. **Check File Upload**:
   - Verify GCS bucket permissions
   - Check file size limits
   - Monitor upload progress

2. **Check Processing**:
   - Look for `[processDocument]` logs
   - Check for errors during chunking
   - Verify text extraction worked

## Next Steps

1. ✅ **Service is already running** - Changes applied automatically
2. 📤 **Upload a test file** - Verify the fix works
3. 🔍 **Check the logs** - Ensure embeddings are generated
4. ✔️ **Use diagnostic endpoint** - Verify data is stored

## Support

If issues persist:
1. Check the console logs for detailed error messages
2. Use the diagnostic endpoint to see exactly what's failing
3. The enhanced logging will show the exact point of failure

## References

- [Gemini Embeddings Documentation](https://ai.google.dev/gemini-api/docs/embeddings)
- [Matryoshka Representation Learning](https://arxiv.org/abs/2205.13147)
- [MTEB Benchmark](https://huggingface.co/spaces/mteb/leaderboard)
