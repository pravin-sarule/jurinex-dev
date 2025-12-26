"""
Visual Controller
Handles HTTP requests and responses for flowchart generation endpoints
"""
from flask import request, jsonify
from datetime import datetime
from app.services.document_service import DocumentService
from app.services.gemini_service import GeminiService
from app.services.content_processor import ContentProcessor


class VisualController:
    """
    Controller class for visual/flowchart generation endpoints
    
    This controller handles:
    - Request validation
    - Service orchestration
    - Response formatting
    - Error handling
    """
    
    @staticmethod
    def generate_flowchart():
        """
        Generate flowchart from a single document
        
        This endpoint:
        1. Validates request (file_id required)
        2. Fetches document data from Document Service
        3. Processes document content
        4. Generates flowchart using Gemini 1.5 Flash
        5. Returns flowchart description and Mermaid syntax
        
        Request Body:
            {
                "file_id": "uuid",              # Required: Document file ID
                "prompt": "custom prompt",       # Optional: Custom generation prompt
                "flowchart_type": "process"      # Optional: Type of flowchart (default: "process")
            }
            
        Returns:
            JSON response with:
            - success: bool
            - file_id: str
            - document_name: str
            - flowchart_type: str
            - flowchart_description: str (AI-generated description)
            - mermaid_syntax: str or None (extracted Mermaid code)
            - generated_at: ISO timestamp
            - user_id: str
        """
        try:
            user_id = request.user.get('id')
            if not user_id:
                print("[VisualController] Error: No user ID in request")
                return jsonify({'error': 'Unauthorized'}), 401
            
            data = request.get_json()
            if not data:
                print("[VisualController] Error: No request body provided")
                return jsonify({'error': 'Request body is required'}), 400
                
            file_id = data.get('file_id')
            prompt = data.get('prompt')
            flowchart_type = data.get('flowchart_type', 'process')
            
            print(f"[VisualController] Request - file_id: {file_id}, user_id: {user_id}, type: {flowchart_type}")
            
            if not file_id:
                print("[VisualController] Error: file_id is missing")
                return jsonify({'error': 'file_id is required'}), 400
            
            auth_header = request.headers.get('Authorization', '')
            if not auth_header:
                print("[VisualController] Error: No Authorization header")
                return jsonify({'error': 'Authorization header is required'}), 401
            
            try:
                document_data = DocumentService.get_file_complete(file_id, auth_header)
                
                if not document_data.get('success'):
                    return jsonify({'error': 'Document not found or access denied'}), 404
                    
            except ValueError as e:
                error_message = str(e)
                print(f"[VisualController] Document Service Error: {error_message}")
                
                if 'not found' in error_message.lower():
                    return jsonify({
                        'error': 'Document not found',
                        'details': error_message
                    }), 404
                elif 'access denied' in error_message.lower():
                    return jsonify({
                        'error': 'Access denied to document',
                        'details': error_message
                    }), 403
                elif 'timeout' in error_message.lower():
                    return jsonify({
                        'error': 'Document service request timed out',
                        'details': error_message
                    }), 504
                elif 'connect' in error_message.lower() or 'connection' in error_message.lower():
                    return jsonify({
                        'error': 'Cannot connect to document service',
                        'details': error_message,
                        'suggestion': 'Please ensure Document Service is running and DOCUMENT_SERVICE_URL is correct'
                    }), 503
                else:
                    return jsonify({
                        'error': 'Failed to fetch document from document service',
                        'details': error_message
                    }), 500
            except Exception as e:
                error_message = str(e)
                print(f"[VisualController] Unexpected Error fetching document: {error_message}")
                return jsonify({
                    'error': 'Unexpected error while fetching document',
                    'details': error_message
                }), 500
            
            document_content = ContentProcessor.extract_document_content(document_data)
            
            try:
                flowchart_result = GeminiService.generate_flowchart(
                    document_content=document_content,
                    prompt=prompt,
                    flowchart_type=flowchart_type
                )
            except ValueError as e:
                return jsonify({
                    'error': 'Failed to generate flowchart',
                    'details': str(e)
                }), 500
            
            file = document_data.get('file', {})
            return jsonify({
                'success': True,
                'file_id': file_id,
                'document_name': file.get('originalname', ''),
                'flowchart_type': flowchart_type,
                'flowchart_description': flowchart_result['flowchart_description'],
                'mermaid_syntax': flowchart_result['mermaid_syntax'],
                'image_url': None,  # Can be added later if image generation is implemented
                'generated_at': datetime.utcnow().isoformat(),
                'user_id': user_id
            }), 200
            
        except Exception as e:
            print(f"❌ generate_flowchart error: {str(e)}")
            return jsonify({
                'error': 'Failed to generate flowchart',
                'details': str(e)
            }), 500
    
    @staticmethod
    def generate_mindmap():
        """
        Generate mind map from a single document
        
        Returns JSON structure compatible with frontend mind map renderers
        """
        try:
            user_id = request.user.get('id')
            if not user_id:
                print("[VisualController] Error: No user ID in request")
                return jsonify({'error': 'Unauthorized'}), 401
            
            data = request.get_json()
            if not data:
                print("[VisualController] Error: No request body provided")
                return jsonify({'error': 'Request body is required'}), 400
                
            file_id = data.get('file_id')
            prompt = data.get('prompt')
            session_id = data.get('session_id')  # Optional session ID to link mindmap to chat session
            
            print(f"[VisualController] Mind map request - file_id: {file_id}, user_id: {user_id}, session_id: {session_id}")
            
            if not file_id:
                print("[VisualController] Error: file_id is missing")
                return jsonify({'error': 'file_id is required'}), 400
            
            auth_header = request.headers.get('Authorization', '')
            if not auth_header:
                print("[VisualController] Error: No Authorization header")
                return jsonify({'error': 'Authorization header is required'}), 401
            
            try:
                document_data = DocumentService.get_file_complete(file_id, auth_header)
                
                if not document_data.get('success'):
                    return jsonify({'error': 'Document not found or access denied'}), 404
                    
            except ValueError as e:
                error_message = str(e)
                print(f"[VisualController] Document Service Error: {error_message}")
                
                if 'not found' in error_message.lower():
                    return jsonify({
                        'error': 'Document not found',
                        'details': error_message
                    }), 404
                elif 'access denied' in error_message.lower():
                    return jsonify({
                        'error': 'Access denied to document',
                        'details': error_message
                    }), 403
                else:
                    return jsonify({
                        'error': 'Failed to fetch document from document service',
                        'details': error_message
                    }), 500
            except Exception as e:
                error_message = str(e)
                print(f"[VisualController] Unexpected Error fetching document: {error_message}")
                return jsonify({
                    'error': 'Unexpected error while fetching document',
                    'details': error_message
                }), 500
            
            document_content = ContentProcessor.extract_document_content(document_data)
            
            try:
                mindmap_result = GeminiService.generate_mindmap(
                    document_content=document_content,
                    prompt=prompt
                )
                
                mindmap_data = mindmap_result.get('mindmap_data', {})
                title = mindmap_data.get('title', f"Mind Map - {document_data.get('file', {}).get('originalname', 'Document')}")
                
                from app.models.mindmap_model import MindMapModel
                saved_mindmap = MindMapModel.create_mindmap(
                    user_id=user_id,
                    file_id=file_id,
                    title=title,
                    nodes_data=mindmap_data,
                    session_id=session_id
                )
                
                full_mindmap = MindMapModel.get_mindmap(saved_mindmap['id'], user_id)
                
                formatted_response = VisualController._format_mindmap_response(full_mindmap)
                
                return jsonify({
                    'success': True,
                    'mindmap_id': saved_mindmap['id'],
                    'file_id': file_id,
                    'session_id': session_id,
                    'document_name': document_data.get('file', {}).get('originalname', ''),
                    'data': formatted_response,  # NotebookLM format
                    'model_used': mindmap_result.get('model_used'),
                    'generated_at': datetime.utcnow().isoformat(),
                    'user_id': user_id
                }), 200
                
            except ValueError as e:
                error_message = str(e)
                print(f"[VisualController] Gemini Error: {error_message}")
                return jsonify({
                    'error': 'Failed to generate mind map',
                    'details': error_message
                }), 500
            except Exception as e:
                error_message = str(e)
                print(f"[VisualController] Unexpected Error generating mind map: {error_message}")
                return jsonify({
                    'error': 'Unexpected error while generating mind map',
                    'details': error_message
                }), 500
                
        except Exception as e:
            print(f"❌ generate_mindmap error: {str(e)}")
            return jsonify({
                'error': 'Failed to generate mind map',
                'details': str(e)
            }), 500
    
    @staticmethod
    def _format_mindmap_response(mindmap):
        """
        Format mind map data in NotebookLM format
        
        Args:
            mindmap: Mind map dict from database
            
        Returns:
            dict: Formatted response matching NotebookLM structure
        """
        if not mindmap or not mindmap.get('nodes'):
            return None
        
        root_nodes = mindmap['nodes']
        if not root_nodes:
            return None
        
        def format_node(node):
            formatted = {
                'id': node['id'],
                'label': node['content'],
                'isCollapsed': node.get('is_collapsed', False),
                'children': []
            }
            
            for child in node.get('children', []):
                formatted['children'].append(format_node(child))
            
            return formatted
        
        if len(root_nodes) == 1:
            return format_node(root_nodes[0])
        else:
            return {
                'id': mindmap['id'],
                'label': mindmap.get('title', 'Mind Map'),
                'isCollapsed': False,
                'children': [format_node(node) for node in root_nodes]
            }
    
    @staticmethod
    def get_mindmap():
        """
        Get mind map by ID or session_id with user state (NotebookLM format)
        
        Supports two query methods:
        1. GET /api/visual/mindmap?mindmap_id={id} - Get by mindmap ID
        2. GET /api/visual/mindmap?session_id={id} - Get by session ID (for loading previous chats)
        """
        try:
            user_id = request.user.get('id')
            if not user_id:
                return jsonify({'error': 'Unauthorized'}), 401
            
            session_id = request.args.get('session_id')
            if session_id:
                return VisualController.get_mindmap_by_session()
            
            mindmap_id = request.args.get('mindmap_id') or request.view_args.get('mindmap_id')
            if not mindmap_id:
                return jsonify({'error': 'mindmap_id or session_id is required'}), 400
            
            from app.models.mindmap_model import MindMapModel
            mindmap = MindMapModel.get_mindmap(mindmap_id, user_id)
            
            if not mindmap:
                return jsonify({'error': 'Mind map not found'}), 404
            
            formatted_response = VisualController._format_mindmap_response(mindmap)
            
            created_at = mindmap.get('created_at')
            updated_at = mindmap.get('updated_at')
            if hasattr(created_at, 'isoformat'):
                created_at = created_at.isoformat()
            if hasattr(updated_at, 'isoformat'):
                updated_at = updated_at.isoformat()
            
            return jsonify({
                'success': True,
                'mindmap_id': mindmap_id,
                'data': formatted_response,
                'metadata': {
                    'title': mindmap.get('title'),
                    'file_id': mindmap.get('file_id'),
                    'session_id': mindmap.get('session_id'),
                    'created_at': created_at,
                    'updated_at': updated_at
                }
            }), 200
            
        except Exception as e:
            print(f"❌ get_mindmap error: {str(e)}")
            return jsonify({
                'error': 'Failed to retrieve mind map',
                'details': str(e)
            }), 500
    
    @staticmethod
    def get_mindmaps_by_file():
        """Get all mind maps for a file, optionally filtered by session"""
        try:
            user_id = request.user.get('id')
            if not user_id:
                return jsonify({'error': 'Unauthorized'}), 401
            
            file_id = request.args.get('file_id')
            if not file_id:
                return jsonify({'error': 'file_id is required'}), 400
            
            session_id = request.args.get('session_id')  # Optional session filter
            
            from app.models.mindmap_model import MindMapModel
            mindmaps = MindMapModel.get_mindmaps_by_file(file_id, user_id, session_id)
            
            return jsonify({
                'success': True,
                'file_id': file_id,
                'session_id': session_id,
                'mindmaps': mindmaps
            }), 200
            
        except Exception as e:
            print(f"❌ get_mindmaps_by_file error: {str(e)}")
            return jsonify({
                'error': 'Failed to retrieve mind maps',
                'details': str(e)
            }), 500
    
    @staticmethod
    def get_mindmaps_by_session():
        """Get all mind maps for a specific session (metadata only)"""
        try:
            user_id = request.user.get('id')
            if not user_id:
                return jsonify({'error': 'Unauthorized'}), 401
            
            session_id = request.args.get('session_id')
            if not session_id:
                return jsonify({'error': 'session_id is required'}), 400
            
            from app.models.mindmap_model import MindMapModel
            mindmaps = MindMapModel.get_mindmaps_by_session(session_id, user_id)
            
            return jsonify({
                'success': True,
                'session_id': session_id,
                'mindmaps': mindmaps
            }), 200
            
        except Exception as e:
            print(f"❌ get_mindmaps_by_session error: {str(e)}")
            return jsonify({
                'error': 'Failed to retrieve mind maps for session',
                'details': str(e)
            }), 500
    
    @staticmethod
    def get_mindmap_by_session():
        """
        Get full mind map structure with nodes and user state for a session
        This endpoint is designed for loading previous chats - it automatically
        fetches and returns the complete mindmap ready for rendering.
        
        Endpoint: GET /api/visual/mindmap?session_id={session_id}
        
        Returns the complete mindmap structure with:
        - All nodes in tree format
        - User's collapse/expand state for each node
        - Metadata (title, file_id, session_id, timestamps)
        - Formatted in NotebookLM format for immediate frontend rendering
        """
        try:
            user_id = request.user.get('id')
            if not user_id:
                return jsonify({'error': 'Unauthorized'}), 401
            
            session_id = request.args.get('session_id')
            
            query_user_id = request.args.get('user_id')
            if query_user_id and query_user_id != str(user_id):
                return jsonify({'error': 'User ID mismatch'}), 403
            
            if not session_id:
                return jsonify({'error': 'session_id is required'}), 400
            
            from app.models.mindmap_model import MindMapModel
            
            mindmap = MindMapModel.get_mindmap_by_session(session_id, user_id)
            
            if not mindmap:
                return jsonify({
                    'success': True,
                    'session_id': session_id,
                    'data': None,
                    'message': 'No mindmap found for this session'
                }), 200
            
            formatted_response = VisualController._format_mindmap_response(mindmap)
            
            created_at = mindmap.get('created_at')
            updated_at = mindmap.get('updated_at')
            if hasattr(created_at, 'isoformat'):
                created_at = created_at.isoformat()
            if hasattr(updated_at, 'isoformat'):
                updated_at = updated_at.isoformat()
            
            return jsonify({
                'success': True,
                'session_id': session_id,
                'mindmap_id': mindmap.get('id'),
                'data': formatted_response,  # Full mindmap structure ready for rendering
                'metadata': {
                    'title': mindmap.get('title'),
                    'file_id': mindmap.get('file_id'),
                    'session_id': mindmap.get('session_id'),
                    'created_at': created_at,
                    'updated_at': updated_at
                }
            }), 200
            
        except Exception as e:
            print(f"❌ get_mindmap_by_session error: {str(e)}")
            return jsonify({
                'error': 'Failed to retrieve mind map for session',
                'details': str(e)
            }), 500
    
    @staticmethod
    def update_node_state():
        """Update user's collapse state for a node"""
        try:
            user_id = request.user.get('id')
            if not user_id:
                return jsonify({'error': 'Unauthorized'}), 401
            
            data = request.get_json()
            node_id = data.get('node_id')
            is_collapsed = data.get('is_collapsed', True)
            
            if not node_id:
                return jsonify({'error': 'node_id is required'}), 400
            
            from app.models.mindmap_model import MindMapModel
            state = MindMapModel.update_node_state(user_id, node_id, is_collapsed)
            
            return jsonify({
                'success': True,
                'node_id': node_id,
                'is_collapsed': state.get('is_collapsed', False)
            }), 200
            
        except Exception as e:
            print(f"❌ update_node_state error: {str(e)}")
            return jsonify({
                'error': 'Failed to update node state',
                'details': str(e)
            }), 500
    
    @staticmethod
    def delete_mindmap():
        """Delete a mind map"""
        try:
            user_id = request.user.get('id')
            if not user_id:
                return jsonify({'error': 'Unauthorized'}), 401
            
            mindmap_id = request.view_args.get('mindmap_id') if hasattr(request, 'view_args') and request.view_args else request.args.get('mindmap_id')
            if not mindmap_id:
                return jsonify({'error': 'mindmap_id is required'}), 400
            
            from app.models.mindmap_model import MindMapModel
            deleted = MindMapModel.delete_mindmap(mindmap_id, user_id)
            
            if not deleted:
                return jsonify({'error': 'Mind map not found or access denied'}), 404
            
            return jsonify({
                'success': True,
                'message': 'Mind map deleted successfully'
            }), 200
            
        except Exception as e:
            print(f"❌ delete_mindmap error: {str(e)}")
            return jsonify({
                'error': 'Failed to delete mind map',
                'details': str(e)
            }), 500
    
    @staticmethod
    def generate_flowchart_multi():
        """
        Generate flowchart from multiple documents
        
        This endpoint:
        1. Validates request (file_ids array required)
        2. Fetches data for all documents from Document Service
        3. Combines content from all documents
        4. Generates unified flowchart using Gemini 1.5 Flash
        5. Returns combined flowchart description
        
        Request Body:
            {
                "file_ids": ["uuid1", "uuid2", ...],  # Required: Array of document file IDs
                "prompt": "custom prompt",             # Optional: Custom generation prompt
                "flowchart_type": "process"            # Optional: Type of flowchart
            }
            
        Returns:
            JSON response with:
            - success: bool
            - file_ids: list of file IDs processed
            - documents: list of document metadata
            - flowchart_type: str
            - flowchart_description: str (AI-generated description)
            - mermaid_syntax: str or None
            - generated_at: ISO timestamp
            - user_id: str
        """
        try:
            user_id = request.user.get('id')
            if not user_id:
                return jsonify({'error': 'Unauthorized'}), 401
            
            data = request.get_json()
            file_ids = data.get('file_ids')
            prompt = data.get('prompt')
            flowchart_type = data.get('flowchart_type', 'process')
            
            if not file_ids or not isinstance(file_ids, list) or len(file_ids) == 0:
                return jsonify({'error': 'file_ids array is required'}), 400
            
            auth_header = request.headers.get('Authorization', '')
            
            valid_documents = DocumentService.get_multiple_files_complete(file_ids, auth_header)
            
            if not valid_documents:
                return jsonify({'error': 'No valid documents found'}), 404
            
            combined_content = ContentProcessor.combine_multiple_documents(valid_documents)
            
            try:
                multi_doc_prompt = prompt or f'''Generate a comprehensive {flowchart_type} flowchart that combines information from multiple documents. 
Create a unified flowchart that visualizes the relationships, processes, and key information across all documents.'''
                
                flowchart_result = GeminiService.generate_flowchart(
                    document_content=combined_content,
                    prompt=multi_doc_prompt,
                    flowchart_type=flowchart_type
                )
            except ValueError as e:
                return jsonify({
                    'error': 'Failed to generate flowchart',
                    'details': str(e)
                }), 500
            
            documents_metadata = [
                {
                    'id': doc.get('file', {}).get('id'),
                    'name': doc.get('file', {}).get('originalname', '')
                }
                for doc in valid_documents
            ]
            
            return jsonify({
                'success': True,
                'file_ids': file_ids,
                'documents': documents_metadata,
                'flowchart_type': flowchart_type,
                'flowchart_description': flowchart_result['flowchart_description'],
                'mermaid_syntax': flowchart_result['mermaid_syntax'],
                'generated_at': datetime.utcnow().isoformat(),
                'user_id': user_id
            }), 200
            
        except Exception as e:
            print(f"❌ generate_flowchart_multi error: {str(e)}")
            return jsonify({
                'error': 'Failed to generate flowchart',
                'details': str(e)
            }), 500

