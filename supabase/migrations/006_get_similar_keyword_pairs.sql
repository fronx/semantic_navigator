-- Function to find semantically similar keyword pairs across different articles
-- Uses cross-join (O(n^2)) but runs entirely in PostgreSQL avoiding network round-trips
create or replace function get_similar_keyword_pairs(
  similarity_threshold float default 0.7
)
returns table (
  keyword1_id uuid,
  keyword1_text text,
  article1_id uuid,
  keyword2_id uuid,
  keyword2_text text,
  article2_id uuid,
  similarity float
)
language sql stable
as $$
  with keyword_articles as (
    -- Map each keyword to its article by walking up containment tree
    select
      k.id as keyword_id,
      k.keyword,
      k.embedding,
      coalesce(
        -- If parent is article, use it
        case when p1.node_type = 'article' then p1.id else null end,
        -- Otherwise get grandparent (section's parent)
        p2.id
      ) as article_id
    from keywords k
    join containment_edges e1 on e1.child_id = k.node_id
    join nodes p1 on p1.id = e1.parent_id
    left join containment_edges e2 on e2.child_id = p1.id and p1.node_type = 'section'
    left join nodes p2 on p2.id = e2.parent_id and p2.node_type = 'article'
    where k.embedding is not null
  )
  select
    ka1.keyword_id as keyword1_id,
    ka1.keyword as keyword1_text,
    ka1.article_id as article1_id,
    ka2.keyword_id as keyword2_id,
    ka2.keyword as keyword2_text,
    ka2.article_id as article2_id,
    1 - (ka1.embedding <=> ka2.embedding) as similarity
  from keyword_articles ka1
  cross join keyword_articles ka2
  where
    -- Different keywords (avoid duplicates by ordering)
    ka1.keyword_id < ka2.keyword_id
    -- From different articles
    and ka1.article_id is distinct from ka2.article_id
    -- Not exact same text (handled by multi-article logic)
    and ka1.keyword != ka2.keyword
    -- Above similarity threshold
    and 1 - (ka1.embedding <=> ka2.embedding) >= similarity_threshold
  order by similarity desc;
$$;
