# Indexing Pipeline Guide

This guide documents how Semantic Navigator ingests markdown files and transforms them into a searchable, semantic knowledge graph.

## Overview

The indexing pipeline takes markdown files from your vault and:
1. **Parses** them into an AST, extracting frontmatter, backlinks, and structure
2. **Chunks** the content into semantic segments using an LLM
3. **Generates embeddings** for articles, chunks, and keywords
4. **Extracts keywords** for each chunk and bubbles them up to the article level
5. **Stores everything** in Supabase with relationships (containment, backlinks)

## Pipeline Stages

### 1. Parsing (`src/lib/parser.ts`)

**Input:** Raw markdown content + filename
**Output:** `ParsedArticle` with title, content, and backlinks

**What it does:**
- Strips YAML frontmatter (`---` blocks)
- Fixes malformed linked images (common in Substack exports)
- Extracts `[[wiki-links]]` for backlink edges
- Parses markdown into an AST using `mdast`
- Returns cleaned content with title and backlinks

**Key functions:**
```typescript
parseMarkdown(content: string, filename: string): ParsedArticle
```

### 2. Chunking (`src/lib/chunker.ts`)

**Input:** Parsed article content
**Output:** Array of `Chunk` objects with content, keywords, and metadata

**What it does:**
- Streams content to Claude Haiku in ~100KB windows
- LLM segments text into semantic chunks (500-1500 tokens each)
- Each chunk gets:
  - `content`: The actual text (verbatim, not summarized)
  - `chunkType`: Natural label like "problem statement" or "worked example"
  - `keywords`: Specific terms/concepts for connecting across documents
  - `headingContext`: Breadcrumb path like `["Introduction", "Background"]`
  - `position`: Index in the document

**Key functions:**
```typescript
async function* chunkText(content: string): AsyncGenerator<Chunk>
```

**Chunk example:**
```json
{
  "content": "Gradient descent is an optimization algorithm...",
  "position": 0,
  "headingContext": ["Machine Learning", "Optimization"],
  "chunkType": "concept explanation",
  "keywords": ["gradient descent", "optimization algorithm", "loss function"]
}
```

### 3. Summarization (`src/lib/summarization.ts`)

**Input:** Article title and full content
**Output:** Concise summary string

**What it does:**
- Generates a 2-3 sentence article summary using Claude
- Used for article-level embeddings (instead of embedding raw content)
- Summary captures the article's main themes without implementation details

**Key functions:**
```typescript
generateArticleSummary(title: string, content: string): Promise<string>
reduceKeywordsForArticle(title: string, sections: {title: string, keywords: string[]}[]): Promise<string[]>
```

### 4. Embedding Generation (`src/lib/embeddings.ts`)

**Input:** Array of texts to embed
**Output:** Array of embedding vectors (1536-dimensional)

**What it does:**
- Batches texts to OpenAI's `text-embedding-3-small` model
- Generates embeddings for:
  - Article summary (1 per article)
  - Chunk content (1 per chunk)
  - Unique keywords (1 per unique keyword across all chunks)
- Also creates truncated 256-dimensional embeddings for keywords (faster similarity search)

**Key functions:**
```typescript
generateEmbeddingsBatched(texts: string[], onProgress?: (completed: number, total: number) => void): Promise<number[][]>
truncateEmbedding(embedding: number[], targetDim: number): number[]
```

### 5. Ingestion (`src/lib/ingestion-chunks.ts`)

**Input:** Supabase client, source path, markdown content
**Output:** Article node ID

**What it does:**

#### 5.1. Check for existing article
- Uses `findExistingNode()` to check if article already exists by `source_path`
- Computes SHA-256 content hash
- Determines action: `create`, `skip`, or `reimport`

#### 5.2. Handle reimport
If article exists and content changed (or force reimport):
- Saves project associations and incoming backlinks
- Deletes old article + all descendants (chunks, keywords, edges)
- Will restore associations/backlinks after reimport completes

#### 5.3. Create nodes
**Article node:**
```typescript
{
  content: null,  // Articles don't store raw content
  summary: "2-3 sentence summary",
  content_hash: "abc123...",
  embedding: [1536-dim vector],
  node_type: "article",
  source_path: "relative/path/to/file.md",
  header_level: null,
  chunk_type: null,
  heading_context: null
}
```

