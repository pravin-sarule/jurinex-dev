const axios = require('axios');

class WordService {
  /**
   * Option A (BEST & SIMPLE - MVP): Get Word Online launch URL
   * Opens Word Online directly - Microsoft handles license verification
   * No Graph API calls needed - simplest approach
   */
  static getWordOnlineUrl() {
    // Simple redirect to Word Online
    // Microsoft handles license checking internally
    return "https://www.office.com/launch/word";
  }

  /**
   * Option B (Advanced - Optional Fallback): Create document in OneDrive via Graph API
   * Uses Files.ReadWrite scope (not Files.ReadWrite.All)
   * Falls back to Option A if this fails
   */
  static async createDocumentInOneDrive(accessToken, title, content) {
    try {
      console.log('[WordService] Creating Word document:', { title, contentLength: content?.length });
      
      // Convert HTML content to plain text for Word document
      // Remove HTML tags and decode entities
      const plainText = typeof content === 'string' 
        ? content.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
        : String(content || '');
      
      // Create a new Word document in user's OneDrive
      // This will use the user's own Microsoft license when opened in Word Online
      // Use Files.ReadWrite scope (not Files.ReadWrite.All per architecture)
      const createUrl = 'https://graph.microsoft.com/v1.0/me/drive/root/children';
      
      const response = await axios.post(
        createUrl,
        {
          name: `${title}.docx`,
          file: {},
          '@microsoft.graph.conflictBehavior': 'rename',
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );
      
      const fileId = response.data.id;
      let webUrl = response.data.webUrl;
      
      // Get the proper Word Online editor URL
      // The webUrl from Graph API should work, but we'll ensure it opens in edit mode
      try {
        // Use Microsoft Graph to get the file's webDavUrl or construct Word Online URL
        // For OneDrive personal: use onedrive.live.com
        // For OneDrive for Business: use the sharepoint URL with Word Online
        
        // Try to get the file details with webUrl
        const itemResponse = await axios.get(
          `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          }
        );
        
        webUrl = itemResponse.data.webUrl;
        
        // If the URL doesn't open in Word Online editor, construct it
        // For personal OneDrive accounts
        if (webUrl.includes('onedrive.live.com') && !webUrl.includes('edit')) {
          // Extract the file path or use file ID
          const filePath = itemResponse.data.webUrl.split('/drive/')[1] || itemResponse.data.id;
          webUrl = `https://onedrive.live.com/edit.aspx?id=${fileId}`;
        }
        
        // For SharePoint/OneDrive for Business - ensure it opens in Word Online
        if (webUrl.includes('sharepoint.com') && !webUrl.includes('/_layouts/15/WopiFrame.aspx')) {
          // Construct Word Online editor URL
          // Format: https://{tenant}.sharepoint.com/_layouts/15/WopiFrame.aspx?sourcedoc={fileId}&action=default
          const siteId = itemResponse.data.parentReference?.siteId;
          const driveId = itemResponse.data.parentReference?.driveId;
          
          if (webUrl.includes('/sites/')) {
            // Extract the SharePoint site URL
            const siteMatch = webUrl.match(/(https:\/\/[^\/]+)/);
            if (siteMatch) {
              webUrl = `${siteMatch[1]}/_layouts/15/WopiFrame.aspx?sourcedoc=${fileId}&action=default`;
            }
          }
        }
        
      } catch (err) {
        console.warn('[WordService] Could not get enhanced webUrl, using default:', err.message);
        // Use the default webUrl - it should still work to open the document
      }
      
      // Write content to the document using Word API for proper formatting
      // Use createUploadSession for large files or direct content update
      const updateUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`;
      
      try {
        // Create a simple .docx content structure
        // For proper Word documents, you'd need to create actual .docx binary
        // For now, we'll create a basic document that can be edited in Word Online
        await axios.put(
          updateUrl,
          plainText,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'text/plain',
            },
          }
        );
      } catch (updateError) {
        console.warn('[WordService] Could not update document content immediately:', updateError.message);
        // Document is created, user can edit it in Word Online
      }
      
      console.log('[WordService] Word document created successfully:', {
        fileId,
        name: response.data.name,
        webUrl
      });
      
      return {
        id: fileId,
        name: response.data.name,
        webUrl: webUrl, // This URL will open in Word Online using user's own license
        createdDateTime: response.data.createdDateTime,
      };
    } catch (error) {
      console.error('[WordService] Error creating Word document:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      throw new Error(`Failed to create Word document: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Get Word document details
   */
  static async getDocument(accessToken, fileId) {
    try {
      const url = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}`;
      
      const response = await axios.get(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      
      return {
        id: response.data.id,
        name: response.data.name,
        webUrl: response.data.webUrl,
        createdDateTime: response.data.createdDateTime,
        lastModifiedDateTime: response.data.lastModifiedDateTime,
      };
    } catch (error) {
      console.error('Error getting Word document:', error.response?.data || error.message);
      throw new Error('Failed to get Word document');
    }
  }

  /**
   * Fetch document content from Word (OneDrive)
   * Downloads the .docx file and extracts text content
   * 
   * Note: Microsoft Graph API doesn't directly support format conversion for .docx files.
   * For production, consider using:
   * - mammoth.js (converts .docx to HTML)
   * - docx library (parses .docx structure)
   * - Or use Microsoft Graph API's /workbook/range endpoint for Excel (not applicable here)
   * 
   * For MVP, we'll download the file and return a message that content needs manual sync
   * or use a simple text extraction approach.
   */
  static async fetchDocumentContent(accessToken, fileId) {
    try {
      console.log('[WordService] Fetching document content from Word:', { fileId });
      
      // Get document metadata first
      const docInfo = await this.getDocument(accessToken, fileId);
      
      // Try to download the file content
      // Note: This will download the binary .docx file
      // For proper text extraction, you'd need a library like mammoth.js
      try {
        const downloadUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`;
        
        const response = await axios.get(downloadUrl, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          responseType: 'arraybuffer',
        });
        
        // For MVP: Return a message that content sync requires manual action
        // In production, use mammoth.js or similar to extract text from .docx
        // 
        // Example with mammoth.js (would need to install: npm install mammoth):
        // const mammoth = require('mammoth');
        // const result = await mammoth.convertToHtml({ arrayBuffer: response.data });
        // return { content: result.value, format: 'html' };
        
        console.log('[WordService] Document downloaded, but .docx parsing not implemented');
        console.log('[WordService] File size:', response.data.byteLength, 'bytes');
        
        // Return a helpful message
        return {
          content: `<p><strong>Document synced from Word</strong></p>
                    <p>File: ${docInfo.name}</p>
                    <p>Last modified: ${new Date(docInfo.lastModifiedDateTime).toLocaleString()}</p>
                    <p><em>Note: Full content extraction requires additional processing. The document is available in Word Online.</em></p>
                    <p>To view the full content, please open the document in Word Online using the "Re-open in Word" button.</p>`,
          format: 'html',
          note: 'Content extraction limited - use Word Online for full content',
          fileName: docInfo.name,
          lastModified: docInfo.lastModifiedDateTime
        };
        
      } catch (downloadError) {
        console.error('[WordService] Error downloading document:', downloadError.message);
        throw downloadError;
      }
    } catch (error) {
      console.error('[WordService] Error fetching document content:', {
        message: error.message,
        status: error.response?.status,
        data: error.response?.data
      });
      throw new Error(`Failed to fetch document content: ${error.response?.data?.error?.message || error.message}`);
    }
  }

