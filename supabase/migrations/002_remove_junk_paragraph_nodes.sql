-- Migration: Remove junk paragraph nodes
--
-- This migration removes paragraph nodes that contain only:
-- 1. Image markdown: ![alt](url)
-- 2. Single brackets: [ or ]
-- 3. Broken link closes: ](url)
--
-- These were created by the old parser which split content by \n\n
-- and didn't properly handle multi-line image links from Substack exports.
-- The new AST-based parser filters these out during ingestion.

-- First, delete containment edges where junk nodes are children
DELETE FROM containment_edges
WHERE child_id IN (
  SELECT id FROM nodes
  WHERE node_type = 'paragraph'
  AND content IS NOT NULL
  AND (
    -- Image-only: ![...](...)
    content ~ '^!\[[^\]]*\]\([^)]*\)$'
    -- Single bracket
    OR content ~ '^[\[\]]$'
    -- Broken link close: ](url)
    OR content ~ '^\]\([^)]*\)$'
  )
);

-- Then delete the junk nodes themselves
DELETE FROM nodes
WHERE node_type = 'paragraph'
AND content IS NOT NULL
AND (
  -- Image-only: ![...](...)
  content ~ '^!\[[^\]]*\]\([^)]*\)$'
  -- Single bracket
  OR content ~ '^[\[\]]$'
  -- Broken link close: ](url)
  OR content ~ '^\]\([^)]*\)$'
);