**Chunk nodes:**
```typescript
{
  content: "The actual chunk text...",
  summary: null,  // Chunks don't have summaries
  content_hash: "def456...",
  embedding: [1536-dim vector],
  node_type: "chunk",
  source_path: "relative/path/to/file.md",
  header_level: null,
  chunk_type: "problem statement",
  heading_context: ["Section", "Subsection"]
}
```

#### 5.4. Create containment edges
Links each chunk to its parent article:
```sql
INSERT INTO containment_edges (parent_id, child_id, position)
VALUES (article_id, chunk_id, 0)
```

#### 5.5. Store keywords
Each chunk's keywords are stored in the `keywords` table:
```typescript
{
  keyword: "gradient descent",
  embedding: [1536-dim vector],
  embedding_256: [256-dim truncated vector],
  node_id: chunk_id,
  node_type: "chunk"  // Denormalized for efficient filtering
}
```

**Unique constraint:** `(node_id, keyword)` - each node can have a keyword only once

#### 5.6. Keyword bubbling
After storing chunk-level keywords:
- Collects all unique keywords from all chunks
- Calls `reduceKeywordsForArticle()` to select most important keywords for article level
- LLM reduces ~50 chunk keywords to ~10 article keywords
- Stores article-level keywords with `node_type: "article"`

This creates a hierarchy: specific keywords on chunks, broad keywords on articles.

#### 5.7. Create backlink edges
For each `[[wiki-link]]` found in the article:
- Searches for target article by `source_path ILIKE '%{linkText}.md'`
- Creates edge: `source_id → target_id` with `link_text`

#### 5.8. Restore associations
If this was a reimport, restores:
- Project associations (which projects this article belongs to)
- Incoming backlinks (links from other articles to this one)

## Key Files

| File | Purpose |
|------|---------|
| `src/lib/parser.ts` | Markdown → AST, strip frontmatter, extract backlinks |
| `src/lib/chunker.ts` | Content → semantic chunks with keywords (LLM-based) |
| `src/lib/summarization.ts` | Generate article summaries and reduce keywords |
| `src/lib/embeddings.ts` | Text → OpenAI embeddings (batched) |
| `src/lib/ingestion-chunks.ts` | **Main orchestrator** - coordinates all steps |
| `src/lib/ingestion-parallel.ts` | Parallel processing wrapper for bulk imports |
| `src/app/api/import/stream/route.ts` | HTTP endpoint for imports (SSE progress) |

## Database Schema

### Tables Created

**`nodes` table:**
- Stores both articles (`node_type: "article"`) and chunks (`node_type: "chunk"`)
- Articles have `summary` but no `content`
- Chunks have `content` but no `summary`
- All nodes have `embedding` (1536-dim vector)

**`keywords` table:**
- Links keywords to nodes (chunk or article)
- Each keyword has its own embedding (1536-dim) and truncated embedding (256-dim)
- Unique constraint: `(node_id, keyword)` - prevents duplicates per node
- **Known issue:** No uniqueness on `keyword` itself - same keyword can have multiple rows with different embeddings

**`containment_edges` table:**
- Represents parent-child hierarchy
- Currently only article → chunks (flat hierarchy)

**`backlink_edges` table:**
- Represents wiki-links between articles
- Stores `link_text` for display

## How to Use

### Via API (UI)

The Vault Browser component calls `POST /api/import/stream`:

```typescript
const response = await fetch('/api/import/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ paths: ['folder1', 'folder2'] })
})

// SSE stream with progress events
const reader = response.body.getReader()
// ... read SSE events: start, progress, complete, error
```

### Via REPL

```typescript
import { createServerClient } from './src/lib/supabase'
import { ingestArticleWithChunks } from './src/lib/ingestion-chunks'
import { readVaultFile } from './src/lib/vault'

const supabase = createServerClient()
const vaultPath = process.env.VAULT_PATH!
const filePath = 'notes/my-article.md'

const content = await readVaultFile(vaultPath, filePath)

const articleId = await ingestArticleWithChunks(
  supabase,
  filePath,
  content,
  {
    onProgress: (current, completed, total) => {
      console.log(`[${completed}/${total}] ${current}`)
    }
  },
  {
    forceReimport: true  // Optional: force reimport even if unchanged
  }
)

console.log(`Created article: ${articleId}`)
```

### Via Script

Create `scripts/import-folder.ts`:

