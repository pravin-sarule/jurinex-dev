"""
Database Configuration
Handles PostgreSQL database connection for Visual Service
"""
import os
import psycopg2
from psycopg2 import pool
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv

load_dotenv()

# Database connection pool
connection_pool = None

def init_db_pool():
    """Initialize database connection pool"""
    global connection_pool
    
    if connection_pool is None:
        try:
            connection_pool = psycopg2.pool.SimpleConnectionPool(
                minconn=1,
                maxconn=10,
                dsn=os.getenv('DATABASE_URL'),
                cursor_factory=RealDictCursor
            )
            print("✅ Database connection pool initialized")
        except Exception as e:
            print(f"❌ Failed to initialize database pool: {str(e)}")
            raise
    
    return connection_pool

def get_db_connection():
    """Get a database connection from the pool"""
    if connection_pool is None:
        init_db_pool()
    
    try:
        return connection_pool.getconn()
    except Exception as e:
        print(f"❌ Failed to get database connection: {str(e)}")
        raise

def return_db_connection(conn):
    """Return a database connection to the pool"""
    if connection_pool:
        connection_pool.putconn(conn)

def close_db_pool():
    """Close all database connections in the pool"""
    global connection_pool
    if connection_pool:
        connection_pool.closeall()
        connection_pool = None
        print("✅ Database connection pool closed")

