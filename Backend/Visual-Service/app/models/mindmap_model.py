"""
Mind Map Database Models
Handles database operations for mind maps and user node states
"""
import uuid
from datetime import datetime
from app.config.db import get_db_connection, return_db_connection

class MindMapModel:
    """Model for mind map operations"""
    
    @staticmethod
    def create_mindmap(user_id, file_id, title, nodes_data, session_id=None):
        """
        Create a new mind map and save all nodes
        
        Args:
            user_id: User ID who created the mind map
            file_id: Associated document file ID
            title: Mind map title
            nodes_data: JSON structure with nodes (from Gemini)
            session_id: Optional session ID to link mindmap to a chat session (must be valid UUID or None)
            
        Returns:
            dict: Created mind map with ID
        """
        conn = None
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            
            mindmap_id = str(uuid.uuid4())
            
            validated_session_id = None
            if session_id:
                try:
                    validated_uuid = uuid.UUID(str(session_id))
                    validated_session_id = str(validated_uuid)
                except (ValueError, AttributeError):
                    print(f"⚠️ Invalid session_id format '{session_id}', setting to None")
                    validated_session_id = None
            
            cur.execute("""
                INSERT INTO mindmaps (id, user_id, file_id, title, session_id, created_at, updated_at)
                VALUES (%s, %s::INTEGER, %s, %s, %s, %s, %s)
                RETURNING id, user_id, file_id, title, session_id, created_at, updated_at
            """, (mindmap_id, user_id, file_id, title, validated_session_id, datetime.utcnow(), datetime.utcnow()))
            
            mindmap = dict(cur.fetchone())
            
            MindMapModel._insert_nodes_recursive(cur, mindmap_id, None, nodes_data.get('children', []), 0)
            
            conn.commit()
            cur.close()
            
            return mindmap
            
        except Exception as e:
            if conn:
                conn.rollback()
            print(f"❌ Error creating mind map: {str(e)}")
            raise
        finally:
            if conn:
                return_db_connection(conn)
    
    @staticmethod
    def _insert_nodes_recursive(cursor, mindmap_id, parent_id, children, order_offset):
        """
        Recursively insert nodes into database
        
        Args:
            cursor: Database cursor
            mindmap_id: Mind map ID
            parent_id: Parent node ID (None for root)
            children: List of child nodes
            order_offset: Starting order number
        """
        for idx, child in enumerate(children):
            node_id = str(uuid.uuid4())
            content = child.get('text', '')
            order = order_offset + idx
            
            cursor.execute("""
                INSERT INTO mindmap_nodes (id, mindmap_id, parent_id, content, "order", created_at)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (node_id, mindmap_id, parent_id, content, order, datetime.utcnow()))
            
            if child.get('children'):
                MindMapModel._insert_nodes_recursive(
                    cursor, mindmap_id, node_id, child['children'], 0
                )
    
    @staticmethod
    def get_mindmap(mindmap_id, user_id):
        """
        Get mind map with all nodes and user's collapse state
        
        Args:
            mindmap_id: Mind map ID
            user_id: User ID for state retrieval
            
        Returns:
            dict: Mind map with nested node structure
        """
        conn = None
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            
            cur.execute("""
                SELECT id, user_id, file_id, title, session_id, created_at, updated_at
                FROM mindmaps
                WHERE id = %s AND user_id = %s
            """, (mindmap_id, user_id))
            
            mindmap_row = cur.fetchone()
            if not mindmap_row:
                return None
            
            mindmap = dict(mindmap_row)
            
            cur.execute("""
                SELECT 
                    n.id,
                    n.mindmap_id,
                    n.parent_id,
                    n.content,
                    n."order",
                    COALESCE(uns.is_collapsed, false) as is_collapsed
                FROM mindmap_nodes n
                LEFT JOIN user_node_state uns ON n.id = uns.node_id AND uns.user_id = %s
                WHERE n.mindmap_id = %s
                ORDER BY n."order"
            """, (user_id, mindmap_id))
            
            nodes = [dict(row) for row in cur.fetchall()]
            
            mindmap['nodes'] = MindMapModel._build_tree(nodes)
            
            cur.close()
            return mindmap
            
        except Exception as e:
            print(f"❌ Error getting mind map: {str(e)}")
            raise
        finally:
            if conn:
                return_db_connection(conn)
    
    @staticmethod
    def _build_tree(nodes):
        """
        Build nested tree structure from flat node list
        
        Args:
            nodes: List of node dictionaries
            
        Returns:
            list: Nested tree structure
        """
        node_dict = {node['id']: {**node, 'children': []} for node in nodes}
        
        root_nodes = []
        for node in nodes:
            node_obj = node_dict[node['id']]
            if node['parent_id'] is None:
                root_nodes.append(node_obj)
            else:
                if node['parent_id'] in node_dict:
                    node_dict[node['parent_id']]['children'].append(node_obj)
        
        def sort_children(node):
            node['children'].sort(key=lambda x: x.get('order', 0))
            for child in node['children']:
                sort_children(child)
            return node
        
        for root in root_nodes:
            sort_children(root)
        
        return root_nodes
    
    @staticmethod
    def get_mindmaps_by_file(file_id, user_id, session_id=None):
        """
        Get all mind maps for a specific file, optionally filtered by session
        
        Args:
            file_id: Document file ID
            user_id: User ID
            session_id: Optional session ID to filter by specific session
            
        Returns:
            list: List of mind maps
        """
        conn = None
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            
            if session_id:
                cur.execute("""
                    SELECT id, user_id, file_id, title, session_id, created_at, updated_at
                    FROM mindmaps
                    WHERE file_id = %s AND user_id = %s AND session_id = %s
                    ORDER BY created_at DESC
                """, (file_id, user_id, session_id))
            else:
                cur.execute("""
                    SELECT id, user_id, file_id, title, session_id, created_at, updated_at
                    FROM mindmaps
                    WHERE file_id = %s AND user_id = %s
                    ORDER BY created_at DESC
                """, (file_id, user_id))
            
            mindmaps = [dict(row) for row in cur.fetchall()]
            cur.close()
            return mindmaps
            
        except Exception as e:
            print(f"❌ Error getting mind maps by file: {str(e)}")
            raise
        finally:
            if conn:
                return_db_connection(conn)
    
    @staticmethod
    def get_mindmaps_by_session(session_id, user_id):
        """
        Get all mind maps for a specific session (metadata only)
        
        Args:
            session_id: Chat session ID
            user_id: User ID
            
        Returns:
            list: List of mind maps for the session
        """
        conn = None
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            
            cur.execute("""
                SELECT id, user_id, file_id, title, session_id, created_at, updated_at
                FROM mindmaps
                WHERE session_id = %s AND user_id = %s
                ORDER BY created_at DESC
            """, (session_id, user_id))
            
            mindmaps = [dict(row) for row in cur.fetchall()]
            cur.close()
            return mindmaps
            
        except Exception as e:
            print(f"❌ Error getting mind maps by session: {str(e)}")
            raise
        finally:
            if conn:
                return_db_connection(conn)
    
    @staticmethod
    def get_mindmap_by_session(session_id, user_id):
        """
        Get full mind map structure with nodes and user state for a specific session
        Uses efficient LEFT JOIN to aggregate data in a single query
        
        This method:
        1. Finds the mindmap by session_id
        2. Retrieves all nodes with user's collapse state using LEFT JOIN
        3. Builds the complete tree structure
        4. Returns data ready for frontend rendering
        
        Args:
            session_id: Chat session ID
            user_id: User ID for state retrieval
            
        Returns:
            dict: Complete mind map with nested node structure and user state, or None if not found
        """
        conn = None
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            
            cur.execute("""
                SELECT id, user_id, file_id, title, session_id, created_at, updated_at
                FROM mindmaps
                WHERE session_id = %s AND user_id = %s
                ORDER BY created_at DESC
                LIMIT 1
            """, (session_id, user_id))
            
            mindmap_row = cur.fetchone()
            if not mindmap_row:
                cur.close()
                return None
            
            mindmap = dict(mindmap_row)
            mindmap_id = mindmap['id']
            
            cur.execute("""
                SELECT 
                    n.id,
                    n.mindmap_id,
                    n.parent_id,
                    n.content,
                    n."order",
                    COALESCE(uns.is_collapsed, false) as is_collapsed
                FROM mindmap_nodes n
                LEFT JOIN user_node_state uns 
                    ON n.id = uns.node_id AND uns.user_id = %s
                WHERE n.mindmap_id = %s
                ORDER BY n."order"
            """, (user_id, mindmap_id))
            
            nodes = [dict(row) for row in cur.fetchall()]
            
            mindmap['nodes'] = MindMapModel._build_tree(nodes)
            
            cur.close()
            return mindmap
            
        except Exception as e:
            print(f"❌ Error getting mind map by session: {str(e)}")
            raise
        finally:
            if conn:
                return_db_connection(conn)
    
    @staticmethod
    def update_node_state(user_id, node_id, is_collapsed):
        """
        Update user's collapse state for a node
        
        Args:
            user_id: User ID
            node_id: Node ID
            is_collapsed: Collapse state (True/False)
            
        Returns:
            dict: Updated state
        """
        conn = None
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            
            if is_collapsed:
                cur.execute("""
                    INSERT INTO user_node_state (user_id, node_id, is_collapsed, last_updated)
                    VALUES (%s, %s, %s, %s)
                    ON CONFLICT (user_id, node_id)
                    DO UPDATE SET is_collapsed = %s, last_updated = %s
                    RETURNING user_id, node_id, is_collapsed, last_updated
                """, (user_id, node_id, is_collapsed, datetime.utcnow(), is_collapsed, datetime.utcnow()))
            else:
                cur.execute("""
                    DELETE FROM user_node_state
                    WHERE user_id = %s AND node_id = %s
                    RETURNING user_id, node_id, false as is_collapsed
                """, (user_id, node_id))
                
                result = cur.fetchone()
                if result:
                    return dict(result)
                else:
                    return {
                        'user_id': user_id,
                        'node_id': node_id,
                        'is_collapsed': False
                    }
            
            state = dict(cur.fetchone())
            conn.commit()
            cur.close()
            return state
            
        except Exception as e:
            if conn:
                conn.rollback()
            print(f"❌ Error updating node state: {str(e)}")
            raise
        finally:
            if conn:
                return_db_connection(conn)
    
    @staticmethod
    def delete_mindmap(mindmap_id, user_id):
        """
        Delete a mind map and all associated data
        
        Args:
            mindmap_id: Mind map ID
            user_id: User ID (for authorization)
            
        Returns:
            bool: True if deleted
        """
        conn = None
        try:
            conn = get_db_connection()
            cur = conn.cursor()
            
            cur.execute("""
                DELETE FROM user_node_state
                WHERE node_id IN (
                    SELECT id FROM mindmap_nodes WHERE mindmap_id = %s
                )
            """, (mindmap_id,))
            
            cur.execute("""
                DELETE FROM mindmap_nodes WHERE mindmap_id = %s
            """, (mindmap_id,))
            
            cur.execute("""
                DELETE FROM mindmaps
                WHERE id = %s AND user_id = %s
            """, (mindmap_id, user_id))
            
            deleted = cur.rowcount > 0
            conn.commit()
            cur.close()
            
            return deleted
            
        except Exception as e:
            if conn:
                conn.rollback()
            print(f"❌ Error deleting mind map: {str(e)}")
            raise
        finally:
            if conn:
                return_db_connection(conn)

