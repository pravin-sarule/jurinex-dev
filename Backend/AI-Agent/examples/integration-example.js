/**
 * Example integration code for calling AI-Agent service from another service
 * 
 * This demonstrates how to:
 * 1. Upload a document
 * 2. Wait for processing
 * 3. Chat with documents
 * 4. Handle errors
 */

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

// Support both gateway and direct access
const GATEWAY_URL = process.env.GATEWAY_URL || null;
const AI_AGENT_DIRECT_URL = process.env.AI_AGENT_SERVICE_URL || 'http://localhost:3001';
const AI_AGENT_BASE_URL = GATEWAY_URL 
  ? `${GATEWAY_URL}/ai-agent/documents`
  : `${AI_AGENT_DIRECT_URL}/api/documents`;
const SERVICE_NAME = process.env.SERVICE_NAME || 'admin-service';

class DocumentProcessingClient {
  constructor(baseUrl, serviceName) {
    this.baseUrl = baseUrl;
    this.serviceName = serviceName;
  }

  /**
   * Upload a document for processing
   * @param {string} filePath - Path to the file
   * @returns {Promise<{file_id: string, gs_uri: string}>}
   */
  async uploadDocument(filePath) {
    try {
      const formData = new FormData();
      formData.append('document', fs.createReadStream(filePath));

      // baseUrl already includes /api/documents if direct, or /ai-agent/documents if gateway
      const uploadPath = this.baseUrl.includes('/ai-agent/') 
        ? `${this.baseUrl}/upload`
        : `${this.baseUrl}/upload`;
      
      const response = await axios.post(
        uploadPath,
        formData,
        {
          headers: {
            ...formData.getHeaders(),
            'X-Service-Name': this.serviceName
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity
        }
      );

      if (response.data.success !== false) {
        console.log(`✅ Document uploaded: ${response.data.file_id}`);
        return response.data;
      }
      throw new Error(response.data.error || 'Upload failed');
    } catch (error) {
      console.error('❌ Upload error:', error.message);
      throw error;
    }
  }

  /**
   * Get processing status
   * @param {string} fileId - Document UUID
   * @returns {Promise<Object>}
   */
  async getStatus(fileId) {
    try {
      const statusPath = this.baseUrl.includes('/ai-agent/')
        ? `${this.baseUrl}/status/${fileId}`
        : `${this.baseUrl}/status/${fileId}`;
      
      const response = await axios.get(
        statusPath,
        {
          headers: { 'X-Service-Name': this.serviceName }
        }
      );
      return response.data;
    } catch (error) {
      console.error('❌ Status check error:', error.message);
      throw error;
    }
  }

  /**
   * Wait for document to be processed
   * @param {string} fileId - Document UUID
   * @param {number} maxWaitSeconds - Maximum wait time in seconds
   * @param {number} pollIntervalSeconds - Polling interval in seconds
   * @returns {Promise<Object>}
   */
  async waitForProcessing(fileId, maxWaitSeconds = 300, pollIntervalSeconds = 5) {
    const startTime = Date.now();
    const maxWait = maxWaitSeconds * 1000;

    console.log(`⏳ Waiting for processing (max ${maxWaitSeconds}s)...`);

    while (Date.now() - startTime < maxWait) {
      const status = await this.getStatus(fileId);

      if (status.status === 'processed') {
        console.log(`✅ Processing complete: ${status.chunks} chunks`);
        return status;
      }

      if (status.status === 'error') {
        throw new Error(`Processing failed: ${status.error_message || status.current_operation}`);
      }

      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      console.log(`⏳ Processing... (${elapsed}s/${maxWaitSeconds}s) - ${status.processing_progress}% - ${status.current_operation}`);

      await new Promise(resolve => setTimeout(resolve, pollIntervalSeconds * 1000));
    }

    throw new Error(`Processing timeout after ${maxWaitSeconds} seconds`);
  }

  /**
   * Chat with documents
   * @param {string} question - User question
   * @param {string[]} fileIds - Optional: specific file IDs, or null to search all
   * @param {string} sessionId - Optional: session ID for conversation context
   * @param {string} llmName - Optional: LLM provider name
   * @returns {Promise<Object>}
   */
  async chat(question, fileIds = null, sessionId = null, llmName = 'gemini') {
    try {
      const body = { question, llm_name: llmName };
      if (fileIds && Array.isArray(fileIds) && fileIds.length > 0) {
        body.file_ids = fileIds;
      }
      if (sessionId) {
        body.session_id = sessionId;
      }

      console.log(`💬 Chatting: "${question.substring(0, 50)}..." (${fileIds ? fileIds.length : 'all'} files)`);

      const chatPath = this.baseUrl.includes('/ai-agent/')
        ? `${this.baseUrl}/chat`
        : `${this.baseUrl}/chat`;
      
      const response = await axios.post(
        chatPath,
        body,
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Name': this.serviceName
          }
        }
      );

      if (response.data.success) {
        console.log(`✅ Answer received: ${response.data.answer.length} chars, ${response.data.chunks_used} chunks from ${response.data.files_used} files`);
        return response.data;
      }
      throw new Error(response.data.error || 'Chat failed');
    } catch (error) {
      console.error('❌ Chat error:', error.message);
      throw error;
    }
  }

  /**
   * Get all processed documents
   * @returns {Promise<Object>}
   */
  async getAllDocuments() {
    try {
      const docsPath = this.baseUrl.includes('/ai-agent/')
        ? `${this.baseUrl}/documents`
        : `${this.baseUrl}/documents`;
      
      const response = await axios.get(
        docsPath,
        {
          headers: { 'X-Service-Name': this.serviceName }
        }
      );
      return response.data;
    } catch (error) {
      console.error('❌ Get documents error:', error.message);
      throw error;
    }
  }

  /**
   * Process an existing uploaded document
   * @param {string} fileId - Document UUID
   * @returns {Promise<Object>}
   */
  async processExistingDocument(fileId) {
    try {
      const processPath = this.baseUrl.includes('/ai-agent/')
        ? `${this.baseUrl}/process`
        : `${this.baseUrl}/process`;
      
      const response = await axios.post(
        processPath,
        { file_id: fileId },
        {
          headers: {
            'Content-Type': 'application/json',
            'X-Service-Name': this.serviceName
          }
        }
      );
      return response.data;
    } catch (error) {
      console.error('❌ Process existing document error:', error.message);
      throw error;
    }
  }
}

