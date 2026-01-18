-- Add project node type for user-created organizational nodes
-- Projects can contain sub-projects and reference articles/chunks

-- Extend node_type constraint to include 'project'
ALTER TABLE nodes DROP CONSTRAINT IF EXISTS nodes_node_type_check;
ALTER TABLE nodes ADD CONSTRAINT nodes_node_type_check
  CHECK (node_type IN ('article', 'chunk', 'project'));

-- Add title field for project display names
-- (articles derive their title from source_path, but projects need explicit titles)
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS title text;

-- Track creation source: 'user' for manually created, 'import' for vault imports
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS provenance text
  CHECK (provenance IS NULL OR provenance IN ('user', 'import'));

-- Allow null source_path for user-created nodes (projects have no file source)
ALTER TABLE nodes ALTER COLUMN source_path DROP NOT NULL;

-- Index for efficient project queries
CREATE INDEX IF NOT EXISTS nodes_project_idx ON nodes(node_type)
  WHERE node_type = 'project';

-- Index for provenance filtering
CREATE INDEX IF NOT EXISTS nodes_provenance_idx ON nodes(provenance)
  WHERE provenance IS NOT NULL;
