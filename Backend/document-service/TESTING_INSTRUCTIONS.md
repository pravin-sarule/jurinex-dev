# Testing Instructions for File Upload Fix

## Summary of Changes

I've added comprehensive verification and logging to the document upload processing flow to ensure chunks and embeddings are being saved correctly to the database.

### Changes Made:

1. **Enhanced Logging in `processDocument`** - Added detailed logging at start, after chunk save, and after embedding save
2. **Chunk Verification** - Verifies all chunks were saved and logs chunk IDs
3. **Embedding Verification** - Verifies all embeddings were saved and checks coverage
4. **New Diagnostic Endpoint** - `GET /api/documents/verify/:file_id` to check processing status

## How to Apply Changes

### Option 1: Restart Document Service (Recommended)

If the document-service is currently running, restart it to apply the changes:

```bash
cd /media/dell-2/d3aa004a-6211-442e-bc45-3e38dae3762b/home/admin3620/Desktop/JuriProduct_dev/jurinex-dev/Backend/document-service

# Stop the current process (Ctrl+C if running in terminal)
# Or find and kill the process:
ps aux | grep "node index.js" | grep document-service
# kill -9 <PID>

# Start the service
npm start
```

### Option 2: Start Fresh Terminal

```bash
cd /media/dell-2/d3aa004a-6211-442e-bc45-3e38dae3762b/home/admin3620/Desktop/JuriProduct_dev/jurinex-dev/Backend/document-service
npm start
```

## Testing Steps

### 1. Upload a Test File

Upload a new document to see the enhanced logging:

```bash
# Replace YOUR_TOKEN with actual auth token
# Replace /path/to/test.pdf with actual file path

curl -X POST http://localhost:5000/api/documents/upload \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "document=@/path/to/test.pdf"
```

### 2. Monitor the Logs

Watch the console output for:

```
================================================================================
[processDocument] 🚀 Starting document processing
================================================================================
  📄 File ID: <file-id>
  👤 User ID: <user-id>
  📦 MIME Type: application/pdf
  💾 Buffer Size: X.XX MB
  🔐 Secret ID: none
  🆔 Job ID: <job-id>
================================================================================

✅ [processDocument] File metadata retrieved:
   - Original name: test.pdf
   - GCS path: gs://...
   - Status: uploaded

...

✅ [processDocument] Chunk IDs saved: <id1>, <id2>, <id3>... (X total)
✅ [processDocument] Saved X embeddings to database
✅ [processDocument] Verified X embeddings in database
✅ [processDocument] Final verification - Chunks: X, Embeddings: X, Coverage: 100.00%
```

### 3. Use the Diagnostic Endpoint

After upload completes, verify the file:

```bash
# Get the file_id from the upload response
FILE_ID="<your-file-id>"

curl -X GET "http://localhost:5000/api/documents/verify/${FILE_ID}" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Expected response:
```json
{
  "success": true,
  "file": {
    "id": "...",
    "originalname": "test.pdf",
    "status": "processed",
    "processing_progress": 100
  },
  "chunks": {
    "total": 50,
    "sample": [...]
  },
  "embeddings": {
    "total": 50,
    "coverage_percentage": 100,
    "is_complete": true
  },
  "verification": {
    "chunks_saved": true,
    "embeddings_saved": true,
    "processing_complete": true,
    "all_checks_passed": true
  }
}
```

### 4. Check Existing Files

You can also verify existing files that were uploaded before:

```bash
# List your files first
curl -X GET "http://localhost:5000/api/files/user" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Then verify each file
curl -X GET "http://localhost:5000/api/documents/verify/<FILE_ID>" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## What to Look For

### ✅ Success Indicators:
- All verification checks show `true`
- Coverage percentage is 100%
- Chunk count matches embedding count
- File status is "processed"

### ❌ Failure Indicators:
- Coverage percentage < 100%
- `all_checks_passed: false`
- Error messages in logs
- File status is "error"

## Troubleshooting

### If chunks are not being saved:
1. Check database connection
2. Verify `file_chunks` table exists
3. Check for errors in logs during chunking

### If embeddings are not being saved:
1. Check embedding service is running
2. Verify `chunk_vectors` table exists
3. Check for errors in logs during embedding generation
4. Verify pgvector extension is installed

### If you see errors:
The enhanced logging will show exactly where the process failed. Look for:
- `❌` symbols in logs
- Error messages with stack traces
- Progress percentage where it stopped

## Database Verification (Optional)

You can also check the database directly:

```sql
-- Check chunks
SELECT COUNT(*) FROM file_chunks WHERE file_id = '<FILE_ID>';

-- Check embeddings
SELECT COUNT(*) FROM chunk_vectors WHERE file_id = '<FILE_ID>';

-- Check coverage
SELECT 
  COUNT(fc.id) as chunks,
  COUNT(cv.id) as embeddings,
  (COUNT(cv.id)::float / NULLIF(COUNT(fc.id), 0) * 100) as coverage
FROM file_chunks fc
LEFT JOIN chunk_vectors cv ON cv.chunk_id = fc.id
WHERE fc.file_id = '<FILE_ID>';
```

## Next Steps

After testing:
1. If everything works: The issue is resolved!
2. If issues persist: The enhanced logging will show exactly where the problem is
3. Share the logs with me for further debugging

## Files Modified

- `Backend/document-service/controllers/documentController.js` - Added verification logic
- `Backend/document-service/routes/documentRoutes.js` - Added diagnostic endpoint
- `Backend/document-service/FILE_UPLOAD_FIX_SUMMARY.md` - Documentation
