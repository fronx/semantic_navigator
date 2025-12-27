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

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
# Edit .env.local with your API keys

# Run development server
npm run dev
```

Required environment variables:
- `SUPABASE_URL` - your Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `OPENAI_API_KEY` - for embeddings
- `ANTHROPIC_API_KEY` - for summarization

## Usage

1. Open the web UI at `http://localhost:3000`
2. Point it at your Obsidian vault folder
3. Select files/folders to import (with cost estimates shown)
4. Browse and search your knowledge base semantically

## Design

See [IDEA.md](./IDEA.md) for the full design spec.
