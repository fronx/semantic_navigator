-- Enable pgvector extension
create extension if not exists vector;

-- Nodes table
-- Note: content is only populated for paragraph nodes.
-- Articles and sections have content = NULL (they use summary for display).
create table nodes (
  id uuid primary key default gen_random_uuid(),
  content text,  -- only populated for paragraphs
  summary text,
  content_hash text not null,
  embedding vector(1536),  -- text-embedding-3-small dimension
  node_type text not null check (node_type in ('article', 'section', 'paragraph')),
  source_path text not null,
  header_level int,  -- null for paragraphs, 1-6 for sections
  dirty boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Containment edges (parent-child hierarchy)
create table containment_edges (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references nodes(id) on delete cascade,
  child_id uuid not null references nodes(id) on delete cascade,
  position int not null,  -- order within parent
  created_at timestamptz default now(),
  unique(parent_id, child_id)
);

-- Backlink edges (wiki-links between articles)
create table backlink_edges (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references nodes(id) on delete cascade,
  target_id uuid not null references nodes(id) on delete cascade,
  link_text text,  -- the [[link text]]
  context text,    -- surrounding text for context
  created_at timestamptz default now()
);

-- Summary cache (for different zoom levels and lenses)
create table summary_cache (
  id uuid primary key default gen_random_uuid(),
  node_id uuid not null references nodes(id) on delete cascade,
  zoom_level int not null,
  lens text,  -- nullable, e.g., "technical", "personal"
  summary text not null,
  content_hash text not null,  -- hash of content at generation time
  created_at timestamptz default now()
);

-- Indexes for performance
create index nodes_embedding_idx on nodes using ivfflat (embedding vector_cosine_ops) with (lists = 100);
create index nodes_source_path_idx on nodes(source_path);
create index nodes_node_type_idx on nodes(node_type);
create index nodes_dirty_idx on nodes(dirty) where dirty = true;
create index containment_parent_idx on containment_edges(parent_id);
create index containment_child_idx on containment_edges(child_id);
create index backlink_source_idx on backlink_edges(source_id);
create index backlink_target_idx on backlink_edges(target_id);
create index summary_cache_node_idx on summary_cache(node_id);

-- Function to update updated_at timestamp
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger nodes_updated_at
  before update on nodes
  for each row execute function update_updated_at();

-- Similarity search function
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
  similarity float
)
language sql stable
as $$
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
  order by nodes.embedding <=> query_embedding
  limit match_count;
$$;
