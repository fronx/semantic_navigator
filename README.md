# Semantic Navigator

A navigable semantic database for personal knowledge bases. Relationships are derived from embedding proximity rather than manual labeling, enabling natural language exploration of your notes.

## What it does

- **Import** Markdown files from an Obsidian vault (or any folder)
- **Atomize** content into a hierarchy: articles → sections (by headers) → paragraphs
- **Embed** each node using OpenAI embeddings
- **Summarize** each node with Claude for context-aware descriptions
- **Navigate** semantically - zoom in/out, explore related ideas, follow backlinks

## Interfaces

- **Web UI** - browse, search, and import content visually
- **MCP Server** - programmatic access for AI agents

## Tech Stack

- **Next.js** - web UI + API
- **Supabase** - PostgreSQL with pgvector for vector similarity search
- **OpenAI** - text-embedding-3-small for embeddings
- **Claude API** - summarization and query translation

## Setup

### 1. Install dependencies

```bash
npm install
```

**Note:** The map view uses `umapper`, a local package. Clone it alongside this repo:

```bash
cd ..
git clone <umapper-repo-url> umapper
cd umapper && npm install && npm run build:lib
```

See [docs/guides/local-npm-packages.md](docs/guides/local-npm-packages.md) for details.

### 2. Set up Supabase

Create a project at [supabase.com](https://supabase.com), then:

```bash
# Link to your Supabase project
npx supabase login
npx supabase link --project-ref your-project-ref

# Apply database schema and migrations
npx supabase db push
```

Or manually run `supabase/schema.sql` in the Supabase SQL Editor.

### 3. Configure environment

```bash
cp .env.example .env.local
```

Required variables:
- `NEXT_PUBLIC_SUPABASE_URL` - your Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` - Supabase publishable key
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase secret key (for server-side operations)
- `OPENAI_API_KEY` - for embeddings
- `ANTHROPIC_API_KEY` - for summarization
- `VAULT_PATH` - path to your Obsidian vault

### 4. Run

```bash
npm run dev
```

## Usage

1. Open the web UI at `http://localhost:3000`
2. Point it at your Obsidian vault folder
3. Select files/folders to import (with cost estimates shown)
4. Browse and search your knowledge base semantically

## Database Migrations

Schema changes are in `supabase/migrations/`. To apply:

```bash
npx supabase db push
```

Or run the SQL files manually in the Supabase SQL Editor.

## Design

See [IDEA.md](./IDEA.md) for the full design spec.
