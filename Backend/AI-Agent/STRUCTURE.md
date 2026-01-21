# AI-Agent Service Structure

## Overview
This service provides document processing and AI chat capabilities for backend services. It's designed to be called by third-party services without authentication requirements.

## Key Differences from document-service

1. **No Authentication**: All endpoints are public (for backend-to-backend calls)
2. **Multi-File Support**: Chat endpoint can search across multiple documents simultaneously
3. **Simplified Models**: Uses `agent_*` table prefixes instead of `user_files`, `file_chunks`, etc.
4. **No User Context**: Documents are stored without user association

## File Structure

```
Backend/AI-Agent/
├── config/
│   ├── db.js              # Database connection
│   └── gcs.js             # Google Cloud Storage configuration
├── controllers/
│   └── documentController.js  # Main controller (upload, process, chat)
├── models/
│   ├── DocumentModel.js   # Document metadata operations
│   ├── FileChunk.js       # Chunk storage operations
│   ├── ChunkVector.js     # Vector embedding operations
│   └── FileChat.js        # Chat history operations
├── routes/
│   └── documentRoutes.js  # API routes (no auth middleware)
├── services/
│   ├── aiService.js       # LLM integration (Gemini)
│   ├── chunkingService.js # Text chunking with LangChain
│   ├── embeddingService.js # Embedding generation
│   ├── gcsService.js      # GCS upload/download
│   └── documentAiService.js # Document AI OCR integration
├── utils/
│   └── textExtractor.js   # PDF/text extraction utilities
├── migrations/
│   └── 001_create_agent_tables.sql  # Database schema
├── index.js               # Express server entry point
├── package.json           # Dependencies
└── README.md             # Documentation
```

## API Usage Examples

### 1. Upload a Document
```bash
curl -X POST http://localhost:3001/api/documents/upload \
  -F "document=@/path/to/file.pdf"
```

Response:
```json
{
  "message": "Document uploaded and processing initiated.",
  "file_id": "uuid-here",
  "gs_uri": "gs://bucket/path"
}
```

### 2. Check Processing Status
```bash
curl http://localhost:3001/api/documents/status/{file_id}
```

Response:
```json
{
  "document_id": "uuid",
  "filename": "file.pdf",
  "status": "processed",
  "processing_progress": 100,
  "current_operation": "Completed",
  "chunks": 150,
  "summary": "Document summary..."
}
```

### 3. Chat with All Documents
```bash
curl -X POST http://localhost:3001/api/documents/chat \
  -H "Content-Type: application/json" \
  -d '{
    "question": "What are the key points in all documents?",
    "llm_name": "gemini"
  }'
```

### 4. Chat with Specific Documents
```bash
curl -X POST http://localhost:3001/api/documents/chat \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Compare these two documents",
    "file_ids": ["uuid1", "uuid2"],
    "session_id": "conversation-uuid"
  }'
```

Response:
```json
{
  "success": true,
  "session_id": "uuid",
  "message_id": "uuid",
  "answer": "Based on the documents...",
  "history": [...],
  "used_chunk_ids": ["uuid1", "uuid2"],
  "chunks_used": 15,
  "files_used": 2,
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### 5. Get All Processed Documents
```bash
curl http://localhost:3001/api/documents/documents
```

## Database Schema

### agent_documents
- Stores uploaded document metadata
- Tracks processing status and progress

### agent_file_chunks
- Stores text chunks from documents
- Includes page numbers and headings

### agent_chunk_vectors
- Stores vector embeddings for semantic search
- Uses pgvector extension for similarity search

### agent_file_chats
- Stores chat history
- Supports multiple file_ids per chat (array field)

## Processing Flow

1. **Upload**: File uploaded via POST /api/documents/upload
2. **Text Extraction**: 
   - Digital-native PDFs: pdf-parse
   - Scanned PDFs/Images: Document AI OCR
3. **Chunking**: LangChain RecursiveCharacterTextSplitter
4. **Embedding**: Gemini text-embedding-004
5. **Storage**: Chunks and vectors saved to PostgreSQL
6. **Ready**: Document available for chat queries

## Chat Flow

1. **Question Processing**: User question is embedded
2. **Vector Search**: Find relevant chunks across specified/all files
3. **Context Assembly**: Top chunks assembled with metadata
4. **LLM Call**: Question + context sent to Gemini
5. **Response**: Answer returned with used chunks and file references

## Environment Variables

Required:
- `DATABASE_URL`: PostgreSQL connection string
- `GEMINI_API_KEY`: For embeddings and LLM calls
- `GCS_INPUT_BUCKET_NAME`: For document storage
- `GCS_OUTPUT_BUCKET_NAME`: For Document AI results
- `GCLOUD_PROJECT_ID`: For Document AI
- `DOCUMENT_AI_PROCESSOR_ID`: For Document AI OCR

Optional:
- `PORT`: Server port (default: 3001)
- `GCS_KEY_BASE64`: Base64-encoded service account key
- `GEMINI_EMBEDDING_MODEL`: Embedding model (default: text-embedding-004)