  /**
   * Re-open existing Word document in Word Online
   * Returns the webUrl for the document
   */
  static async reopenWordDocument(accessToken, fileId) {
    try {
      const document = await this.getDocument(accessToken, fileId);
      
      // Ensure the webUrl opens in Word Online editor
      let webUrl = document.webUrl;
      
      // If it's a OneDrive personal account, ensure it opens in edit mode
      if (webUrl.includes('onedrive.live.com') && !webUrl.includes('edit')) {
        webUrl = `https://onedrive.live.com/edit.aspx?id=${fileId}`;
      }
      
      // If it's SharePoint/OneDrive for Business, ensure Word Online editor
      if (webUrl.includes('sharepoint.com') && !webUrl.includes('/_layouts/15/WopiFrame.aspx')) {
        // Try to construct Word Online editor URL
        const siteMatch = webUrl.match(/(https:\/\/[^\/]+)/);
        if (siteMatch) {
          webUrl = `${siteMatch[1]}/_layouts/15/WopiFrame.aspx?sourcedoc=${fileId}&action=default`;
        }
      }
      
      return {
        webUrl: webUrl,
        fileId: fileId,
        name: document.name
      };
    } catch (error) {
      console.error('[WordService] Error reopening Word document:', error.message);
      throw new Error(`Failed to reopen Word document: ${error.message}`);
    }
  }

  /**
   * Update Word document content
   */
  static async updateDocument(accessToken, fileId, content) {
    try {
      const url = `https://graph.microsoft.com/v1.0/me/drive/items/${fileId}/content`;
      
      await axios.put(
        url,
        content,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'text/plain',
          },
        }
      );
      
      return { success: true };
    } catch (error) {
      console.error('Error updating Word document:', error.response?.data || error.message);
      throw new Error('Failed to update Word document');
    }
  }
}

module.exports = WordService;
