# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Start Next.js dev server at localhost:3000
npm run build        # Build for production
npm run lint         # Run ESLint
npm test             # Run vitest tests
npm test -- --run    # Run tests once (no watch mode)
npx tsc --noEmit     # Type check without emitting
npx supabase db push # Apply database migrations
```

Run scripts with: `npm run script scripts/<script>.ts` (auto-loads .env.local)

**Note**: Let the user run `npm run dev` in their own terminal rather than running it from Claude. This keeps the dev server visible and controllable by the user.

**Scripts**: When writing scripts, reuse existing lib functions (e.g., `createServerClient` from `src/lib/supabase`, `generateEmbedding` from `src/lib/embeddings`) rather than reimplementing them. Check existing scripts in `scripts/` for patterns.

## Architecture

Semantic Navigator is a knowledge base tool that imports markdown files, atomizes them into a hierarchy (article > section > paragraph), and enables semantic search via embeddings.

### Data Flow

1. **Import**: User selects files from vault browser
2. **Parse**: `src/lib/parser.ts` uses mdast to parse markdown into hierarchical sections
3. **Ingest**: `src/lib/ingestion.ts` creates nodes in Supabase with embeddings and summaries
4. **Search**: Vector similarity search via pgvector's `search_similar` RPC function

### Key Abstractions

**Node Types** (stored in `nodes` table):
- `article`: Top-level document. Has `summary` only, no `content`.
- `section`: Header-delimited section. Has `summary` only, no `content`.
- `paragraph`: Leaf node. Has both `content` and optionally `summary` (for long paragraphs).

**Edge Types**:
- `containment_edges`: Parent-child hierarchy (article → sections → paragraphs)
- `backlink_edges`: Wiki-links between articles

**Keywords** (stored in `keywords` table):
- Each paragraph has extracted keywords for enhanced search
- Keywords have their own embeddings (`vector(1536)`) for semantic matching
- Linked to paragraph nodes via `node_id` foreign key
- Used in both search (similarity matching) and the Map view (article clustering)

### Core Files

- `src/lib/parser.ts` - Markdown parsing with AST, strips frontmatter, extracts backlinks
- `src/lib/ingestion.ts` - Orchestrates node creation, embeddings, and summarization
- `src/lib/summarization.ts` - Claude API calls for summaries and keyword extraction
- `src/lib/embeddings.ts` - OpenAI embedding generation
- `supabase/schema.sql` - Database schema with pgvector setup

### API Routes

- `POST /api/search` - Vector similarity search
- `POST /api/import/stream` - SSE-based import with progress updates
- `GET /api/vault` - Browse vault directory
- `GET /api/nodes/[id]` - Fetch node with children
- `GET /api/map` - Graph data for keyword-article visualization

### UI Components

- `src/components/SearchBar.tsx` - Semantic search with keyword matching display
- `src/components/VaultBrowser.tsx` - File picker for importing markdown files
- `src/components/NodeViewer.tsx` - Display node content and children
- `src/components/MapView.tsx` - D3 force-directed graph of articles and keywords
- `src/components/ImportProgress.tsx` - SSE-based import progress display

### Database

Uses Supabase with pgvector extension. Migrations in `supabase/migrations/`. Apply with `npx supabase db push`.

The `search_similar` RPC function performs cosine similarity search and returns matched keywords.

### Database Migrations

**Applying migrations:**
```bash
npx supabase db push  # Push pending migrations to remote database
```

**Evolving uncommitted migrations (before git commit):**

To modify a migration that's been applied to remote but not yet committed to git:

```bash
# 1. Manually undo the migration's changes (run in Supabase SQL Editor)
DROP FUNCTION IF EXISTS function_name(args);

# 2. Mark the migration as reverted in Supabase's tracking
npx supabase migration repair 007 --status reverted --linked

# 3. Edit the migration file locally

# 4. Re-apply
npx supabase db push
```

**Warning:** Never use `migration down --linked` on a database with data you care about. It resets the ENTIRE database (drops all tables) and reapplies migrations from scratch.

**Rolling back deployed migrations (after git commit/deploy):**

Supabase migrations are forward-only. To undo a deployed migration:
1. Create a NEW migration that reverses the changes
2. Never try to edit or remove already-deployed migration files

**Local development reset:**
```bash
npx supabase db reset  # Resets LOCAL database only (safe)
```

### Traversing the Hierarchy

To find an article from a keyword or paragraph:
1. Keywords link to paragraphs via `keywords.node_id`
2. Paragraphs link to sections/articles via `containment_edges.child_id` → `parent_id`
3. May need 1-2 hops: paragraph → section → article, or paragraph → article directly

Example pattern (used in `/api/map`):
```sql
-- Get parent of a paragraph
SELECT parent_id FROM containment_edges WHERE child_id = <paragraph_id>
-- Check if parent is article (node_type = 'article') or section
-- If section, query again to get the article
```

## Environment

Requires `.env.local` with:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` (embeddings)
- `ANTHROPIC_API_KEY` (summarization)
- `VAULT_PATH` (local path to markdown files)

**Important**: Never read `.env.local` directly. Access environment variables implicitly through the NPM environment (e.g., `process.env.OPENAI_API_KEY` in code, or by running scripts via `npx tsx`).

## Documentation

See `docs/README.md` for architecture documentation, ADRs, and investigation notes.