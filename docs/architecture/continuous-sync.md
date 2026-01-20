# Continuous Vault Synchronization

## Current State

### How Import Works Today

Import is triggered manually via the Vault Browser UI (`/api/import/stream`). The flow:

1. User selects files from the vault browser
2. Files are read from disk via `VAULT_PATH` environment variable
3. Each file is parsed into chunks (`src/lib/chunker.ts`)
4. For each file, the system checks if an article already exists by `source_path`
5. If exists with same `content_hash`: skip entirely
6. If exists with different `content_hash`: **logs a warning and does nothing** (update not implemented)
7. If new: creates article node, chunk nodes, keywords, and embeddings

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/ingestion-chunks.ts` | Main import logic, hash comparison, node creation |
| `src/lib/ingestion-parallel.ts` | Parallel wrapper for batch imports |
| `src/lib/node-identity.ts` | Defines identity keys for deduplication |
| `src/lib/parser.ts` | Markdown parsing, frontmatter stripping |
| `src/lib/chunker.ts` | Semantic chunking with LLM |
| `src/app/api/import/stream/route.ts` | SSE endpoint for import progress |

### Database Schema (relevant parts)

```sql
-- From schema.sql and migrations
nodes (
  id uuid,
  content text,           -- chunk content (null for articles)
  summary text,           -- LLM-generated summary
  content_hash text,      -- SHA256 of content for change detection
  embedding vector(1536),
  node_type text,         -- 'article' | 'chunk' | 'project'
  source_path text,       -- file path relative to vault
  chunk_type text,        -- semantic classification
  heading_context text[], -- heading breadcrumbs
  dirty boolean,          -- EXISTS but unused
  created_at timestamptz,
  updated_at timestamptz
)
```

### What's Missing

1. **No file modification tracking** - We hash content but don't store file mtime. Every sync requires reading and hashing every file.

2. **Update not implemented** - Changed files are detected but not re-imported (line 137 in ingestion-chunks.ts: `"content changed, skipping (not implemented)"`).

3. **No deletion detection** - Files removed from vault remain in database.

4. **Manual trigger only** - No automatic sync on startup or file watch.

5. **Unused dirty flag** - Schema has `dirty` column but it's never set or read.

### Partial Implementations to Complete

These features were started but never finished. We should either complete them or remove the dead code.

#### 1. The `dirty` flag (schema.sql line 16)

The `nodes` table has a `dirty boolean default false` column with an index (`nodes_dirty_idx`), but it's never used anywhere in the codebase.

**Original intent (probable)**: Mark nodes whose source file changed, allowing batch reprocessing of dirty nodes.

**Options**:
- **Complete it**: Set `dirty=true` when file mtime changes, process dirty nodes on sync, set `dirty=false` after successful re-import.
- **Remove it**: If we use the `vault_files` table approach, the dirty flag becomes redundant. The sync status lives in `vault_files.status` instead.

**Recommendation**: Remove the `dirty` column. The `vault_files` table provides cleaner separation of concerns - file tracking is distinct from content indexing.

#### 2. The update path in ingestion-chunks.ts (lines 131-139)

```typescript
if (existingArticle && options?.forceReimport) {
  // This path works - deletes and reimports
  savedAssociations = await deleteArticleWithChunks(supabase, existingArticle.id);
} else if (existingArticle) {
  if (existingArticle.content_hash === articleContentHash) {
    // Skip - already imported
    return existingArticle.id;
  } else {
    // BUG: Detected change but does nothing!
    console.warn(`[Import] Article "${parsed.title}" content changed, skipping (not implemented)`);
    return existingArticle.id;
  }
}
```

**The fix**: The `forceReimport` path already works correctly. We just need to trigger it when content hash differs:

```typescript
} else if (existingArticle) {
  if (existingArticle.content_hash === articleContentHash) {
    return existingArticle.id;  // Unchanged
  } else {
    // Content changed - treat as reimport
    console.log(`[Reimport] Article "${parsed.title}" content changed, reimporting`);
    savedAssociations = await deleteArticleWithChunks(supabase, existingArticle.id);
    // Continue to reimport below...
  }
}
```

This is a small change with immediate value - it makes the existing import idempotent.

### Known Issues to Address

#### 1. Backlinks break on reimport

**Problem**: When an article is deleted and re-created, it gets a new UUID. Backlinks from OTHER articles pointing TO this article via `backlink_edges.target_id` now reference a non-existent node.

**Current state**: `backlink_edges` uses UUIDs:
```sql
backlink_edges (
  source_id uuid references nodes(id) on delete cascade,
  target_id uuid references nodes(id) on delete cascade,
  link_text text
)
```

The `on delete cascade` means when we delete the target article, the backlink edge is also deleted. But the source article still conceptually links to that file - we've lost the relationship.

**Solution options**:

A. **Resolve backlinks by source_path instead of UUID**
   - Store `target_path` instead of `target_id` in backlink_edges
   - Resolve to UUID at query time via JOIN
   - Pro: Survives reimport
   - Con: Slower queries, need to handle missing targets

B. **Update backlinks after reimport**
   - After creating new article, find all backlink_edges where `link_text` matches the filename
   - Update their `target_id` to point to the new article
   - Pro: Keeps UUID-based lookups fast
   - Con: More complex reimport logic

C. **Use source_path as stable identifier everywhere**
   - Make `source_path` the primary identifier for articles (not UUID)
   - Pro: Simple, matches how users think about files
   - Con: Large schema change, affects all queries

**Recommendation**: Option B - update backlinks after reimport. It's surgical and doesn't require schema changes. Add this to `ingestArticleWithChunks` after creating the new article:

```typescript
// After article creation, repair incoming backlinks
await supabase
  .from("backlink_edges")
  .update({ target_id: newArticleId })
  .eq("link_text", filename);  // filename without .md extension
