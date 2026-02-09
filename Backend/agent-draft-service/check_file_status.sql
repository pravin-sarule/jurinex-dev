-- Check file processing status
-- Replace 'd97f34c5-384b-46df-861a-2a9da6f7b446' with your file_id

SELECT 
    id,
    originalname,
    status,
    processing_progress,
    current_operation,
    created_at,
    processed_at
FROM user_files
WHERE id = 'd97f34c5-384b-46df-861a-2a9da6f7b446';

-- Check if chunks exist
SELECT COUNT(*) as chunk_count
FROM file_chunks
WHERE file_id = 'd97f34c5-384b-46df-861a-2a9da6f7b446';

-- Check if embeddings exist
SELECT COUNT(*) as embedding_count
FROM chunk_vectors cv
INNER JOIN file_chunks fc ON cv.chunk_id = fc.id
WHERE fc.file_id = 'd97f34c5-384b-46df-861a-2a9da6f7b446';
