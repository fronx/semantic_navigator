-- Migration: Move content storage to paragraphs only
--
-- This migration changes the data model so that only paragraph nodes store
-- their content. Articles and sections now rely solely on their summary field
-- for display, reducing storage and clarifying the semantic hierarchy.
--
-- The summary field already contains AI-generated summaries for articles and
-- sections, making the full content redundant at those levels.

-- First, allow NULL values in the content column
ALTER TABLE nodes ALTER COLUMN content DROP NOT NULL;

-- Remove content from article and section nodes (keep only for paragraphs)
UPDATE nodes
SET content = NULL
WHERE node_type IN ('article', 'section');

-- Add comment to the column for documentation
COMMENT ON COLUMN nodes.content IS 'Full text content. Only populated for paragraph nodes; articles and sections use summary instead.';