```

#### 2. Orphaned keyword similarities

**Problem**: The `keyword_similarities` table stores precomputed similarity edges between keywords. When an article is deleted, its keywords are deleted (via cascade from `keywords` table), but any similarity edges referencing those keywords become orphaned or are deleted.

**Current state**: Need to verify if `keyword_similarities` has proper foreign key cascades.

**Solution**: Ensure `keyword_similarities` has `ON DELETE CASCADE` for both keyword references. The similarities will need to be recomputed after significant reimports anyway (via `scripts/compute-keyword-communities.ts`).

#### 3. Project associations point to article UUIDs

**Problem**: `project_associations.target_id` references the article UUID. On reimport, the article gets a new UUID.

**Current state**: This is ALREADY HANDLED - `deleteArticleWithChunks` saves associations before deletion and `restoreProjectAssociations` restores them with the new article ID.

**Verification needed**: Confirm this works end-to-end with the sync flow.

---

## Proposed Architecture

### Goals

1. **Trust the sync** - Users should be confident that the database reflects the current vault state
2. **Efficient incremental updates** - Don't re-process unchanged files
3. **Automatic on startup** - Sync happens when the app starts, not manually
4. **Incremental benefit** - Each implementation step provides value independently

### New Data Model

Add a `vault_files` table to track file metadata separately from content:

```sql
vault_files (
  id uuid primary key,
  path text unique not null,      -- relative to VAULT_PATH
  mtime bigint not null,          -- file modification time (ms since epoch)
  size bigint not null,           -- file size in bytes
  content_hash text not null,     -- SHA256 of file content
  article_id uuid references nodes(id), -- linked article (null if import failed)
  status text not null,           -- 'synced' | 'pending' | 'error'
  error_message text,             -- last error if status='error'
  created_at timestamptz,
  updated_at timestamptz
)
```

This separates "what files exist" from "what content we've indexed", enabling:
- Fast mtime-based change detection without reading file content
- Tracking of failed imports for retry
- Detection of deleted files (files in DB but not on disk)

### Sync Algorithm

```
sync():
  1. List all .md files in VAULT_PATH with mtime and size
  2. For each file on disk:
     - If not in vault_files: mark as NEW
     - If mtime/size changed: mark as CHANGED
     - Otherwise: mark as UNCHANGED
  3. For each file in vault_files not on disk: mark as DELETED

  4. Process DELETED:
     - Delete article and all descendants
     - Remove from vault_files

  5. Process CHANGED:
     - Read file, compute content_hash
     - If hash unchanged (mtime changed but content same): update mtime, skip
     - If hash changed: delete old article, re-import, update vault_files

  6. Process NEW:
     - Read file, import, add to vault_files