// ============================================================================
// Usage Examples
// ============================================================================

async function exampleUploadAndChat() {
  const client = new DocumentProcessingClient(AI_AGENT_BASE_URL, SERVICE_NAME);

  try {
    // 1. Upload a document
    console.log('\n📤 Step 1: Uploading document...');
    const uploadResult = await client.uploadDocument('./example-document.pdf');
    const fileId = uploadResult.file_id;
    console.log(`   File ID: ${fileId}`);

    // 2. Wait for processing
    console.log('\n⏳ Step 2: Waiting for processing...');
    const processed = await client.waitForProcessing(fileId, 300, 5);
    console.log(`   ✅ Completed: ${processed.chunks} chunks`);

    // 3. Chat with the specific document
    console.log('\n💬 Step 3: Chatting with document...');
    const chatResult = await client.chat(
      "What is the main topic of this document?",
      [fileId]
    );
    console.log(`   Answer: ${chatResult.answer.substring(0, 200)}...`);

    // 4. Continue conversation
    console.log('\n💬 Step 4: Continuing conversation...');
    const followUp = await client.chat(
      "Can you provide more details?",
      [fileId],
      chatResult.session_id
    );
    console.log(`   Answer: ${followUp.answer.substring(0, 200)}...`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

async function exampleChatWithAllDocuments() {
  const client = new DocumentProcessingClient(AI_AGENT_BASE_URL, SERVICE_NAME);

  try {
    // Get all documents
    console.log('\n📚 Getting all documents...');
    const allDocs = await client.getAllDocuments();
    console.log(`   Found ${allDocs.count} documents (${allDocs.processed_count} processed)`);

    if (allDocs.processed_count === 0) {
      console.log('   ⚠️ No processed documents available');
      return;
    }

    // Chat with all documents
    console.log('\n💬 Chatting with all documents...');
    const result = await client.chat(
      "Summarize the key points from all documents"
    );
    console.log(`   Answer: ${result.answer}`);
    console.log(`   Used ${result.chunks_used} chunks from ${result.files_used} files`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

async function exampleBatchUpload() {
  const client = new DocumentProcessingClient(AI_AGENT_BASE_URL, SERVICE_NAME);

  try {
    const files = ['./doc1.pdf', './doc2.pdf', './doc3.pdf'];
    const fileIds = [];

    // Upload multiple files
    console.log('\n📤 Uploading multiple files...');
    for (const file of files) {
      try {
        const result = await client.uploadDocument(file);
        fileIds.push(result.file_id);
        console.log(`   ✅ Uploaded: ${file} (${result.file_id})`);
      } catch (error) {
        console.error(`   ❌ Failed to upload ${file}:`, error.message);
      }
    }

    // Wait for all to process
    console.log('\n⏳ Waiting for all files to process...');
    await Promise.all(
      fileIds.map(fileId => 
        client.waitForProcessing(fileId, 300, 5).catch(err => {
          console.error(`   ❌ Failed to process ${fileId}:`, err.message);
        })
      )
    );

    // Chat with multiple specific documents
    console.log('\n💬 Chatting with multiple documents...');
    const result = await client.chat(
      "Compare and contrast the key findings in these documents",
      fileIds
    );
    console.log(`   Answer: ${result.answer}`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  }
}

// Export for use in other services
module.exports = DocumentProcessingClient;

// Run examples if executed directly
if (require.main === module) {
  (async () => {
    console.log('🚀 AI-Agent Service Integration Examples\n');
    console.log('=' .repeat(60));
    console.log(`Using base URL: ${AI_AGENT_BASE_URL}`);
    console.log(`Access method: ${GATEWAY_URL ? 'Gateway' : 'Direct'}\n`);
    console.log('=' .repeat(60));
    
    // Uncomment the example you want to run:
    // await exampleUploadAndChat();
    // await exampleChatWithAllDocuments();
    // await exampleBatchUpload();
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Examples completed');
    console.log('\n💡 Tip: Set GATEWAY_URL to use gateway, or AI_AGENT_SERVICE_URL for direct access');
  })();
}
