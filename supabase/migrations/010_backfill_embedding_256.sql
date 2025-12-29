-- Backfill embedding_256 from existing 1536-dim embeddings
-- Truncates to first 256 dimensions and re-normalizes
-- Idempotent: only updates rows where embedding_256 is NULL

-- Helper function to truncate and normalize a vector
create or replace function truncate_normalize_vector(v vector, dims int)
returns vector
language sql immutable
as $$
  with arr as (
    -- Convert vector to text, strip brackets, split into array
    select string_to_array(
      trim(both '[]' from v::text),
      ','
    )::float[] as vals
  ),
  truncated as (
    select val, ordinality as idx
    from arr, unnest(vals[1:dims]) with ordinality as t(val, ordinality)
  ),
  with_norm as (
    select val, idx, sqrt(sum(val * val) over ()) as norm
    from truncated
  )
  select (array_agg(val / nullif(norm, 0) order by idx))::vector
  from with_norm;
$$;

-- Apply to all keywords
update keywords
set embedding_256 = truncate_normalize_vector(embedding, 256)
where embedding is not null
  and embedding_256 is null;

-- Clean up helper function
drop function truncate_normalize_vector(vector, int);
