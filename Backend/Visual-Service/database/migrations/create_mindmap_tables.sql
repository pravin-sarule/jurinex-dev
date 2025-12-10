-- Mind Map Database Schema
-- Creates tables for storing mind maps and user node states

-- Table: mindmaps
-- Stores the main mind map records
CREATE TABLE IF NOT EXISTS mindmaps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id INTEGER NOT NULL,
    file_id UUID NOT NULL,
    title VARCHAR(500) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_mindmap_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_mindmap_file FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

-- Table: mindmap_nodes
-- Stores individual nodes in the mind map tree structure (Adjacency List Model)
CREATE TABLE IF NOT EXISTS mindmap_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mindmap_id UUID NOT NULL,
    parent_id UUID NULL,
    content TEXT NOT NULL,
    "order" INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_node_mindmap FOREIGN KEY (mindmap_id) REFERENCES mindmaps(id) ON DELETE CASCADE,
    CONSTRAINT fk_node_parent FOREIGN KEY (parent_id) REFERENCES mindmap_nodes(id) ON DELETE CASCADE
);

-- Table: user_node_state
-- Stores user-specific expand/collapse state for nodes
CREATE TABLE IF NOT EXISTS user_node_state (
    user_id INTEGER NOT NULL,
    node_id UUID NOT NULL,
    is_collapsed BOOLEAN DEFAULT true,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, node_id),
    CONSTRAINT fk_state_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_state_node FOREIGN KEY (node_id) REFERENCES mindmap_nodes(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_mindmaps_user_file ON mindmaps(user_id, file_id);
CREATE INDEX IF NOT EXISTS idx_mindmaps_file ON mindmaps(file_id);
CREATE INDEX IF NOT EXISTS idx_nodes_mindmap ON mindmap_nodes(mindmap_id);
CREATE INDEX IF NOT EXISTS idx_nodes_parent ON mindmap_nodes(parent_id);
CREATE INDEX IF NOT EXISTS idx_node_state_user ON user_node_state(user_id);
CREATE INDEX IF NOT EXISTS idx_node_state_node ON user_node_state(node_id);

-- Comments
COMMENT ON TABLE mindmaps IS 'Stores mind map metadata and associations';
COMMENT ON TABLE mindmap_nodes IS 'Stores mind map nodes in adjacency list format';
COMMENT ON TABLE user_node_state IS 'Stores user-specific expand/collapse preferences for nodes';

