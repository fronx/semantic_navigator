-- Update search_similar to return matched keywords with their similarity scores
-- Must drop first because return type is changing
drop function if exists search_similar(vector(1536), float, int, text);

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
  with node_matches as (
    -- Direct node matches
    select
      nodes.id,
      nodes.content,
      nodes.summary,
      nodes.node_type,
      nodes.source_path,
      1 - (nodes.embedding <=> query_embedding) as similarity
    from nodes
    where
      nodes.embedding is not null
      and (filter_node_type is null or nodes.node_type = filter_node_type)
      and 1 - (nodes.embedding <=> query_embedding) > match_threshold
  ),
  keyword_matches as (
    -- Keyword matches with their similarity scores
    select
      keywords.node_id,
      keywords.keyword,
      1 - (keywords.embedding <=> query_embedding) as keyword_similarity
    from keywords
    where
      keywords.embedding is not null
      and 1 - (keywords.embedding <=> query_embedding) > match_threshold
  ),
  nodes_from_keywords as (
    -- Nodes found via keyword matches
    select
      nodes.id,
      nodes.content,
      nodes.summary,
      nodes.node_type,
      nodes.source_path,
      max(km.keyword_similarity) as similarity
    from keyword_matches km
    join nodes on nodes.id = km.node_id
    where filter_node_type is null or nodes.node_type = filter_node_type
    group by nodes.id, nodes.content, nodes.summary, nodes.node_type, nodes.source_path
  ),
  all_matching_nodes as (
    -- Combine both sources, keeping best similarity per node
    select id, content, summary, node_type, source_path, max(similarity) as similarity
    from (
      select * from node_matches
      union all
      select * from nodes_from_keywords
    ) combined
    group by id, content, summary, node_type, source_path
  ),
  with_keywords as (
    -- Attach matching keywords to each result
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
