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

Run scripts with: `npx tsx scripts/<script>.ts`

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

**Keywords**: Each paragraph has extracted keywords stored in `keywords` table for enhanced search.

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

### Database

Uses Supabase with pgvector extension. Migrations in `supabase/migrations/`. Apply with `npx supabase db push`.

The `search_similar` RPC function performs cosine similarity search and returns matched keywords.

## Environment

Requires `.env.local` with:
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY` (embeddings)
- `ANTHROPIC_API_KEY` (summarization)
- `VAULT_PATH` (local path to markdown files)

**Important**: Never read `.env.local` directly. Access environment variables implicitly through the NPM environment (e.g., `process.env.OPENAI_API_KEY` in code, or by running scripts via `npx tsx`).