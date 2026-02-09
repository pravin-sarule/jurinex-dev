# Quick Fix Guide - Reprocess Existing Files

## Problem
Files uploaded **before** the embedding API fix don't have embeddings, causing "No relevant information found" errors when querying.

## Solution
Use the new reprocess endpoint to regenerate embeddings for existing files.

## Step 1: Find Your File ID

Get the file ID from your uploaded file. You can find it by:

```bash
# List all your files
curl -X GET "http://localhost:5002/api/files/user" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Look for the file you want to fix and copy its `id`.

## Step 2: Verify Current Status

Check if the file needs reprocessing:

```bash
curl -X GET "http://localhost:5002/api/documents/verify/YOUR_FILE_ID" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Look for:
```json
{
  "embeddings": {
    "total": 0,           // ❌ No embeddings
    "coverage_percentage": 0,
    "is_complete": false
  },
  "chunks": {
    "total": 50           // ✅ Chunks exist
  }
}
```

If `embeddings.total` is 0 but `chunks.total` > 0, you need to reprocess.

## Step 3: Reprocess Embeddings

Run the reprocess endpoint:

```bash
curl -X POST "http://localhost:5002/api/documents/reprocess-embeddings/YOUR_FILE_ID" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Expected response:
```json
{
  "success": true,
  "message": "Embeddings regenerated successfully",
  "file": {
    "id": "c8fa942d-9ffc-48bf-88da-0e84d34b3602",
    "originalname": "Drafting_Engine_Task_Distribution.pdf"
  },
  "before": {
    "chunks": 50,
    "embeddings": 0,
    "coverage": 0
  },
  "after": {
    "chunks": 50,
    "embeddings": 50,
    "coverage": 100
  }
}
```

## Step 4: Verify Fix

Check the file again:

```bash
curl -X GET "http://localhost:5002/api/documents/verify/YOUR_FILE_ID" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Should now show:
```json
{
  "embeddings": {
    "total": 50,           // ✅ Embeddings generated
    "coverage_percentage": 100,
    "is_complete": true
  },
  "verification": {
    "all_checks_passed": true  // ✅ All good!
  }
}
```

## Step 5: Test Your Query

Now try your query again - it should work!

```bash
curl -X POST "http://localhost:5002/api/files/YOUR_FOLDER/intelligent-chat/stream" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "what about this document"
  }'
```

## For Your Specific File

Based on the logs, your file is:
- **File ID**: `c8fa942d-9ffc-48bf-88da-0e84d34b3602`
- **Filename**: `Drafting_Engine_Task_Distribution.pdf`
- **Folder**: `Untitled_Case`

Run this command:

```bash
curl -X POST "http://localhost:5002/api/documents/reprocess-embeddings/c8fa942d-9ffc-48bf-88da-0e84d34b3602" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## What This Does

1. ✅ Retrieves existing chunks from database (no re-upload needed)
2. ✅ Generates embeddings using the **new** Gemini API
3. ✅ Saves embeddings with correct 768-dimension vectors
4. ✅ Verifies all embeddings were saved successfully

## Monitor Progress

Watch the document-service logs for:

```
[reprocessFileEmbeddings] Starting reprocessing for file c8fa942d...
[reprocessFileEmbeddings] Found 50 chunks
[reprocessFileEmbeddings] Current coverage: 0.00%
[reprocessFileEmbeddings] Generating embeddings for 50 chunks...
[EmbeddingService] Processing 50 texts in 1 batches
[EmbeddingService] ✅ Successfully embedded 50 texts
[reprocessFileEmbeddings] Generated 50 embeddings
[reprocessFileEmbeddings] Saving 50 embeddings...
[ChunkVector] ✅ Saved 50 vectors to database
[reprocessFileEmbeddings] ✅ Reprocessing complete. New coverage: 100.00%
```

## Future Uploads

All **new** files uploaded after the fix will automatically have embeddings generated correctly. You only need to reprocess files that were uploaded before the fix.

## Troubleshooting

### If reprocess fails:
1. Check the logs for error messages
2. Verify the file has chunks (if not, you need to re-upload)
3. Check your GEMINI_API_KEY is valid
4. Ensure the embedding service is running

### If you still get "No relevant information found":
1. Verify embeddings were saved: Use the `/verify/:file_id` endpoint
2. Check the embedding dimension matches (should be 768)
3. Try uploading a new test file to confirm the fix works for new uploads
