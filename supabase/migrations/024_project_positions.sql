-- Add position columns for project nodes in the graph view
-- Projects can be freely positioned by the user, unlike other nodes which are force-directed

ALTER TABLE nodes ADD COLUMN IF NOT EXISTS position_x real;
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS position_y real;

-- Index for efficient project queries with positions
CREATE INDEX IF NOT EXISTS nodes_project_position_idx ON nodes(node_type, position_x, position_y)
  WHERE node_type = 'project';
