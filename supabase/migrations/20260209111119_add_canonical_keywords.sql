-- Drop old keywords table (it had UNIQUE(node_id, keyword) allowing duplicates across nodes)
drop table if exists keywords cascade;

-- Canonical keywords table: one row per unique keyword text
-- The keyword column has a unique constraint to prevent duplicates
create table keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text unique not null,           -- Unique keyword text
  embedding vector(1536) not null,        -- Canonical embedding
  embedding_256 vector(256) not null,     -- Truncated for bandwidth optimization
  created_at timestamptz default now()
);

-- Many-to-many join table linking keywords to nodes
create table keyword_occurrences (
  keyword_id uuid not null references keywords(id) on delete cascade,
  node_id uuid not null references nodes(id) on delete cascade,
  node_type text not null,                -- Denormalized for filtering (chunk/article)
  created_at timestamptz default now(),
  primary key (keyword_id, node_id)
);

-- Indexes for performance
create index keywords_embedding_idx on keywords
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

create index keywords_embedding_256_idx on keywords
  using ivfflat (embedding_256 vector_cosine_ops) with (lists = 100);

create index keyword_occurrences_keyword_id_idx on keyword_occurrences(keyword_id);
create index keyword_occurrences_node_id_idx on keyword_occurrences(node_id);
create index keyword_occurrences_node_type_idx on keyword_occurrences(node_type);