```

### Sync Trigger Points

**Phase 1**: Manual "Sync" button (replaces current import flow)
**Phase 2**: Automatic sync on page load (background, non-blocking)
**Phase 3**: File watcher for real-time sync (optional, separate process)

---

## Implementation Steps

Each step is independently testable and provides incremental value. Steps are ordered to deliver value early - the first few steps are small fixes that make the existing system more reliable before we build the full sync infrastructure.

---

### Step 1: Fix the update path (small, immediate value)
**Status**: Not started

**Problem**: Changed files are detected but not re-imported.

**Change**: In `src/lib/ingestion-chunks.ts`, when `content_hash` differs, trigger the existing `deleteArticleWithChunks` path instead of logging a warning.

**Files to modify**:
- `src/lib/ingestion-chunks.ts` (lines 131-139)

**Testable outcome**:
1. Import a file via the existing UI
2. Edit the file in your vault
3. Import again (same file)
4. Verify the new content appears in the database

---

### Step 2: Fix backlinks on reimport
**Status**: Not started

**Problem**: When an article is reimported, incoming backlinks from other articles are lost (cascade deleted).

**Change**: After creating the new article in `ingestArticleWithChunks`, repair backlinks by matching `link_text` to the filename:

```typescript
// After article node creation
const filenameWithoutExt = sourcePath.split("/").pop()?.replace(/\.md$/, "");
if (filenameWithoutExt) {
  await supabase
    .from("backlink_edges")
    .update({ target_id: articleNode.id })
    .eq("link_text", filenameWithoutExt);
}
```

**Files to modify**:
- `src/lib/ingestion-chunks.ts`

**Testable outcome**:
1. Import two files: A.md and B.md, where B contains `[[A]]`
2. Verify backlink edge exists from B to A
3. Edit A.md and reimport
4. Verify backlink edge still exists and points to the new A article

---

### Step 3: Remove unused dirty flag
**Status**: Not started

**Problem**: The `dirty` column exists but is never used, creating confusion.

**Change**: Create a migration to drop the `dirty` column and its index from the `nodes` table.

**Files to create**:
- `supabase/migrations/025_remove_dirty_flag.sql`

**Testable outcome**: Migration applies, column no longer exists.

---

### Step 4: Create vault_files table
**Status**: Not started

Create the `vault_files` table to track file metadata separately from indexed content.

**Files to create**:
- `supabase/migrations/026_create_vault_files.sql`

```sql
create table vault_files (
  id uuid primary key default gen_random_uuid(),
  path text unique not null,
  mtime bigint not null,
  size bigint not null,
  content_hash text not null,
  article_id uuid references nodes(id) on delete set null,
  status text not null default 'synced' check (status in ('synced', 'pending', 'error')),
  error_message text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index vault_files_status_idx on vault_files(status) where status != 'synced';
create index vault_files_article_idx on vault_files(article_id);
```

**Testable outcome**: Migration applies, table exists.

---

### Step 5: Implement vault scanner
**Status**: Not started

Create a module to list all markdown files with their metadata.

**Files to create**:
- `src/lib/vault-scanner.ts`

```typescript
interface ScannedFile {
  path: string;      // relative to vault root
  mtime: number;     // ms since epoch
  size: number;      // bytes
}

async function scanVault(vaultPath: string): Promise<ScannedFile[]>
```

**Testable outcome**: Script that prints all vault files with mtime and size.

---

### Step 6: Implement sync planner
**Status**: Not started

Create a pure function that compares scanned files against database state and produces a sync plan.

**Files to create**:
- `src/lib/sync-planner.ts`
- `src/lib/__tests__/sync-planner.test.ts`

```typescript
interface SyncPlan {
  toAdd: ScannedFile[];
  toUpdate: Array<{ file: ScannedFile; existingArticleId: string }>;
  toDelete: Array<{ path: string; articleId: string }>;
  unchanged: string[];
}

function planSync(scanned: ScannedFile[], dbFiles: VaultFileRecord[]): SyncPlan
```

**Testable outcome**: Unit tests covering:
- New file (in scan, not in DB)
- Changed file (mtime differs)
- Deleted file (in DB, not in scan)
- Unchanged file (mtime matches)
- Mtime changed but content same (touch without edit)

---

### Step 7: Implement sync executor
**Status**: Not started

Execute a sync plan: process additions, updates, and deletions.

**Files to create**:
- `src/lib/sync-executor.ts`

**Files to modify**:
- `src/lib/ingestion-chunks.ts` - update `vault_files` after successful import

**Testable outcome**:
1. Add a file, run sync, file appears in DB
2. Edit a file, run sync, content updates
3. Delete a file, run sync, article removed

---

### Step 8: Create sync API endpoint
**Status**: Not started

Wire up the sync operation as an API endpoint with progress streaming.

**Files to create**:
- `src/app/api/sync/route.ts`

**Testable outcome**: `curl -X POST /api/sync` triggers a full sync with progress output.

---

### Step 9: Add Sync UI
**Status**: Not started

Add a "Sync Vault" button to the UI, either replacing or alongside the current import flow.

**Files to modify**:
- `src/components/VaultBrowser.tsx` or create new `src/components/SyncButton.tsx`

**Testable outcome**: User can click Sync and see progress/results.

---

### Step 10: Automatic sync on startup
**Status**: Not started

Trigger sync automatically when the app loads.

**Options**:
- Client-side: Call `/api/sync` from a layout effect
- Server-side: Trigger in Next.js middleware (may block initial render)

**Considerations**:
- Should be non-blocking (background sync)
- Need UI indicator that sync is in progress
- Handle errors gracefully (don't break the app if sync fails)

**Testable outcome**: Start the app fresh, vault automatically synchronizes.

---

### Step 11 (Optional): File watcher for real-time sync
**Status**: Not started

For users who want changes reflected immediately without restarting the app.

**Approach**: Separate Node.js process using `chokidar` to watch `VAULT_PATH`.

**Files to create**:
- `scripts/watch-vault.ts`

**Considerations**:
- Debounce rapid changes (Obsidian saves frequently)
- Could run as a background service or integrated into dev server
- May be overkill - startup sync handles most use cases

**Testable outcome**: Edit a file in Obsidian, see it reflected in the app within seconds.

---

## Open Questions

1. **Conflict resolution**: What if a file changes while we're syncing it? (Probably rare, can ignore for v1)

2. **Large vaults**: At what scale does mtime-based scanning become slow? May need to batch or parallelize.

3. **Error handling**: How to surface import errors to users? Currently errors are logged but not visible.

4. **Backlinks**: When a file is re-imported, backlinks pointing TO it may break (UUIDs change). Need to update `backlink_edges` or use stable identifiers.

5. **Project associations**: Currently preserved during reimport via `restoreProjectAssociations`. Verify this works with the new sync flow.
