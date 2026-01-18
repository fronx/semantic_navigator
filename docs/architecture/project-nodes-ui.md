# Project Nodes UI Design

## Overview

Projects are user-created organizational nodes that live directly in the TopicsView graph. Unlike imported articles/keywords, projects can be freely positioned and serve as semantic anchors for exploring related content.

## Core Interactions

### Creating a Project Node

**Trigger**: Press `N` key while hovering over the graph canvas

**Flow**:
1. A new node appears at the mouse cursor position
2. An inline text field is immediately active for entering the project title
3. Press Enter to confirm creation
4. The project node is created in the database with an embedding generated from the title
5. A sidebar panel opens on the right showing project details

**Visual**:
- Project nodes have a distinct visual style (different shape or border) to differentiate from keyword nodes
- They are not force-connected to the graph - freely positionable via drag

### Project Sidebar Panel

Opens automatically after creating a project, or when clicking an existing project node.

**Contents**:
1. **Title** - Editable inline text field (click to edit, Enter or blur to save)
2. **Description** - Editable multi-line text field with the same interaction pattern
3. **Suggested Associations** - List of semantically similar nodes (see below)

**Editing Pattern**:
- Use a library for inline-editable fields (not custom implementation)
- Visual affordance: click-to-edit with checkmark/confirm button
- Auto-save on blur or Enter

### Project Content Processing

When a project's description is saved:

1. **Chunking**: Run the description through the existing chunking machinery (`src/lib/chunker.ts`)
2. **Embedding**: Generate embeddings for each chunk
3. **Auto-tagging**: Extract keywords from chunks (same as articles)
4. **Storage**: Store chunks as child nodes with `node_type = 'chunk'` and parent reference to project

This reuses the existing article ingestion pipeline but with `project` as the root node type.

### Semantic Suggestions

Once a project has content (title + description), the system suggests related nodes:

**Algorithm**:
1. Use project's embedding to find semantically similar nodes
2. Apply cosine similarity threshold (configurable, e.g., 0.7)
3. Rank results by similarity score
4. Display in sidebar as a scrollable list

**Interaction**:
- Hovering over a suggestion highlights that node in the graph
- Clicking a suggestion could:
  - Navigate/zoom to that node
  - Create an association (future)
  - Open that node's details

### Selection & Highlighting

When a project node is selected (clicked):

1. The project is visually highlighted (selected state)
2. All semantically similar nodes above threshold are highlighted
3. Non-similar nodes are dimmed
4. Similarity can be shown via edge weight or color intensity

## Graph Integration

### Force Layout Behavior

Project nodes are **excluded from force simulation**:
- They don't attract/repel other nodes
- They can be freely dragged and stay where placed
- Position is persisted (needs new database field or separate storage)

### Visual Differentiation

Project nodes should be visually distinct:
- Different shape (e.g., rounded rectangle vs circle)
- Different color scheme
- Label always visible (not just on hover)
- Optional: icon indicator

## Data Model

Projects use the existing `nodes` table with:
- `node_type = 'project'`
- `title` = project name
- `content` = project description (markdown)
- `embedding` = vector from title + content
- `provenance = 'user'`

Project chunks are stored as:
- `node_type = 'chunk'`
- Linked via `containment_edges` to project
- Each has own embedding for fine-grained similarity

## Implementation Phases

### Phase 1: Basic Creation ✅
- [x] `N` key handler in TopicsView
- [x] Inline title input at cursor position (`InlineTitleInput` component)
- [x] Create project via API with initial position
- [x] Project node appears in graph with distinct visual style
- [x] Project excluded from force simulation (fixed via `fx`/`fy`)
- [x] Position persistence to database

### Phase 2: Sidebar Panel ✅
- [x] `ProjectSidebar` component
- [x] Inline-editable title field (using `react-contenteditable`)
- [x] Inline-editable description field
- [x] Auto-save on blur
- [x] Open sidebar on project click or creation

### Phase 3: Content Processing
- [ ] Adapt ingestion pipeline for project content
- [ ] Chunk project descriptions
- [ ] Generate embeddings for chunks
- [ ] Extract keywords from chunks

### Phase 4: Semantic Suggestions
- [ ] Query similar nodes based on project embedding
- [ ] Display suggestions in sidebar
- [ ] Highlight suggested nodes on hover
- [ ] Configurable similarity threshold

### Phase 5: Associations
- [ ] Create associations from suggestions
- [ ] Visual indication of associated nodes
- [ ] Association management in sidebar

## Technical Notes

### Libraries Used
- Inline editing: `react-contenteditable`

### API Endpoints
- `GET /api/projects` - List all projects
- `POST /api/projects` - Create project (accepts `position_x`, `position_y`)
- `GET /api/projects/[id]` - Fetch project with associations
- `PUT /api/projects/[id]` - Update title/content/position
- `PATCH /api/projects/[id]` - Update position only (for drag operations)
- `DELETE /api/projects/[id]` - Delete project

### Position Persistence
Decision: **Option 1** - Added `position_x`, `position_y` columns to nodes table.

Migration: `024_project_positions.sql`

Positions are persisted via:
- `PATCH /api/projects/[id]` called on drag end
- Initial position passed at creation time

### Visual Styling

**D3 Renderer** (`map-renderer.ts`):
- Radius: 28px (vs 18px for keywords)
- Color: Purple (#8b5cf6)
- Border: 3px white stroke
- Glow effect via CSS drop-shadow filter

**Three.js Renderer** (`three-renderer.ts`):
- Radius: 7px base (vs 4px for keywords)
- Color: Purple (#8b5cf6)

### Key Components
- `InlineTitleInput.tsx` - Floating input at cursor position for project creation
- `ProjectSidebar.tsx` - Right sidebar for editing project details
- `TopicsView.tsx` - Extended with `projectNodes`, `onProjectClick`, `onProjectDrag` props
