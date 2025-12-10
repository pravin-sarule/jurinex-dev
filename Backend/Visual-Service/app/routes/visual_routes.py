"""
Visual Routes
Defines API endpoints for flowchart generation
"""
from flask import Blueprint, jsonify
from datetime import datetime
from app.middleware.auth import token_required
from app.controllers.visual_controller import VisualController

# Create Blueprint for visual routes
# Blueprint allows organizing routes into modules
visual_bp = Blueprint('visual', __name__)


@visual_bp.route('/generate-flowchart', methods=['POST'])
@token_required  # Require authentication for this endpoint
def generate_flowchart_route():
    """
    Route: Generate flowchart from a single document
    
    POST /api/visual/generate-flowchart
    
    This route handles requests to generate flowcharts from individual documents.
    It delegates to VisualController for business logic.
    
    Authentication: Required (JWT token)
    
    Returns: JSON response with flowchart data
    """
    return VisualController.generate_flowchart()


@visual_bp.route('/generate-flowchart-multi', methods=['POST'])
@token_required  # Require authentication for this endpoint
def generate_flowchart_multi_route():
    """
    Route: Generate flowchart from multiple documents
    
    POST /api/visual/generate-flowchart-multi
    
    This route handles requests to generate unified flowcharts from multiple documents.
    It delegates to VisualController for business logic.
    
    Authentication: Required (JWT token)
    
    Returns: JSON response with combined flowchart data
    """
    return VisualController.generate_flowchart_multi()


@visual_bp.route('/generate-mindmap', methods=['POST'])
@token_required  # Require authentication for this endpoint
def generate_mindmap_route():
    """
    Route: Generate mind map from a single document
    
    POST /api/visual/generate-mindmap
    
    This route handles requests to generate mind maps from documents.
    Returns JSON structure compatible with frontend mind map renderers (NotebookLM format).
    
    Authentication: Required (JWT token)
    
    Request Body:
        {
            "file_id": "uuid",           # Required: Document file ID
            "prompt": "custom prompt"     # Optional: Custom generation prompt
        }
    
    Returns: JSON response with mind map data structure (NotebookLM format)
    """
    return VisualController.generate_mindmap()


@visual_bp.route('/mindmap', methods=['GET'])
@token_required
def get_mindmap_route():
    """
    Route: Get mind map by ID or session_id
    
    GET /api/visual/mindmap?mindmap_id=uuid
    GET /api/visual/mindmap?session_id=uuid
    
    Returns mind map in NotebookLM format with user's collapse state.
    
    When using session_id, this is the primary endpoint for loading mindmaps
    when opening previous chat sessions. It automatically fetches the complete
    mindmap structure with all nodes and user state ready for rendering.
    """
    return VisualController.get_mindmap()


@visual_bp.route('/mindmaps', methods=['GET'])
@token_required
def get_mindmaps_by_file_route():
    """
    Route: Get all mind maps for a file, optionally filtered by session
    
    GET /api/visual/mindmaps?file_id=uuid&session_id=uuid
    
    Returns list of all mind maps associated with a file.
    Optionally filters by session_id if provided.
    """
    return VisualController.get_mindmaps_by_file()


@visual_bp.route('/mindmaps/session', methods=['GET'])
@token_required
def get_mindmaps_by_session_route():
    """
    Route: Get all mind maps for a specific session
    
    GET /api/visual/mindmaps/session?session_id=uuid
    
    Returns list of all mind maps associated with a chat session.
    Similar to how past chats are fetched by session.
    """
    return VisualController.get_mindmaps_by_session()


@visual_bp.route('/mindmap/node/state', methods=['PUT', 'POST'])
@token_required
def update_node_state_route():
    """
    Route: Update node collapse state
    
    PUT/POST /api/visual/mindmap/node/state
    
    Request Body:
        {
            "node_id": "uuid",
            "is_collapsed": true/false
        }
    
    Updates user's collapse preference for a node.
    """
    return VisualController.update_node_state()


@visual_bp.route('/mindmap/<mindmap_id>', methods=['DELETE'])
@token_required
def delete_mindmap_route(mindmap_id):
    """
    Route: Delete mind map
    
    DELETE /api/visual/mindmap/{mindmap_id}
    
    Deletes a mind map and all associated data.
    """
    return VisualController.delete_mindmap()

