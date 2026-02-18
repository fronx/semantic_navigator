# Iterating on Chunk Cluster Labels

## What this is

Chunk clusters in ChunksView are labeled by sending text excerpts from each cluster to an LLM.
The prompt determines label quality dramatically. This guide explains how to iterate on the prompt.

## The iteration script

```bash
npm run script scripts/iterate-chunk-labels.ts          # coarse clusters (default)
npm run script scripts/iterate-chunk-labels.ts -- --fine              # fine clusters
npm run script scripts/iterate-chunk-labels.ts -- --clusters=5,7,11  # specific clusters only
```

The script:
1. Reads `data/chunks-layout.json` for cluster assignments and chunk IDs
2. Fetches chunk content from Supabase (or offline cache)
3. Sends all clusters in one batched LLM call
4. Prints a side-by-side table (old label vs new) plus excerpts per cluster

**Edit the `PROMPT` constant at the top of the script.** Everything else is plumbing.

## Workflow

1. Run the full coarse set to get a baseline
2. Read the EXCERPTS section to understand what each cluster actually contains
3. Identify labels that feel wrong — check the excerpts to understand why
4. Update the prompt; re-run the affected clusters with `--clusters=N,M`
5. When satisfied, run the full set once more to confirm nothing regressed
6. Ship: update `generateChunkClusterLabels` in `src/lib/llm.ts` and delete the cache

## Shipping a new prompt

Once the prompt is settled:

1. Copy the `PROMPT` function body from the script into `generateChunkClusterLabels` in [src/lib/llm.ts](../../src/lib/llm.ts)
2. Update the model in that function if needed (currently `claude-sonnet-4-6`)
3. Delete the cache to force regeneration:
   ```bash
   rm data/chunks-layout.json
   ```
4. Open ChunksView — the new labels will be generated on first load

## What makes a good label

Labels float over map regions as chapter-title signposts. Good labels:

- **2 words** (3 only if essential). Short enough to read at a glance.
- **Intriguing, not descriptive.** "what's that?" not "I see."
- **Resonate, don't retheorize.** Treat the text as philosophical poetry. Don't relabel the cluster with an academic concept — find an angle that vibrates with what's actually there.
- **Noun phrases** preferred. If using a verb, make it blunt and specific ("maps lie", "concepts fail"), not poetic or soft ("thoughts drift", "patterns emerge").
- **No verb gerunds** ("-ing" as a verb form). Nouns ending in -ing are fine ("sneezing", "meaning").
- **Don't lift words from the excerpts.** The model will quote salient words from the text (e.g., "elevated" from a cluster that uses the word "elevated sneezing"). Find your own angle.

## Failure modes to watch for

| Symptom | Cause | Fix |
|---------|-------|-----|
| Label quotes the text ("elevated sneezing") | Model lifts salient words | Add "do not lift words from excerpts" rule |
| Soft subject-verb ("patterns emerge") | Default hedged style | Strengthen noun-phrase preference; add explicit bad examples |
| Flat noun pair ("concept limit") | Overcorrected from verb-avoidance | Add examples that show the right noun-phrase style |
| Retheorizing ("soft persuasion" for a commitment cluster) | Academic framing | Add "treat as philosophical poetry, not academic text" |
| Gerunds despite the rule | Rule not emphatic enough | Clarify verb vs noun gerunds; show bad examples |
| Labels vary wildly between runs | Natural stochasticity | Run `--clusters=N` a few times to sample variance |

## Model choice

The script uses `claude-sonnet-4-6` for iteration (better instruction-following).
Production (`src/lib/llm.ts`) can use the same — labels are generated once and cached,
so the cost difference is negligible.
