# ADR-005: Hierarchical Keyword Bubbling for Semantic Map

## Status
Accepted (implemented 2024-12-28)

## Context
The Map view shows connections between articles via shared keywords. Currently:
- Keywords are only attached to **paragraph** nodes
- The map shows keywords that appear on 2+ articles (exact text match)
- We want to add **semantic matching** (e.g., "agency" ↔ "agent" at 70% similarity)

**Performance problem**: With ~11K paragraph-level keywords, computing semantic similarity is expensive:
- Top-K approach (1 RPC per keyword): ~47 seconds for 1000 keywords
- Cross-join in SQL: times out (500K+ comparisons of 1536-dim vectors)

## Decision
Bubble keywords up through the hierarchy using LLM-based reduction:

```
paragraph keywords (many, specific)
    ↓ reduce via Haiku
section keywords (fewer, broader)
    ↓ reduce via Haiku
article keywords (5-10, core themes)
```

Then compute semantic similarity only on article-level keywords.

### Reduction Logic
Tested in `scripts/test-keyword-reduction.ts`:

**Paragraph → Section reduction prompt:**
```
Task: Select or synthesize 3-7 keywords that best represent this SECTION as a whole.

Guidelines:
- Prefer keywords that appear across multiple paragraphs
- Merge near-synonyms into a single representative term
- Keep proper nouns and technical terms
- Drop keywords too specific to one paragraph
- May synthesize higher-level keywords
```

**Section → Article reduction prompt:**
```
Task: Select or synthesize 5-10 keywords that best represent this ARTICLE as a whole.

Guidelines:
- Prefer keywords that appear across multiple sections (core themes)
- Merge near-synonyms into a single representative term
- Keep proper nouns and technical terms
- Drop keywords too specific to one section
- May synthesize a keyword capturing the article's main thesis
```

### Test Results
For one article ("Towards a Scale-free Model of Agency"):
- 74 paragraph-level keywords → 26 section-level → 8 article-level
- Final keywords: `["agency", "coherence", "self-modeling", "substrate independence", "justification costs", "meta-agency", "idea-space vs substrate-space", "free energy principle"]`

### Performance Impact
- ~100 articles × ~8 keywords = ~800 article-level keywords
- Cross-join: 320K comparisons (vs 500K+ paragraph-level)
- Plus: fewer, higher-quality keywords = better semantic matches

## Implementation Plan

### 1. Schema
No changes needed - `keywords.node_id` already accepts any node type.

### 2. Summarization Functions
Add to `src/lib/summarization.ts`:
```typescript
export async function reduceKeywordsForSection(
  sectionSummary: string,
  paragraphKeywords: string[]
): Promise<string[]>

export async function reduceKeywordsForArticle(
  articleTitle: string,
  sectionKeywords: { title: string; keywords: string[] }[]
): Promise<string[]>
```

### 3. Ingestion Changes
In `src/lib/ingestion.ts`, after processing all paragraphs in a section:
```typescript
// Check if section already has keywords
const { count } = await supabase
  .from("keywords")
  .select("*", { count: "exact", head: true })
  .eq("node_id", sectionNode.id);

if (!count) {
  // Gather paragraph keywords for this section
  const paragraphKeywords = await getKeywordsForChildren(sectionNode.id);

  // Reduce and store section keywords
  const sectionKeywords = await reduceKeywordsForSection(
    sectionNode.summary,
    paragraphKeywords
  );

  for (const keyword of sectionKeywords) {
    const embedding = await generateEmbedding(keyword, { type: "keyword" });
    await supabase.from("keywords").insert({
      keyword,
      embedding,
      node_id: sectionNode.id,
    });
  }
}
```

Same pattern for articles after all sections are processed.

### 4. Map Query Changes
Update `/api/map` to filter keywords by node type:
```typescript
// Only use article-level keywords for the map
const { data: keywords } = await supabase
  .from("keywords")
  .select("keyword, node_id, nodes!inner(node_type)")
  .eq("nodes.node_type", "article");
```

### 5. Semantic Similarity
With fewer article-level keywords, the cross-join becomes feasible, or we can use the Top-K approach with acceptable latency.

## Files Changed
- `src/lib/summarization.ts` - Add reduction functions
- `src/lib/ingestion.ts` - Add keyword bubbling after section/article processing
- `src/app/api/map/route.ts` - Filter to article-level keywords

## Test Scripts Created
- `scripts/test-keyword-reduction.ts` - Tests the reduction prompts
- `scripts/test-keyword-similarity-perf.ts` - Performance benchmarks
- `scripts/test-crossjoin-perf.ts` - Cross-join performance test

## Migration for Existing Data
Re-importing existing files will detect missing section/article keywords and add them (idempotent).