```typescript
import { createServerClient } from '@/lib/supabase'
import { collectMarkdownFiles, readVaultFile } from '@/lib/vault'
import { ingestArticlesParallelChunked } from '@/lib/ingestion-parallel'

const supabase = createServerClient()
const vaultPath = process.env.VAULT_PATH!

const files = await collectMarkdownFiles(vaultPath, 'my-folder')
const fileData = await Promise.all(
  files.map(async (path) => ({
    path,
    name: path.split('/').pop()!,
    content: await readVaultFile(vaultPath, path)
  }))
)

await ingestArticlesParallelChunked(supabase, fileData, {
  onProgress: (completed, total, activeFiles) => {
    console.log(`${completed}/${total} - Active: ${activeFiles.join(', ')}`)
  }
})
```

Run: `npm run script scripts/import-folder.ts`

## Parallel Processing

The `ingestArticlesParallelChunked()` function provides:
- Configurable concurrency (default: 3 files at a time)
- Progress tracking with active file names
- Error handling per file (doesn't stop on single failure)

This is what the API route uses for bulk imports.

## Import Actions

The pipeline determines what to do with each file:

| Action | When | Behavior |
|--------|------|----------|
| `create` | Article doesn't exist | Create new article + chunks |
| `skip` | Article exists with same content hash | Skip entirely |
| `reimport` | Article exists but content changed | Delete old + create new |

Force reimport with `options.forceReimport = true` to bypass hash check.

## Known Issues

### 1. Duplicate Keywords

**Problem:** The `keywords` table has no uniqueness constraint on the `keyword` column itself. Same keyword can appear multiple times with different embeddings.

**Example:**
```sql
SELECT keyword, COUNT(*) as count
FROM keywords
GROUP BY keyword
HAVING COUNT(*) > 1
```

**Why it happens:**
- Keywords are embedded per article/chunk
- No deduplication across nodes
- Each ingestion generates fresh embeddings

**Fix needed:** Normalize keywords to a separate table, use foreign keys.

### 2. Chunk-Level Keyword Explosion

**Problem:** Each chunk generates 3-10 keywords, leading to 100s of keywords per article.

**Current mitigation:** Keyword bubbling (`reduceKeywordsForArticle()`) reduces chunk keywords to ~10 article-level keywords.

### 3. Postgresss 1000-Row Limit (via PostgREST)

**Problem:** `supabase.from('table').select()` silently truncates at 1000 rows.

**Fix:** Use `.range(from, to)` for pagination or create an RPC function.

## Environment Variables

Required in `.env.local`:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...  # For server-side operations

# OpenAI (embeddings)
OPENAI_API_KEY=sk-...

# Anthropic (summarization, chunking)
ANTHROPIC_API_KEY=sk-ant-...

# Vault location
VAULT_PATH=/absolute/path/to/markdown/files
```

## Debugging

### Check what got imported

```sql
-- Count nodes by type
SELECT node_type, COUNT(*) FROM nodes GROUP BY node_type;

-- Recent articles
SELECT id, source_path, created_at
FROM nodes
WHERE node_type = 'article'
ORDER BY created_at DESC
LIMIT 10;

-- Keywords for an article
SELECT k.keyword, k.node_type
FROM keywords k
WHERE k.node_id = 'article-id'
ORDER BY k.node_type, k.keyword;

-- Chunks for an article
SELECT c.id, c.chunk_type, LEFT(c.content, 100) as preview
FROM nodes c
JOIN containment_edges e ON e.child_id = c.id
WHERE e.parent_id = 'article-id'
ORDER BY e.position;
```

### Check for duplicates

```typescript
// In REPL
const { data } = await supabase
  .from('keywords')
  .select('keyword, node_id, embedding')

const byKeyword = new Map()
for (const row of data) {
  if (!byKeyword.has(row.keyword)) {
    byKeyword.set(row.keyword, [])
  }
  byKeyword.get(row.keyword).push(row)
}

// Find keywords with different embeddings
for (const [keyword, rows] of byKeyword) {
  if (rows.length > 1) {
    const embeddings = rows.map(r => r.embedding.slice(0, 3).join(','))
    const unique = new Set(embeddings)
    if (unique.size > 1) {
      console.log(`${keyword}: ${rows.length} rows, ${unique.size} unique embeddings`)
    }
  }
}
```

## Next Steps

Before starting a reimport to fix duplicates:

1. **Clear the database** (see [TypeScript REPL guide](typescript-repl.md))
2. **Fix keyword deduplication** - create a normalized keyword table
3. **Update ingestion code** - lookup existing keywords before creating new ones
4. **Add validation** - ensure uniqueness constraints
5. **Reimport vault** - run full import with new deduplication logic
