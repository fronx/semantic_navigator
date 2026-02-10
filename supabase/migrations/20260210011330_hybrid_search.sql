-- Enable pg_trgm extension for fuzzy text matching
create extension if not exists pg_trgm;

-- Add GIN index for fast trigram similarity search on keywords
create index keywords_keyword_trgm_idx on keywords
  using gin (keyword gin_trgm_ops);

-- Hybrid keyword search function: combines text and semantic matching
create or replace function hybrid_keyword_search(
  query_text text,
  query_embedding vector(1536),
  match_count int default 20,
  text_threshold float default 0.3,
  semantic_threshold float default 0.7,
  text_boost float default 0.5
)
returns table (
  keyword_id uuid,
  keyword text,
  text_similarity float,
  semantic_similarity float,
  combined_score float,
  match_type text
)
language sql stable
as $$
  with
  -- Text matches using trigram similarity
  text_matches as (
    select
      k.id as keyword_id,
      k.keyword,
      case
        when lower(k.keyword) = lower(query_text) then 1.0  -- exact match
        when lower(k.keyword) like lower(query_text) || '%' then 0.95  -- prefix match
        else similarity(k.keyword, query_text)  -- trigram similarity
      end as text_sim,
      k.embedding
    from keywords k
    where
      -- Fast text filter using trigram index
      k.keyword % query_text  -- % is trigram similarity operator
      or lower(k.keyword) = lower(query_text)
      or lower(k.keyword) like lower(query_text) || '%'
  ),
  -- Semantic matches using vector similarity
  semantic_matches as (
    select
      k.id as keyword_id,
      k.keyword,
      1 - (k.embedding <=> query_embedding) as semantic_sim,
      k.embedding
    from keywords k
    where k.embedding is not null
    order by k.embedding <=> query_embedding
    limit match_count * 2  -- Get extra for merging
  ),
  -- Combine both sources
  combined as (
    select
      coalesce(tm.keyword_id, sm.keyword_id) as keyword_id,
      coalesce(tm.keyword, sm.keyword) as keyword,
      coalesce(tm.text_sim, 0.0) as text_similarity,
      coalesce(sm.semantic_sim, 0.0) as semantic_similarity,
      -- Weighted scoring: text matches get boost
      coalesce(tm.text_sim, 0.0) * (1.0 + text_boost) +
        coalesce(sm.semantic_sim, 0.0) as combined_score,
      case
        when tm.text_sim >= 0.95 and sm.semantic_sim > semantic_threshold
          then 'both'
        when tm.text_sim >= 0.95 then 'exact'
        when tm.text_sim >= text_threshold then 'fuzzy'
        when sm.semantic_sim >= semantic_threshold then 'semantic'
        else 'weak'
      end as match_type
    from text_matches tm
    full outer join semantic_matches sm on tm.keyword_id = sm.keyword_id
    where
      coalesce(tm.text_sim, 0.0) >= text_threshold
      or coalesce(sm.semantic_sim, 0.0) >= semantic_threshold
  )
  select * from combined
  where match_type != 'weak'
  order by combined_score desc
  limit match_count;
$$;

-- Hybrid search function: wraps search_similar with hybrid keyword matching
create or replace function search_similar_hybrid(
  query_text text,
  query_embedding vector(1536),
  match_threshold float default 0.5,
  match_count int default 10,
  filter_node_type text default null,
  use_hybrid bool default true
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
  -- Get keyword matches (hybrid or semantic-only)
  keyword_matches as (
    select
      ko.node_id,
      hks.keyword,
      hks.combined_score as keyword_similarity,
      hks.match_type
    from hybrid_keyword_search(
      query_text,
      query_embedding,
      match_count * 5,
      0.3,   -- text_threshold
      0.7,   -- semantic_threshold
      0.5    -- text_boost
    ) hks
    join keyword_occurrences ko on ko.keyword_id = hks.keyword_id
  ),
  -- Nodes from keyword matches
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
  -- Direct node matches (keep this for nodes without keywords)
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
    limit match_count * 2
  ),
  node_matches as (
    select * from top_node_candidates
    where similarity > match_threshold
  ),
  -- Combine both sources
  all_matching_nodes as (
    select id, content, summary, node_type, source_path, max(similarity) as similarity
    from (
      select * from node_matches
      union all
      select * from nodes_from_keywords
    ) combined
    group by id, content, summary, node_type, source_path
  ),
  -- Attach matching keywords with match type info
  with_keywords as (
    select
      amn.*,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'keyword', km.keyword,
            'similarity', km.keyword_similarity,
            'matchType', km.match_type
          )
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
