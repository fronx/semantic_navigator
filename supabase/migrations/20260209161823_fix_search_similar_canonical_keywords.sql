-- Fix search_similar to work with canonical keywords schema
-- The previous migration's DROP statement didn't remove all overloads
-- This migration ensures a clean slate before recreating the function

-- Drop all overloads of search_similar with CASCADE
drop function if exists search_similar cascade;

-- Recreate search_similar with canonical keywords support
create or replace function search_similar(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 10,
  filter_node_type text default null
)
returns table (
  id uuid,
  content text,
  summary text,
  node_type text,
  source_path text,
  similarity float,
  matched_keywords jsonb
)
language sql stable
as $$
  with
  -- Get top node candidates using index (ORDER BY + LIMIT, no threshold in WHERE)
  top_node_candidates as (
    select
      n.id,
      n.content,
      n.summary,
      n.node_type,
      n.source_path,
      1 - (n.embedding <=> query_embedding) as similarity
    from nodes n
    where
      n.embedding is not null
      and (filter_node_type is null or n.node_type = filter_node_type)
    order by n.embedding <=> query_embedding
    limit match_count * 3  -- Get extra candidates to allow for merging with keyword results
  ),
  -- Filter by threshold after getting candidates
  node_matches as (
    select * from top_node_candidates
    where similarity > match_threshold
  ),
  -- Get top keyword candidates using index (ORDER BY + LIMIT, no threshold in WHERE)
  top_keyword_candidates as (
    select
      k.id as keyword_id,
      ko.node_id,
      k.keyword,
      1 - (k.embedding <=> query_embedding) as keyword_similarity
    from keywords k
    join keyword_occurrences ko on ko.keyword_id = k.id
    where k.embedding is not null
    order by k.embedding <=> query_embedding
    limit match_count * 5  -- Get extra keyword candidates
  ),
  -- Filter keywords by threshold
  keyword_matches as (
    select * from top_keyword_candidates
    where keyword_similarity > match_threshold
  ),
  -- Nodes found via keyword matches
  nodes_from_keywords as (
    select
      n.id,
      n.content,
      n.summary,
      n.node_type,
      n.source_path,
      max(km.keyword_similarity) as similarity
    from keyword_matches km
    join nodes n on n.id = km.node_id
    where filter_node_type is null or n.node_type = filter_node_type
    group by n.id, n.content, n.summary, n.node_type, n.source_path
  ),
  -- Combine both sources, keeping best similarity per node
  all_matching_nodes as (
    select id, content, summary, node_type, source_path, max(similarity) as similarity
    from (
      select * from node_matches
      union all
      select * from nodes_from_keywords
    ) combined
    group by id, content, summary, node_type, source_path
  ),
  -- Attach matching keywords to each result
  with_keywords as (
    select
      amn.*,
      coalesce(
        jsonb_agg(
          jsonb_build_object('keyword', km.keyword, 'similarity', km.keyword_similarity)
          order by km.keyword_similarity desc
        ) filter (where km.keyword is not null),
        '[]'::jsonb
      ) as matched_keywords
    from all_matching_nodes amn
    left join keyword_matches km on km.node_id = amn.id
    group by amn.id, amn.content, amn.summary, amn.node_type, amn.source_path, amn.similarity
  )
  select * from with_keywords
  order by similarity desc
  limit match_count;
$$;
