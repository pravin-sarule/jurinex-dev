"""
Visual Service - Main Application Entry Point
Flask application for generating flowcharts from documents using Gemini 1.5 Flash
"""
from flask import Flask, jsonify
from flask_cors import CORS
from datetime import datetime
import os
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Import routes
from app.routes.visual_routes import visual_bp
from app.config.db import init_db_pool, close_db_pool

# Initialize Flask application
app = Flask(__name__)

# Initialize database connection pool
try:
    init_db_pool()
    print("✅ Database connection pool initialized")
except Exception as e:
    print(f"⚠️ Warning: Database initialization failed: {str(e)}")
    print("⚠️ Mind map features will not be available without database connection")

# Cleanup on shutdown
import atexit
atexit.register(close_db_pool)

# Configure CORS (Cross-Origin Resource Sharing)
# This allows the frontend to make requests to this service
allowed_origins = [
    'http://localhost:5173',
    'https://jurinex.netlify.app',
    'https://microservicefrontend.netlify.app'
]
CORS(app, origins=allowed_origins)


# Register Blueprints
# Blueprints organize routes into modules for better code organization
app.register_blueprint(visual_bp, url_prefix='/api/visual')


@app.route('/api/test-route', methods=['GET'])
def test_route():
    """
    Test route to verify service is running
    
    GET /api/test-route
    
    Returns: Simple success message
    """
    return jsonify({'message': '✅ Visual Service is working!'})


@app.route('/health', methods=['GET'])
def health_check():
    """
    Health check endpoint for monitoring and load balancers
    
    GET /health
    
    Returns: Service health status with timestamp
    """
    return jsonify({
        'status': 'healthy',
        'service': 'visual-service',
        'timestamp': datetime.utcnow().isoformat()
    }), 200


if __name__ == '__main__':
    """
    Application entry point
    
    Runs the Flask development server on the specified port.
    In production, use a WSGI server like Gunicorn.
    """
    # Get port from environment variable or use default
    port = int(os.getenv('PORT', 8081))
    
    # Get debug mode from environment (default: False)
    debug_mode = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    
    # Start the Flask server
    # host='0.0.0.0' allows external connections (required for Docker/Cloud)
    app.run(host='0.0.0.0', port=port, debug=debug_mode)
