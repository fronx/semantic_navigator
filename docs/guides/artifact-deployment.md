# Artifact Deployment Guide

Deploy a read-only, self-contained ChunksView as a public web page. No database credentials, no API keys needed at runtime.

## Prerequisites

Before generating the artifact, ensure the following exist locally:

1. **Offline cache data** — run the download script (requires dev server):
   ```bash
   npm run dev  # in a separate terminal
   npm run script scripts/download-offline-data.ts
   ```
   This creates `data/offline-cache/nodes-chunk.json` and `nodes-article.json`.

2. **Pre-computed UMAP layout** — open ChunksView in the browser (`http://localhost:3000/chunks`) and wait for the UMAP progress bar to complete. This creates `data/chunks-layout.json` with positions, edges, cluster assignments, and labels.

## Generate Artifact Data

```bash
npm run script scripts/generate-artifact-data.ts
```

This reads from the offline cache and dev server, producing `data/artifact/`:

| File | Contents | Size |
|------|----------|------|
| `chunks-embeddings.json` | Chunk metadata (content, summary, source path) — vectors stripped | ~600 KB |
| `chunks-layout.json` | Pre-computed UMAP positions, edges, clusters, labels | ~300 KB |
| `nodes-chunk.json` | Full chunk content for the article reader sidebar | ~300 KB |
| `nodes-article.json` | Article summaries for the article reader sidebar | ~50 KB |

Total: ~1.2 MB of static data.

## Local Testing

Visit `http://localhost:3000/artifact` while the dev server is running. Verify:

- ChunksView loads instantly (no UMAP spinner — layout is pre-computed)
- Chunk cards are visible and colored by cluster
- Clicking a chunk opens the article reader sidebar
- No requests to Supabase or OpenAI in the browser network tab

## Deployment Status

**Ready to deploy.** Previous blockers have been resolved.

### What was learned about deployment

- `vercel --prod` (CLI) uploads local files including gitignored `data/artifact/` ✓
- `vercel build` uses `.vercel/project.json` for settings — run `vercel pull --yes` after dashboard changes
- Vercel project Node.js version was set to 24.x (unsupported) — changed to 22.x in dashboard ✓
- `instrumentation.ts` must split Node.js-only code into `instrumentation.node.ts` so the Edge bundler doesn't flag `fs`/`path` imports ✓
- `umapper` local dependency was removed by deleting MapView entirely (D3 renderer was legacy, R3F is the primary renderer) ✓

## Deploy to Vercel

### 1. Install Vercel CLI

```bash
npm i -g vercel
```

### 2. Link the project

From the semantic_navigator repo root:

```bash
vercel link
```

Follow the prompts to create a new Vercel project (or link an existing one). Framework detection should pick up Next.js automatically.

### 3. Generate artifact data

```bash
npm run script scripts/generate-artifact-data.ts
```

The `data/artifact/` directory is gitignored (it's a build artifact, not source). The Vercel CLI uploads it anyway — `vercel --prod` respects `.vercelignore`, not `.gitignore`.

### 4. Set environment variables

No Supabase/OpenAI/Anthropic env vars are needed — the artifact routes only serve static JSON. However, the main app's build may reference these variables. Set dummy values if the build fails without them:

```bash
vercel env add NEXT_PUBLIC_SUPABASE_URL        # any URL
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY    # any string
```

Or skip this if the build succeeds without them (artifact routes don't import Supabase).

### 5. Deploy

```bash
vercel --prod
```

> **Note:** Always deploy via the Vercel CLI (`vercel --prod`), not by pushing to git. The CLI uploads your local files directly and ignores `.vercelignore` — but **not** `.gitignore`. This means `data/artifact/` (which is gitignored) gets included in the upload. A git-push–triggered deployment would not include these files.

### 6. Configure custom domain

In the Vercel dashboard (or via CLI):

```bash
vercel domains add semantic.fronx.de
```

Then add a CNAME record in your DNS provider:

```
semantic.fronx.de  CNAME  cname.vercel-dns.com
```

Vercel handles TLS automatically. After DNS propagation, `https://semantic.fronx.de/artifact` serves the ChunksView artifact.

### 7. Optional: redirect root to /artifact

If you want `semantic.fronx.de` to go directly to the artifact, add a redirect in `next.config.ts`:

```typescript
const nextConfig = {
  // ...existing config...
  async redirects() {
    return [{ source: "/", destination: "/artifact", permanent: false }];
  },
} satisfies NextConfig;
```

## Architecture

The artifact is a separate set of Next.js routes under `src/app/artifact/`:

```
src/app/artifact/
  page.tsx                              Entry point (renders ChunksView)
  api/chunks/embeddings/route.ts        Serves stripped embeddings JSON
  api/chunks/layout/route.ts            Serves pre-computed layout, no-op POST/DELETE
  api/chunks/layout/recluster/route.ts  No-op (clusters are fixed)
  api/nodes/[id]/route.ts               Node lookup from JSON (for article reader)
  api/reader/articles/route.ts          Eager article cache from JSON
  api/search/route.ts                   Returns empty results
```

ChunksView accepts an `apiBase` prop (set to `"/artifact"`) that prefixes all fetch calls, routing them to these artifact-specific endpoints. The existing app routes at `/api/...` are completely untouched.

### What's different from the main app

- **No UMAP computation** — positions are pre-computed; the UMAP hook receives an empty embedding array and idles
- **No search** — search input is hidden (`hideSearch` prop); the search route returns `[]`
- **No database** — all routes serve from `data/artifact/*.json` files
- **No recluster** — cluster resolution sliders trigger a no-op endpoint that preserves the existing cluster assignments
- **Article reader** — works fully, loading articles and chunks from static JSON files grouped by `source_path`

## Re-generating

When the vault content changes:

1. Re-run ingestion in the main app
2. Delete `data/chunks-layout.json` (or click "Redo UMAP" in ChunksView)
3. Open ChunksView and wait for UMAP + clustering to complete
4. Re-run `download-offline-data.ts` then `generate-artifact-data.ts`
5. Redeploy: `vercel --prod`
