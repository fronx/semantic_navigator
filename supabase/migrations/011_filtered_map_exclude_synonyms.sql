-- Filtered map:
-- 1. Filter articles by query match (any keyword similar enough to query)
-- 2. Show keywords that: (a) aren't synonyms of query, (b) have cross-article connections

drop function if exists get_filtered_map(vector(256), float, float);

create or replace function get_filtered_map(
  query_embedding_256 vector(256),
  match_threshold float default 0.75,      -- articles must have a keyword this similar to query
  keyword_similarity_threshold float default 0.75
)
returns table (
  keyword_id text,
  keyword_text text,
  article_id text,
  article_path text,
  article_size int,
  similar_keyword_id text,
  similar_keyword_text text,
  similar_article_id text,
  similar_article_path text,
  similar_article_size int,
  similarity float
)
language sql stable
as $$
  -- Step 1: Find articles that match the query (have at least one keyword >= threshold)
  with matching_articles as (
    select distinct n.id as article_id
    from nodes n
    join keywords k on k.node_id = n.id
    where n.node_type = 'article'
      and k.embedding_256 is not null
      and 1 - (k.embedding_256 <=> query_embedding_256) >= match_threshold
  ),
  -- Step 2: Get keywords from matching articles, excluding synonyms of the query
  filtered_keywords as (
    select k.id, k.keyword, k.node_id, k.embedding_256
    from keywords k
    join matching_articles ma on ma.article_id = k.node_id
    where k.embedding_256 is not null
      -- Exclude synonyms (too similar to query)
      and 1 - (k.embedding_256 <=> query_embedding_256) < match_threshold
  )
  -- Step 3: Return keyword pairs with cross-article similarity
  select
    k1.id::text as keyword_id,
    k1.keyword as keyword_text,
    n1.id::text as article_id,
    n1.source_path as article_path,
    coalesce(char_length(n1.summary), 0)::int as article_size,
    k2.id::text as similar_keyword_id,
    k2.keyword as similar_keyword_text,
    n2.id::text as similar_article_id,
    n2.source_path as similar_article_path,
    coalesce(char_length(n2.summary), 0)::int as similar_article_size,
    (1 - (k1.embedding_256 <=> k2.embedding_256))::float as similarity
  from filtered_keywords k1
  join nodes n1 on n1.id = k1.node_id
  cross join filtered_keywords k2
  join nodes n2 on n2.id = k2.node_id
  where k1.id < k2.id  -- avoid duplicates
    and n1.id != n2.id  -- different articles
    and 1 - (k1.embedding_256 <=> k2.embedding_256) >= keyword_similarity_threshold
  order by similarity desc;
$$;

comment on function get_filtered_map(vector(256), float, float) is
  'Filters articles by query match, then shows keyword connections excluding synonyms.';
