-- Drop the old 2-param overload of get_precomputed_clusters.
-- Migration 028 added a 3-param version (with filter_node_type) but didn't
-- drop the original, causing PostgREST PGRST203 ambiguity errors.
DROP FUNCTION IF EXISTS get_precomputed_clusters(real, text[]);
