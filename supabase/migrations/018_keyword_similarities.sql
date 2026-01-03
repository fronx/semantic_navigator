-- Sparse keyword similarity table for Louvain community detection
-- Only stores pairs above similarity threshold (0.7) to keep it sparse

create table keyword_similarities (
  keyword_a_id uuid not null references keywords(id) on delete cascade,
  keyword_b_id uuid not null references keywords(id) on delete cascade,
  similarity float not null,
  primary key (keyword_a_id, keyword_b_id),
  -- Ensure canonical ordering: keyword_a_id < keyword_b_id
  constraint keyword_similarities_ordering check (keyword_a_id < keyword_b_id)
);

-- Indexes for querying neighbors of a keyword
create index idx_keyword_similarities_a on keyword_similarities(keyword_a_id);
create index idx_keyword_similarities_b on keyword_similarities(keyword_b_id);

-- Trigger function: when a new keyword is inserted, compute similarities to existing keywords
-- Only for article-level keywords (node_type = 'article')
create or replace function on_keyword_insert() returns trigger as $$
begin
  -- Only process article-level keywords with embeddings
  if NEW.node_type = 'article' and NEW.embedding is not null then
    insert into keyword_similarities (keyword_a_id, keyword_b_id, similarity)
    select
      least(NEW.id, k.id),
      greatest(NEW.id, k.id),
      1 - (NEW.embedding <=> k.embedding)
    from keywords k
    where k.id != NEW.id
      and k.node_type = 'article'
      and k.embedding is not null
      and (NEW.embedding <=> k.embedding) < 0.3  -- cosine distance < 0.3 = similarity > 0.7
    on conflict (keyword_a_id, keyword_b_id) do update
      set similarity = excluded.similarity;
  end if;
  return NEW;
end;
$$ language plpgsql;

create trigger keyword_similarity_trigger
after insert on keywords
for each row execute function on_keyword_insert();

-- Add community columns to keywords table
alter table keywords add column community_id integer;
alter table keywords add column is_community_hub boolean default false;

-- Index for querying by community
create index idx_keywords_community on keywords(community_id) where community_id is not null;
