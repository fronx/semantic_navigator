-- Project associations: user-curated links between projects and content
-- Separate from containment_edges because:
-- 1. These survive article reimports (containment_edges get deleted with articles)
-- 2. Articles can belong to multiple projects
-- 3. Different semantics: containment = structural, association = organizational

CREATE TABLE project_associations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The project node (must be node_type = 'project')
  project_id uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,

  -- The associated node (article, chunk, or another project for sub-projects)
  target_id uuid NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,

  -- Association semantics:
  -- 'contains': hierarchical ownership (project contains this, sub-project)
  -- 'references': lateral connection (project references this but doesn't "own" it)
  association_type text NOT NULL CHECK (association_type IN ('contains', 'references')),

  created_at timestamptz DEFAULT now(),

  -- Each project-target pair can only have one association
  UNIQUE(project_id, target_id)
);

-- Index for "what does this project contain/reference?"
CREATE INDEX project_associations_project_idx ON project_associations(project_id);

-- Index for "which projects reference this node?" (needed for reimport survival)
CREATE INDEX project_associations_target_idx ON project_associations(target_id);

-- Comment for documentation
COMMENT ON TABLE project_associations IS
  'User-curated links between projects and content nodes. Survives reimport.';
