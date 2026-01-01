const { processMultimodalRAG } = require('../services/multimodalRagService');

/**
 * Multimodal RAG Controller with Server-Sent Events (SSE)
 */
async function processRAGStream(req, res) {
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  // Flush headers immediately
  res.flushHeaders();
  
  const sendSSE = (event, data) => {
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
      res.flush && res.flush(); // Flush if available
    } catch (err) {
      console.error('Error sending SSE:', err);
    }
  };
  
  const sendStatus = (status, message) => {
    sendSSE('status', { status, message, timestamp: new Date().toISOString() });
  };
  
  const sendChunk = (chunk) => {
    sendSSE('chunk', { text: chunk });
  };
  
  const sendError = (error) => {
    sendSSE('error', { error: error.message || error });
    res.end();
  };
  
  const sendComplete = (data) => {
    sendSSE('complete', data);
    res.end();
  };
  
  // Handle client disconnect
  req.on('close', () => {
    console.log('Client disconnected from SSE stream');
    res.end();
  });
  
  try {
    const { query } = req.body;
    const userId = req.user?.id;
    
    if (!query || !query.trim()) {
      sendError({ message: 'Query is required' });
      return;
    }
    
    // Status callback function
    const statusCallback = (status, message) => {
      sendStatus(status, message);
    };
    
    // Process the multimodal RAG pipeline
    const result = await processMultimodalRAG(query, statusCallback);
    
    if (!result.success) {
      sendError({ message: result.error || 'Processing failed' });
      return;
    }
    
    // Stream the response text word by word
    const words = result.response.split(' ');
    for (let i = 0; i < words.length; i++) {
      // Check if client is still connected
      if (req.closed || res.closed) {
        console.log('Client disconnected during streaming');
        return;
      }
      
      const chunk = (i === 0 ? '' : ' ') + words[i];
      sendChunk(chunk);
      // Small delay for streaming effect
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    // Send final data
    sendComplete({
      citations: result.citations,
      sourceUrl: result.sourceUrl,
      extractionStats: result.extractionStats,
      documentTitle: result.documentTitle
    });
    
  } catch (error) {
    console.error('Multimodal RAG stream error:', error);
    sendError({ message: error.message || 'Internal server error' });
  }
}

/**
 * Non-streaming endpoint (for testing)
 */
async function processRAG(req, res) {
  try {
    const { query } = req.body;
    const userId = req.user?.id;
    
    if (!query || !query.trim()) {
      return res.status(400).json({ error: 'Query is required' });
    }
    
    const statusUpdates = [];
    const statusCallback = (status, message) => {
      statusUpdates.push({ status, message, timestamp: new Date().toISOString() });
    };
    
    const result = await processMultimodalRAG(query, statusCallback);
    
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'Processing failed' });
    }
    
    res.json({
      success: true,
      response: result.response,
      citations: result.citations,
      sourceUrl: result.sourceUrl,
      extractionStats: result.extractionStats,
      documentTitle: result.documentTitle,
      statusUpdates
    });
  } catch (error) {
    console.error('Multimodal RAG error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

module.exports = {
  processRAGStream,
  processRAG
};

