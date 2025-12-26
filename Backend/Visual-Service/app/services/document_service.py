"""
Document Service Integration
Handles communication with the Document Service API to fetch document data
"""
import requests
import os

DOCUMENT_SERVICE_URL = os.getenv('DOCUMENT_SERVICE_URL', 'http://localhost:8080')


class DocumentService:
    """
    Service class for interacting with Document Service API
    
    This service handles:
    - Fetching complete document data (metadata, chunks, chats)
    - Error handling and retries
    - User authentication token forwarding
    """
    
    @staticmethod
    def get_file_complete(file_id, auth_token):
        """
        Fetch complete file data from Document Service
        
        This method retrieves:
        - File metadata (name, size, status, etc.)
        - All document chunks (text segments)
        - Chat history associated with the file
        - Folder chat history (if file is in a folder)
        - Processing job status
        
        Args:
            file_id (str): UUID of the file to fetch
            auth_token (str): JWT token for authentication (format: "Bearer <token>")
            
        Returns:
            dict: Complete file data including:
                - success: bool
                - file: dict with file metadata
                - chunks: list of document chunks
                - chats: list of chat history
                - folder_chats: list of folder-level chats
                - processing_job: dict with job status
                
        Raises:
            requests.exceptions.RequestException: If API call fails
            ValueError: If file_id is invalid or access denied
        """
        try:
            print(f"[DocumentService] Fetching file {file_id} from {DOCUMENT_SERVICE_URL}")
            response = requests.get(
                f'{DOCUMENT_SERVICE_URL}/api/files/file/{file_id}/complete',
                headers={
                    'Authorization': auth_token,
                    'Content-Type': 'application/json'
                },
                timeout=30  # 30 second timeout
            )
            
            print(f"[DocumentService] Response status: {response.status_code}")
            
            if response.status_code == 404:
                error_msg = response.json().get('error', 'Document not found') if response.text else 'Document not found'
                print(f"[DocumentService] 404 Error: {error_msg}")
                raise ValueError(f'Document not found: {error_msg}')
            if response.status_code == 403:
                error_msg = response.json().get('error', 'Access denied') if response.text else 'Access denied'
                print(f"[DocumentService] 403 Error: {error_msg}")
                raise ValueError(f'Access denied to document: {error_msg}')
            if response.status_code != 200:
                error_text = response.text[:500] if response.text else 'Unknown error'
                print(f"[DocumentService] {response.status_code} Error: {error_text}")
                raise ValueError(f'Failed to fetch document (Status {response.status_code}): {error_text}')
            
            result = response.json()
            print(f"[DocumentService] Successfully fetched document data")
            return result
            
        except requests.exceptions.Timeout:
            error_msg = 'Request to document service timed out'
            print(f"[DocumentService] Timeout: {error_msg}")
            raise ValueError(error_msg)
        except requests.exceptions.ConnectionError as e:
            error_msg = f'Failed to connect to document service: {str(e)}'
            print(f"[DocumentService] Connection Error: {error_msg}")
            raise ValueError(error_msg)
        except ValueError:
            raise
        except requests.exceptions.RequestException as e:
            error_msg = f'Error fetching document: {str(e)}'
            print(f"[DocumentService] Request Exception: {error_msg}")
            raise ValueError(error_msg)
        except Exception as e:
            error_msg = f'Unexpected error fetching document: {str(e)}'
            print(f"[DocumentService] Unexpected Error: {error_msg}")
            raise ValueError(error_msg)
    
    @staticmethod
    def get_multiple_files_complete(file_ids, auth_token):
        """
        Fetch complete data for multiple files from Document Service
        
        This method fetches data for multiple files in parallel and returns
        only the successfully fetched documents.
        
        Args:
            file_ids (list): List of file UUIDs to fetch
            auth_token (str): JWT token for authentication
            
        Returns:
            list: List of successfully fetched document data dictionaries
        """
        valid_documents = []
        
        for file_id in file_ids:
            try:
                document_data = DocumentService.get_file_complete(file_id, auth_token)
                if document_data and document_data.get('success'):
                    valid_documents.append(document_data)
            except Exception as e:
                print(f"❌ Error fetching document {file_id}: {str(e)}")
                continue
        
        return valid_documents

