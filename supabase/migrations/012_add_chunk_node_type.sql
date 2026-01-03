-- Replace section/paragraph hierarchy with semantic chunks
-- Chunks are text segments identified by semantic analysis

-- Drop and recreate the check constraint (article + chunk only)
ALTER TABLE nodes DROP CONSTRAINT IF EXISTS nodes_node_type_check;
ALTER TABLE nodes ADD CONSTRAINT nodes_node_type_check
  CHECK (node_type IN ('article', 'chunk'));

-- Add chunk_type column for semantic classification (e.g., "problem statement", "worked example")
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS chunk_type text;

-- Add heading_context column to store the heading path for chunks
-- Provides context like ["Introduction", "Background"] for display
ALTER TABLE nodes ADD COLUMN IF NOT EXISTS heading_context text[];

-- Index for filtering by chunk_type
CREATE INDEX IF NOT EXISTS nodes_chunk_type_idx ON nodes(chunk_type) WHERE chunk_type IS NOT NULL;
