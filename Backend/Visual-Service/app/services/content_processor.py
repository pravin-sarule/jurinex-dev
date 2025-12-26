"""
Content Processor Service
Handles processing and formatting of document content for flowchart generation
"""
from typing import Dict, List


class ContentProcessor:
    """
    Service class for processing document content
    
    This service handles:
    - Extracting and formatting document content from API responses
    - Combining content from multiple documents
    - Preparing content for AI processing
    """
    
    @staticmethod
    def extract_document_content(document_data):
        """
        Extract and format content from a single document
        
        This method processes document data from Document Service and creates
        a formatted string suitable for AI processing. It prioritizes:
        1. Document summary (if available)
        2. Document chunks (text segments)
        3. Full text content (fallback)
        
        Args:
            document_data (dict): Complete document data from Document Service
                Expected structure:
                - file: dict with file metadata
                - chunks: list of document chunks
                - summary: optional document summary
                
        Returns:
            str: Formatted document content ready for AI processing
        """
        file = document_data.get('file', {})
        chunks = document_data.get('chunks', [])
        summary = file.get('summary', '')
        
        document_content = ''
        
        if summary:
            document_content += f'Document Summary: {summary}\n\n'
        
        if chunks:
            document_content += 'Document Content:\n'
            for index, chunk in enumerate(chunks[:20]):
                document_content += f'\n[Chunk {index + 1}]\n{chunk.get("content", "")}\n'
        elif file.get('full_text_content'):
            content = file.get('full_text_content', '')[:5000]
            document_content += f'Document Content:\n{content}'
        
        return document_content
    
    @staticmethod
    def combine_multiple_documents(documents_data):
        """
        Combine content from multiple documents into a single string
        
        This method processes multiple documents and creates a unified
        content string that can be used for multi-document flowchart generation.
        
        Args:
            documents_data (list): List of document data dictionaries from Document Service
            
        Returns:
            str: Combined content from all documents, formatted with document separators
        """
        combined_content = ''
        
        for index, doc_data in enumerate(documents_data):
            file = doc_data.get('file', {})
            chunks = doc_data.get('chunks', [])
            
            combined_content += f'\n=== Document {index + 1}: {file.get("originalname", "")} ===\n'
            
            if file.get('summary'):
                combined_content += f'Summary: {file.get("summary")}\n\n'
            
            if chunks:
                for chunk_index, chunk in enumerate(chunks[:10]):
                    combined_content += f'[Chunk {chunk_index + 1}]\n{chunk.get("content", "")}\n\n'
        
        return combined_content

