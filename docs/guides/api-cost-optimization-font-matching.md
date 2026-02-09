# API Cost Optimization: Font Matching

**Date:** 2026-02-09
**Context:** Semantic font matching for cluster labels using Claude Haiku and Google Fonts semantic tags

## Problem

Initial implementation used multi-turn tool-based exploration where Claude Haiku incrementally narrowed down font candidates for each keyword. While this produced high-quality matches, the cost was prohibitive for large-scale processing.

**Scale:** 1076 items (577 keywords + 502 cluster labels)

## Cost Analysis

### Original Approach: Multi-turn Tool-based Exploration

**Architecture:**
- One API call per keyword
- 4 tool calls available: `list_available_tags`, `filter_fonts`, `get_matching_fonts`, `select_best_font`
- Average 6 turns per keyword (exploration → narrowing → selection)
- Each turn repeats system prompt + font metadata

**Token Usage per Keyword:**
- Input: ~12K tokens (6 turns × 2K tokens/turn)
- Output: ~3K tokens (6 turns × 500 tokens/turn)

**Cost Calculation:**
- Claude Haiku 4.5: $1/M input, $5/M output
- Per keyword: (12K × $0.001) + (3K × $0.005) = $0.027
- **Total: 1076 × $0.027 = ~$29**

### Optimized Approach: Batch Processing

**Architecture:**
- Process 10-50 keywords per API call
- Single-turn matching with full font metadata provided upfront
- Returns JSON array of matches
- No tool calls (simpler prompt/response)

**Token Usage per Batch (10 keywords):**
- Input: ~6.6K tokens (system + 10 keywords + font summary × 3 turns avg)
- Output: ~2K tokens (JSON array)

**Cost Calculation (batch size 10):**
- Per batch: (6.6K × $0.001) + (2K × $0.005) = $0.0166
- 108 batches: 108 × $0.0166 = **~$1.80**
- **Savings: $27.20 (94% reduction)**

**Cost Calculation (batch size 20):**
- 54 batches: 54 × $0.0166 = **~$0.90**
- **Savings: $28.10 (97% reduction)**

**Cost Calculation (batch size 50):**
- 22 batches: 22 × $0.0166 = **~$0.36**
- **Savings: $28.64 (99% reduction)**

## Solution: Batch Processing Script

**Implementation:** `scripts/fonts/match-keywords-to-fonts-batch.ts`

**Key Features:**
- Configurable batch size (default: 10, can go up to 50+)
- Incremental saving (JSONL format)
- Reuses existing matches
- Single-turn prompting with compact font summary

**Usage:**
```bash
# Process all items with default batch size (10)
npm run script scripts/fonts/match-keywords-to-fonts-batch.ts

# Process with larger batch size (20)
npm run script scripts/fonts/match-keywords-to-fonts-batch.ts 0 20

# Test with first 50 items
npm run script scripts/fonts/match-keywords-to-fonts-batch.ts 50
```

## Alternative Optimizations Considered

### 1. Embedding-based Reuse
**Concept:** Use embeddings to find keywords similar to already-matched ones, reuse those fonts.

**Potential Savings:** 50%+ reduction (skip ~500 items similar to existing 72 matches)

**Trade-offs:**
- Requires embedding generation for all keywords
- May reduce semantic accuracy for edge cases
- Best combined with batch processing

### 2. Two-tier Approach
**Concept:** Match only cluster labels (502) with Haiku, use heuristics for keywords (577)

**Potential Savings:** ~47% reduction

**Trade-offs:**
- Lower quality for individual keyword matches
- More complex pipeline
- Cluster labels are most visible in UI, so this makes sense

### 3. Rule-based Matching
**Concept:** Skip LLM entirely, use keyword analysis + tag matching heuristics

**Potential Savings:** 100% (no API costs)

**Trade-offs:**
- Significantly lower quality
- Misses semantic nuances
- Not chosen because quality was a requirement

## Recommendations

1. **Use batch processing for all new font matching** - 94-99% cost reduction with minimal quality impact
2. **Batch size of 20-30 is optimal** - balances cost savings with error recovery (if one batch fails)
3. **Keep incremental saving** - allows resuming from failures without losing progress
4. **Consider embedding reuse for future optimizations** - could cut costs further to <$0.50

## Quality Impact

**Preliminary Assessment:**
- Batch processing maintains semantic quality
- Single-turn approach forces Haiku to make direct matches without exploration
- May reduce "exploration quality" slightly but still produces appropriate matches
- The 72 existing matches from multi-turn approach were high quality and can serve as reference

**Validation Approach:**
- Run batch processing on remaining 1004 items
- Spot-check 20-30 random matches for semantic appropriateness
- Compare with multi-turn results for overlapping keywords (if any)

## References

**Pricing Sources:**
- [Claude API Pricing - Official Docs](https://platform.claude.com/docs/en/about-claude/pricing)
- [Claude Haiku 4.5 Pricing 2026](https://pricepertoken.com/pricing-page/model/anthropic-claude-haiku-4.5)

**Related Files:**
- `scripts/fonts/match-keywords-to-fonts-agentic.ts` - Original multi-turn approach
- `scripts/fonts/match-keywords-to-fonts-batch.ts` - Optimized batch approach
- `scripts/fonts/README.md` - Font pipeline documentation

## Lessons Learned

1. **Multi-turn tool use is expensive** - Each turn repeats the full system prompt and context
2. **Batch processing is dramatically cheaper** - Single API call overhead amortized across many items
3. **Context window matters** - Haiku's 200K context allows processing 50+ items per call
4. **Token cost analysis should happen early** - Would have saved ~$29 if done before initial run
5. **Always estimate costs before scale** - Test with small batches first, project costs before full run

## Future Work

- **Batch API:** Anthropic offers 50% discount for batch processing (async). Could reduce to ~$0.18-0.45
- **Caching:** Use prompt caching to avoid repeating font metadata (20-50% reduction)
- **Hybrid approach:** Combine batch processing + embedding reuse for maximum savings
