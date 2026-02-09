-- Update get_keyword_graph to work with canonical keywords schema
-- Now that keywords are canonical (one per unique text), we need to join through
-- keyword_occurrences to get node relationships

create or replace function get_keyword_graph(
  filter_node_type text default 'article',
  max_edges_per_node int default 5,
  min_similarity float default 0.3
)
returns table (
  keyword_id uuid,
  keyword_text text,
  node_id uuid,
  node_path text,
  node_size int,
  similar_keyword_id uuid,
  similar_keyword_text text,
  similar_node_id uuid,
  similar_node_path text,
  similar_node_size int,
  similarity float
)
language sql stable
as $$
  with filtered_keywords as (
    -- Join keywords with occurrences to filter by node_type
    select
      k.id as keyword_id,
      k.keyword,
      k.embedding,
      ko.node_id,
      n.source_path,
      coalesce(
        char_length(n.summary),
        char_length(n.content),
        0
      ) as size
    from keywords k
    join keyword_occurrences ko on ko.keyword_id = k.id
    join nodes n on n.id = ko.node_id
    where ko.node_type = filter_node_type
      and k.embedding is not null
  )
  select
    fk.keyword_id,
    fk.keyword as keyword_text,
    fk.node_id,
    fk.source_path as node_path,
    fk.size as node_size,
    neighbors.keyword_id as similar_keyword_id,
    neighbors.keyword as similar_keyword_text,
    neighbors.node_id as similar_node_id,
    neighbors.source_path as similar_node_path,
    neighbors.size as similar_node_size,
    1 - (fk.embedding <=> neighbors.embedding) as similarity
  from filtered_keywords fk
  cross join lateral (
    -- Find top-K most similar keywords from same node_type
    select
      k2.id as keyword_id,
      k2.keyword,
      ko2.node_id,
      n2.source_path,
      coalesce(
        char_length(n2.summary),
        char_length(n2.content),
        0
      ) as size,
      k2.embedding
    from keywords k2
    join keyword_occurrences ko2 on ko2.keyword_id = k2.id
    join nodes n2 on n2.id = ko2.node_id
    where ko2.node_type = filter_node_type
      and k2.embedding is not null
      and ko2.node_id != fk.node_id
    order by fk.embedding <=> k2.embedding
    limit max_edges_per_node
  ) neighbors
  where 1 - (fk.embedding <=> neighbors.embedding) >= min_similarity;
$$;

-- Update test_keyword_search to work with canonical keywords
create or replace function test_keyword_search(
  query_embedding vector(1536),
  match_count int default 10
)
returns table (keyword_id uuid, keyword text, node_id uuid, similarity float)
language sql stable
as $$
  select
    k.id,
    k.keyword,
    ko.node_id,
    1 - (k.embedding <=> query_embedding) as similarity
  from keywords k
  join keyword_occurrences ko on ko.keyword_id = k.id
  where k.embedding is not null
  order by k.embedding <=> query_embedding
  limit match_count;
$$;

-- Update search_similar to work with canonical keywords
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

-- Update find_similar_keywords_for_node to work with canonical keywords
create or replace function find_similar_keywords_for_node(
  node_embedding vector(1536),
  match_count int default 5,
  min_similarity float default 0.3,
  filter_node_type text default 'article'
)
returns table (
  keyword text,
  similarity float
)
language sql stable
as $$
  select
    k.keyword,
    1 - (k.embedding <=> node_embedding) as similarity
  from keywords k
  join keyword_occurrences ko on ko.keyword_id = k.id
  where ko.node_type = filter_node_type
    and k.embedding is not null
  order by k.embedding <=> node_embedding
  limit match_count;
$$;
