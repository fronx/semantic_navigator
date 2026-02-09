# Keyword Font Matching Pipeline

This directory contains scripts for semantically matching Google Fonts to keywords and cluster labels.

## Overview

The font matching system uses Claude Haiku to explore Google Fonts' semantic tag space (Expressive, Quality, Sans, Serif, etc.) and select fonts that capture the meaning of each keyword.

## Quick Start

Run the complete pipeline with a single command:

```bash
npm run script scripts/prepare-keyword-fonts.ts
```

This will:
1. Fetch Google Fonts metadata (if not cached)
2. Match keywords to fonts using Haiku (if not done)
3. Download font files (.woff2) to `./public/fonts/google/`
4. Generate TypeScript mapping at `./src/lib/keyword-fonts.ts`

## Pipeline Steps

### Step 1: Fetch Metadata

**Output:** `./data/google-fonts-tags-cache.json`

Fetches ~1886 fonts with semantic tags from Google Fonts API. Tags include:
- `/Expressive/Business`, `/Expressive/Calm`, `/Expressive/Innovative`
- `/Quality/Spacing`, `/Quality/Readability`
- `/Sans/Geometric`, `/Serif/Humanist`
- `/Theme/Distressed`, `/Technology/Computer Science`
- And 70+ more

Cached locally to avoid repeated API calls.

### Step 2: Match Keywords

**Script:** `match-keywords-to-fonts-agentic.ts`
**Output:** `./data/agentic-keyword-font-results.jsonl` (incremental)
**Output:** `./data/agentic-keyword-font-results.json` (final)

Uses Claude Haiku with tool-based exploration:

1. **Exploration phase**: Haiku picks primary semantic tag → sees what combinations exist → narrows to 3-20 candidates
2. **Selection phase**: Compares top 5 by popularity with full semantic profiles → picks best match

**Example:**
```bash
# Process all keywords with 6 concurrent Haiku instances
npm run script scripts/fonts/match-keywords-to-fonts-agentic.ts

# Process 50 keywords with 3 instances
npm run script scripts/fonts/match-keywords-to-fonts-agentic.ts 50 3
```

**Features:**
- Parallel processing with configurable concurrency (default: 6)
- Incremental JSONL saves for crash safety
- Two-stage selection for better semantic matching
- 0 = process all keywords (default)

### Step 3: Download Fonts

**Output:** `./public/fonts/google/*.woff2`

Downloads .woff2 files for each matched font from Google Fonts. Prefers regular/400 weight, falls back to first available variant.

### Step 4: Generate Mapping

**Output:** `./src/lib/keyword-fonts.ts`

Generates TypeScript mapping:

```typescript
export const KEYWORD_FONTS: Record<string, string> = {
  "inspiration": "Monoton",
  "curtains": "Dancing Script",
  // ... 577 entries
};

export function getFontPath(keyword: string): string {
  // Returns path to .woff2 file or fallback
}
```

## Individual Scripts

These scripts can be run independently for exploration or testing:

### `explore-font-categories.ts`

Explore Google Fonts metadata and tags:

```bash
# List all font categories (serif, sans-serif, etc.)
npm run script scripts/fonts/explore-font-categories.ts list-categories

# List all semantic tags
npm run script scripts/fonts/explore-font-categories.ts list-tags

# Inspect full metadata
npm run script scripts/fonts/explore-font-categories.ts inspect

# Test matching a single keyword
npm run script scripts/fonts/explore-font-categories.ts match "machine learning"
```

### `test-keyword-font-matching.ts`

Initial validation script (10 keywords by default):

```bash
# Test matching with 10 keywords
npm run script scripts/fonts/test-keyword-font-matching.ts

# Test with 25 keywords
npm run script scripts/fonts/test-keyword-font-matching.ts 25
```

This was the first approach (Haiku recommends tags → filter for ALL tags). Results showed it was too restrictive, leading to the agentic tool-based approach.

### `match-keywords-to-fonts-agentic.ts`

Production matching script (see Step 2 above). This is the tool-based approach where Haiku explores incrementally.

## Configuration

Set in `.env.local`:

```env
GOOGLE_FONTS_API_KEY=your_key_here
ANTHROPIC_API_KEY=your_key_here
```

Get a Google Fonts API key:
1. Go to https://console.cloud.google.com/
2. Create a new project (or select existing)
3. Enable "Web Fonts Developer API"
4. Go to "Credentials" → "Create Credentials" → "API Key"

## Force Refresh

Re-run specific steps:

```bash
# Re-run matching (keep existing cache and downloads)
npm run script scripts/prepare-keyword-fonts.ts --force-match

# Re-download fonts (keep existing cache and results)
npm run script scripts/prepare-keyword-fonts.ts --force-download

# Both
npm run script scripts/prepare-keyword-fonts.ts --force-match --force-download
```

## Output Files

```
data/
  google-fonts-tags-cache.json      # Font metadata (1886 fonts)
  agentic-keyword-font-results.jsonl # Results (incremental, JSONL)
  agentic-keyword-font-results.json  # Results (final, formatted)

public/fonts/google/
  *.woff2                            # Downloaded font files

src/lib/
  keyword-fonts.ts                   # TypeScript mapping (generated)
```

## Integration

After running the pipeline, use in your components:

```typescript
import { getFontPath } from "@/lib/keyword-fonts";

const ClusterLabel = ({ label }: { label: string }) => {
  const fontPath = getFontPath(label);
  // Use fontPath to load font in Three.js or CSS
};
```

## Architecture

**Why tool-based exploration?**

Initial approach: Haiku recommends 2-4 tags → filter fonts requiring ALL tags at weight ≥60.
**Problem:** Only 5/10 keywords had matches (too restrictive).

**Solution:** Let Haiku explore incrementally:
1. Pick PRIMARY semantic tag
2. See how many fonts have it
3. See what other tags commonly pair with it
4. Narrow down to manageable set
5. Compare full semantic profiles

This matches how a human would navigate the space: start broad, narrow based on what exists, then make final decision with full context.

## Credits

Font matching uses:
- Google Fonts API with semantic tags
- Claude Haiku 4.5 for semantic reasoning
- Anthropic tool use API for incremental exploration
