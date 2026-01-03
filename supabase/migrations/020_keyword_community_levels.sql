-- Multi-level keyword communities for semantic zooming
-- Replaces single community_id with level-based community assignments

-- Create table for multi-level community assignments
create table keyword_communities (
  keyword_id uuid not null references keywords(id) on delete cascade,
  level integer not null,  -- 0 = coarsest (fewest communities), 7 = finest
  community_id integer not null,
  is_hub boolean not null default false,
  primary key (keyword_id, level)
);

-- Index for querying all keywords at a specific level
create index idx_keyword_communities_level on keyword_communities(level);

-- Index for querying by community at a level
create index idx_keyword_communities_level_community on keyword_communities(level, community_id);

-- Drop old single-level community columns from keywords table
drop index if exists idx_keywords_community;
alter table keywords drop column if exists community_id;
alter table keywords drop column if exists is_community_hub;
