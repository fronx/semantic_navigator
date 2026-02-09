# Scripts

Utility scripts for database inspection, maintenance, and development.

## Organization

Scripts are organized into subdirectories by purpose:

- **`investigations/`** - Temporary debugging, benchmarking, and verification scripts
  - Created during active development to investigate issues
  - Should be deleted once the issue is resolved
  - See [investigations/README.md](./investigations/README.md)

- **`maintenance/`** - Permanent operational scripts for database and cluster management
  - Cluster computation (communities, topics, PCA)
  - Data quality checks and cleanup
  - Import/migration utilities
  - See [maintenance/README.md](./maintenance/README.md)

- **Root** - Frequently-used utility scripts referenced in documentation

## Running Scripts

All scripts support environment variable loading from `.env.local`:

```bash
npm run script scripts/<name>.ts [args...]
npm run script scripts/maintenance/<name>.ts [args...]
npm run script scripts/investigations/<name>.ts [args...]
```

**Interactive REPL**: Run `npm run script` with no arguments to start an interactive TypeScript REPL. See [docs/guides/typescript-repl.md](../docs/guides/typescript-repl.md) for details.

### Passing Arguments

Scripts can accept command line arguments. Common patterns:

**Numeric limits** (using `cli-utils`):
```bash
npm run script scripts/repl-explore-chunking.ts 10    # Process 10 files
npm run script scripts/repl-explore-chunking.ts all   # Process all files
```

**File paths**:
```bash
npm run script scripts/query-nodes.ts <uuid> [uuid...]
```

**Boolean flags**:
```bash
npm run script scripts/some-script.ts --dry-run
```

Scripts access arguments via `process.argv`. Use the `cli-utils` library for common parsing patterns:

```typescript
import { parseLimit } from '@/lib/cli-utils'

// Parse a limit with support for "all", "unlimited", or "0" for no limit
const limit = parseLimit(process.argv[2], 5) // default: 5
```

## Root Utility Scripts

### repl-explore-chunking.ts

Interactive REPL for exploring how files get chunked and what keywords are extracted. Loads data from your vault and provides pre-computed chunks, keywords, embeddings, and similarity matrices.

```bash
# Process 5 files (default)
npm run script scripts/repl-explore-chunking.ts

# Process 10 files
npm run script scripts/repl-explore-chunking.ts 10

# Process all files in the folder
npm run script scripts/repl-explore-chunking.ts all
```

After loading, you'll have an interactive REPL with access to:
- `files`, `chunksMap`, `allChunks` - Raw file data and parsed chunks
- `keywords`, `keywordCounts` - Extracted keywords and their frequencies
- `embeds`, `matrix` - Keyword embeddings and similarity matrix
- `topSimilar`, `clusters` - Similarity relationships and clusters
- All utility libraries (`vault`, `parser`, `chunker`, etc.)

See the script header for full documentation and available variables.

### query-nodes.ts

Look up specific nodes by UUID.

```bash
npm run script scripts/query-nodes.ts <uuid> [uuid...]
```

For detailed information about maintenance and investigation scripts, see the README files in their respective subdirectories.
