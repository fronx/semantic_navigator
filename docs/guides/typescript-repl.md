# TypeScript REPL for Development

This guide explains how to use an interactive TypeScript REPL to experiment with the import infrastructure, query the database, and prototype changes.

## Starting the REPL

Start a TypeScript REPL with environment variables loaded:

```bash
npm run script
```

This gives you:
- Full TypeScript support with type checking
- Access to all environment variables from `.env.local`
- Top-level `await` support
- Ability to import project modules

## Importing Functions

You can import any function from the project:

```typescript
import { createServerClient } from './src/lib/supabase'
import { parseMarkdown } from './src/lib/parser'
import { generateEmbedding } from './src/lib/embeddings'
import { extractKeywords } from './src/lib/summarization'
import { ingestMarkdownFile } from './src/lib/ingestion'
```

### Common Imports

**Database client:**
```typescript
import { createServerClient } from './src/lib/supabase'
const supabase = createServerClient()

// Query the database
const { data, error } = await supabase.from('keywords').select('*')
console.log(data)
```

**Parsing and ingestion:**
```typescript
import { parseMarkdown } from './src/lib/parser'
import { ingestMarkdownFile } from './src/lib/ingestion'

const content = `# Test\nSome content`
const result = await parseMarkdown(content, 'test.md')
```

**Embeddings and summarization:**
```typescript
import { generateEmbedding } from './src/lib/embeddings'
import { extractKeywords } from './src/lib/summarization'

const embedding = await generateEmbedding('test query')
const keywords = await extractKeywords('article content', 'Article Title')
```

## Reloading After Edits

The REPL doesn't automatically reload when you edit source files. Two approaches:

### Option 1: Restart the REPL

1. Exit: Press `Ctrl+D` or type `.exit`
2. Restart: `npm run script`
3. Re-import your modules

### Option 2: Delete from require cache (advanced)

```typescript
// After editing src/lib/parser.ts
delete require.cache[require.resolve('./src/lib/parser')]
import('./src/lib/parser').then(m => {
  parseMarkdown = m.parseMarkdown
})
```

**Note:** This can be unreliable with complex dependencies. Restarting the REPL is simpler and safer.

### Option 3: Use an iterative script

Instead of the REPL, create a script file you edit and re-run:

```bash
# Create the file
touch scripts/experiment.ts

# Edit it, then run repeatedly:
npm run script scripts/experiment.ts
```

This is often faster for iterative development than reloading in the REPL.

## Useful REPL Commands

```typescript
.help        // Show all REPL commands
.exit        // Exit the REPL
.clear       // Clear the REPL context
.editor      // Enter editor mode (multi-line input)
```

## Example Session

```typescript
// 1. Start REPL
$ npm run script

// 2. Import functions
> import { createServerClient } from './src/lib/supabase'
> const supabase = createServerClient()

// 3. Check for duplicate keywords
> const { data } = await supabase
  .from('keywords')
  .select('keyword, count(*)')
  .group('keyword')
  .having('count(*) > 1')

// 4. See results
> console.table(data)

// 5. Delete duplicates (example - be careful!)
> await supabase
  .from('keywords')
  .delete()
  .in('id', [/* specific IDs */])
```

## Tips

- **Use `.editor` for multi-line code**: Press `Ctrl+D` when done
- **Save useful snippets**: Create a `scripts/snippets.md` file with common patterns
- **Check errors carefully**: Type errors will show inline
- **Use `console.table(data)`**: Better visualization for query results
- **Import types too**: `import type { Node, Keyword } from './src/types/supabase'`

## Clearing the Database

Before re-indexing, you may want to clear existing data:

**Local database:**
```bash
npx supabase db reset  # Safe - only affects local
```

**Remote database** (in REPL):
```typescript
const supabase = createServerClient()

// Delete in reverse dependency order
await supabase.from('chunk_edges').delete().neq('id', '')
await supabase.from('containment_edges').delete().neq('id', '')
await supabase.from('backlink_edges').delete().neq('id', '')
await supabase.from('keywords').delete().neq('id', '')
await supabase.from('nodes').delete().neq('id', '')
```

**Warning:** Be absolutely certain you're connected to the right database before deleting data!
