# Offline Data Cache

This directory contains JSON files used for offline mode.

## Setup

1. **Download the data** (requires running dev server):
   ```bash
   npm run dev  # in one terminal
   npm run script scripts/download-offline-data.ts  # in another
   ```

2. **Enable offline mode** in the UI:
   - Toggle "Offline mode" checkbox in `/topics` header
   - Setting is persisted in localStorage

## How It Works

When offline mode is enabled:
- All API routes check for local JSON files first
- If files exist, serve from `data/offline-cache/` instead of database
- If files missing, falls back to database (or errors if DB unavailable)

## Downloaded Files

- `topics-chunk.json` / `topics-article.json` - Keyword graph data
- `chunks-embeddings.json` - UMAP embeddings for /chunks view
- `keyword-associations-*.json` - Keyword→node mappings
- `nodes-*.json` - Full node content (chunks/articles)
- `projects.json` - Project nodes
- `clusters-*.json` - Precomputed clusters (8 resolutions × 2 node types)
- `manifest.json` - Metadata about download (timestamp, file sizes)

## Offline Capabilities

With offline mode enabled, these views work fully offline:
- `/topics` - Full keyword graph with content loading
- `/chunks` - UMAP visualization with embeddings
- Search - Not yet supported offline

## File Sizes

Typical dataset (1000 chunks):
- Total: ~10-50 MB (depends on number of nodes)
- Largest files: `chunks-embeddings.json`, `nodes-chunk.json`

## Updating

Re-run the download script to refresh with latest data from database.
