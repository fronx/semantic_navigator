-- Add localStorage backups table for automatic cloud backup of client settings and cache

CREATE TABLE IF NOT EXISTS localstorage_backups (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data JSONB NOT NULL,
  -- Metadata for filtering/cleanup
  keys TEXT[] NOT NULL, -- List of localStorage keys in this backup
  size_bytes INTEGER NOT NULL -- Total size of serialized data
);

-- Index for querying recent backups
CREATE INDEX IF NOT EXISTS localstorage_backups_created_at_idx
  ON localstorage_backups (created_at DESC);

-- Function to auto-cleanup old backups (keep last 30 days)
CREATE OR REPLACE FUNCTION cleanup_old_localstorage_backups()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM localstorage_backups
  WHERE created_at < NOW() - INTERVAL '30 days';
END;
$$;
