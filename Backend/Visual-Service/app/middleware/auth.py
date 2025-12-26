"""
Authentication Middleware
Handles JWT token verification and user authentication
"""
import jwt
from functools import wraps
from flask import request, jsonify
import os

JWT_SECRET = os.getenv('JWT_SECRET', 'your-secret-key')


def token_required(f):
    """
    Decorator to protect routes that require authentication
    
    This decorator:
    1. Extracts JWT token from Authorization header
    2. Verifies the token signature and expiration
    3. Decodes user information and attaches it to request.user
    4. Returns 401 error if token is missing or invalid
    
    Usage:
        @token_required
        def my_protected_route():
            user_id = request.user.get('id')
            ...
    
    Args:
        f: The route function to protect
        
    Returns:
        Decorated function that includes authentication check
    """
    @wraps(f)
    def decorated(*args, **kwargs):
        token = None
        
        if 'Authorization' in request.headers:
            auth_header = request.headers['Authorization']
            try:
                token = auth_header.split(' ')[1]
            except IndexError:
                return jsonify({'error': 'Invalid token format'}), 401
        
        if not token:
            return jsonify({'error': 'Not authorized, no token'}), 401
        
        try:
            decoded = jwt.decode(token, JWT_SECRET, algorithms=['HS256'])
            
            request.user = {
                'id': decoded.get('id') or decoded.get('userId'),
                'username': decoded.get('username'),
                'email': decoded.get('email')
            }
        except jwt.ExpiredSignatureError:
            return jsonify({'error': 'Token has expired'}), 401
        except jwt.InvalidTokenError:
            return jsonify({'error': 'Invalid token'}), 401
        
        return f(*args, **kwargs)
    
    return decorated

