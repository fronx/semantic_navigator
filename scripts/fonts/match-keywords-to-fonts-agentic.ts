/**
 * Agentic keyword-to-font matching using Claude Haiku with tools
 *
 * This script gives Haiku tools to explore the Google Fonts tag space incrementally.
 * Haiku navigates the font database by querying for counts and available combinations,
 * without loading the entire dataset into its context.
 *
 * Features:
 * - Two-stage selection: exploration → semantic comparison
 * - Parallel processing with multiple Haiku instances
 * - JSON-based parsing for reliable extraction
 *
 * Usage:
 *   npm run script scripts/match-keywords-to-fonts-agentic.ts [limit] [concurrency]
 *
 * Arguments:
 *   limit: Number of keywords to process (default: 0 = all keywords)
 *   concurrency: Number of parallel Haiku instances (default: 3)
 *
 * Examples:
 *   npm run script scripts/match-keywords-to-fonts-agentic.ts        # Process all keywords with 3 parallel instances
 *   npm run script scripts/match-keywords-to-fonts-agentic.ts 0 5    # Process all keywords with 5 parallel instances
 *   npm run script scripts/match-keywords-to-fonts-agentic.ts 50 5   # Process 50 keywords with 5 parallel instances
 */

import { createServerClient } from "@/lib/supabase";
import { anthropic } from "@/lib/llm";
import fs from "fs/promises";
import path from "path";

// ============================================================================
// Types
// ============================================================================

interface FontTag {
  name: string; // e.g., "/Expressive/Business"
  weight: number; // 0-100 confidence score
}

interface GoogleFont {
  family: string;
  variants: string[];
  category: string;
  tags?: FontTag[];
}

interface TagCache {
  timestamp: string;
  fonts: GoogleFont[];
  allTags: string[];
  tagsByCategory: Record<string, string[]>;
}

interface FontFilterResult {
  matchingFontCount: number;
  availableNextTags: Array<{ tag: string; fontCount: number }>;
}

interface FontMatch {
  family: string;
  category: string;
  matchingTags: Array<{ name: string; weight: number }>;
  allTags: Array<{ name: string; weight: number }>; // Complete semantic profile
}

// ============================================================================
// Cache Loading
// ============================================================================

const CACHE_PATH = "./data/google-fonts-tags-cache.json";

async function loadFontCache(): Promise<TagCache> {
  try {
    const cacheData = await fs.readFile(CACHE_PATH, "utf-8");
    return JSON.parse(cacheData);
  } catch {
    throw new Error(`Font cache not found at ${CACHE_PATH}. Run test-keyword-font-matching.ts first to create cache.`);
  }
}

// ============================================================================
// Font Query Tools (provided to Haiku)
// ============================================================================

/**
 * List all available tags organized by category.
 * Used by Haiku to see what tags exist before making selections.
 */
function listAvailableTags(cache: TagCache): Record<string, string[]> {
  return cache.tagsByCategory;
}

/**
 * Filter fonts by current tag selection and return:
 * 1. Count of fonts matching current tags
 * 2. What other tags commonly appear in those fonts (sorted by frequency)
 *
 * This lets Haiku see what combinations are actually available.
 */
function filterFontsAndGetNextTags(
  cache: TagCache,
  currentTags: string[],
  minWeight: number
): FontFilterResult {
  // Find fonts that have ALL current tags with sufficient weight
  const matchingFonts = cache.fonts.filter((font) => {
    if (!font.tags) return false;

    for (const requiredTag of currentTags) {
      const fontTag = font.tags.find((t) => t.name === requiredTag);
      if (!fontTag || fontTag.weight < minWeight) {
        return false;
      }
    }
    return true;
  });

  // Count how often each OTHER tag appears in matching fonts
  const tagCounts = new Map<string, number>();
  for (const font of matchingFonts) {
    if (!font.tags) continue;

    for (const tag of font.tags) {
      // Skip tags already selected
      if (currentTags.includes(tag.name)) continue;

      // Only count tags with sufficient weight
      if (tag.weight >= minWeight) {
        tagCounts.set(tag.name, (tagCounts.get(tag.name) || 0) + 1);
      }
    }
  }

  // Sort by frequency (most common first)
  const availableNextTags = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, fontCount: count }))
    .sort((a, b) => b.fontCount - a.fontCount);

  return {
    matchingFontCount: matchingFonts.length,
    availableNextTags,
  };
}

/**
 * Get the actual list of fonts matching the selected tags with complete tag profiles.
 * Called by Haiku once it's narrowed down to a good combination.
 * Returns ALL tags for each font so Haiku can see the complete semantic personality.
 */
function getMatchingFonts(
  cache: TagCache,
  selectedTags: string[],
  minWeight: number
): FontMatch[] {
  const matches: FontMatch[] = [];

  for (const font of cache.fonts) {
    if (!font.tags) continue;

    const matchingTags: Array<{ name: string; weight: number }> = [];
    let hasAllTags = true;

    for (const requiredTag of selectedTags) {
      const fontTag = font.tags.find((t) => t.name === requiredTag);
      if (!fontTag || fontTag.weight < minWeight) {
        hasAllTags = false;
        break;
      }
      matchingTags.push({ name: fontTag.name, weight: fontTag.weight });
    }

    if (hasAllTags) {
      // Include ALL tags sorted by weight (so Haiku sees complete personality)
      const allTags = font.tags
        .map((t) => ({ name: t.name, weight: t.weight }))
        .sort((a, b) => b.weight - a.weight);

      matches.push({
        family: font.family,
        category: font.category,
        matchingTags,
        allTags,
      });
    }
  }

  // Sort by popularity (fonts appear in popularity order in cache)
  return matches;
}

/**
 * Get full semantic profiles for specific fonts to enable final selection.
 * Shows complete tag breakdown so Haiku can pick the best semantic match.
 */
function getFontProfiles(
  cache: TagCache,
  fontFamilies: string[]
): Array<{ family: string; category: string; tags: Array<{ name: string; weight: number }> }> {
  const profiles: Array<{ family: string; category: string; tags: Array<{ name: string; weight: number }> }> = [];

  for (const family of fontFamilies) {
    const font = cache.fonts.find((f) => f.family === family);
    if (!font || !font.tags) continue;

    // Sort tags by weight (highest first) to show most defining characteristics
    const tags = font.tags
      .map((t) => ({ name: t.name, weight: t.weight }))
      .sort((a, b) => b.weight - a.weight);

    profiles.push({
      family: font.family,
      category: font.category,
      tags,
    });
  }

  return profiles;
}

// ============================================================================
// Tool Schemas for Anthropic API
// ============================================================================

const TOOL_SCHEMAS = [
  {
    name: "list_available_tags",
    description: "List all available Google Fonts semantic tags organized by category. Use this first to see what tags exist before selecting.",
    input_schema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "filter_fonts",
    description: "Filter fonts by selected tags and see what other tags commonly appear. Returns font count and available next tags sorted by frequency. Use this to explore tag combinations incrementally.",
    input_schema: {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Array of tag paths (e.g., ['/Expressive/Business', '/Sans/Geometric'])",
        },
        min_weight: {
          type: "number",
          description: "Minimum tag confidence weight (0-100). Default 60.",
          default: 60,
        },
      },
      required: ["tags"],
    },
  },
  {
    name: "get_matching_fonts",
    description: "Get a shortlist of fonts matching selected tags with their COMPLETE tag profiles. Use this once you've narrowed down to a good combination (aim for 3-20 fonts). Returns full semantic profile of each font so you can pick the best match.",
    input_schema: {
      type: "object",
      properties: {
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Array of tag paths (e.g., ['/Expressive/Business', '/Sans/Geometric'])",
        },
        min_weight: {
          type: "number",
          description: "Minimum tag confidence weight (0-100). Default 60.",
          default: 60,
        },
      },
      required: ["tags"],
    },
  },
  {
    name: "select_best_font",
    description: "Select the single best font from candidates based on semantic fit. Automatically takes the top 5 most popular fonts from your shortlist and shows their complete semantic profiles for comparison. Call this after get_matching_fonts.",
    input_schema: {
      type: "object",
      properties: {
        keyword: {
          type: "string",
          description: "The keyword/cluster label we're finding a font for",
        },
        max_candidates: {
          type: "number",
          description: "Maximum number of candidates to compare (default 5, max 10)",
          default: 5,
        },
      },
      required: ["keyword"],
    },
  },
];

// ============================================================================
// Agentic Loop with Tool Use
// ============================================================================

async function findFontsForKeyword(
  keyword: string,
  cache: TagCache,
  maxTurns = 15
): Promise<{ selectedTags: string[]; selectedFont: string | null; allCandidates: FontMatch[] }> {
  const messages: any[] = [
    {
      role: "user",
      content: `Find the best Google Font for the keyword "${keyword}" by exploring semantic tags and comparing font personalities.

Your goal: Select ONE font that best captures the semantic meaning of this keyword.

Process (two stages):

STAGE 1 - EXPLORATION: Narrow down to 3-10 candidate fonts
1. Call list_available_tags() to see what tags exist
2. Pick the PRIMARY semantic tag for this keyword (most important characteristic)
3. Call filter_fonts() with that tag to see how many fonts have it and what other tags commonly pair
4. Add 1-2 more tags to narrow down to 3-20 fonts
5. Call get_matching_fonts() to see the shortlist with FULL tag profiles

STAGE 2 - SELECTION: Pick the best semantic match
6. Once you have 5-30 candidates, call select_best_font()
   - It will automatically show the top 5 most POPULAR fonts from your shortlist
   - You'll see their complete semantic profiles (all tags, not just matching ones)
   - Pick the one that best captures the keyword's meaning
   - Consider readability: prefer Sans-serif/Monospace over decorative Display

Important:
- Pick the PRIMARY semantic tag first (most defining characteristic)
- Aim for 3-20 fonts in shortlist (not too many, not too few)
- The final selection sees COMPLETE tag profiles, so you'll have full visibility`,
    },
  ];

  let currentTags: string[] = [];
  let allCandidates: FontMatch[] = [];
  let awaitingFontSelection = false;

  for (let turn = 0; turn < maxTurns; turn++) {
    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      tools: TOOL_SCHEMAS,
      messages,
    });

    // Check if Haiku responded with text (possibly after seeing font profiles)
    const textBlock = response.content.find((block) => block.type === "text");
    if (textBlock && awaitingFontSelection) {
      // Parse Haiku's font selection from JSON response
      const text = textBlock.text;

      try {
        // Try to extract JSON from response (search for JSON anywhere in text)
        let jsonText = text.trim();

        // Try code block first
        const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (codeBlockMatch) {
          jsonText = codeBlockMatch[1].trim();
        } else {
          // Try to find JSON object anywhere in the text
          const jsonMatch = jsonText.match(/\{[^{}]*"selected"[^{}]*\}/);
          if (jsonMatch) {
            jsonText = jsonMatch[0];
          }
        }

        const parsed = JSON.parse(jsonText);
        const selectedFont = parsed.selected || null;
        const reasoning = parsed.reasoning || "";

        console.log(`  [Turn ${turn + 1}] Selected: ${selectedFont}`);
        console.log(`    Reasoning: ${reasoning}`);

        return { selectedTags: currentTags, selectedFont, allCandidates };
      } catch (error) {
        console.log(`  [Turn ${turn + 1}] Warning: Could not parse JSON, using first candidate`);
        console.log(`    Response: ${text.substring(0, 200)}...`);
        const fallback = allCandidates[0]?.family || null;
        return { selectedTags: currentTags, selectedFont: fallback, allCandidates };
      }
    }

    // Check if Haiku stopped without tools or text
    if (response.stop_reason === "end_turn" && !textBlock) {
      console.log(`  [Turn ${turn + 1}] Haiku finished without response`);
      return { selectedTags: currentTags, selectedFont: null, allCandidates };
    }

    // Process tool calls
    const toolResults: any[] = [];

    for (const block of response.content) {
      if (block.type === "tool_use") {
        const { name, input, id } = block;
        const inputStr = JSON.stringify(input).substring(0, 100);
        console.log(`  [Turn ${turn + 1}] Tool: ${name}(${inputStr}${inputStr.length >= 100 ? '...' : ''})`);

        let result: any;

        if (name === "list_available_tags") {
          result = listAvailableTags(cache);
        } else if (name === "filter_fonts") {
          const tags = input.tags || [];
          const minWeight = input.min_weight || 60;
          currentTags = tags;
          result = filterFontsAndGetNextTags(cache, tags, minWeight);
          console.log(`    → ${result.matchingFontCount} fonts, ${result.availableNextTags.length} next tags available`);
        } else if (name === "get_matching_fonts") {
          const tags = input.tags || [];
          const minWeight = input.min_weight || 60;
          currentTags = tags;
          result = getMatchingFonts(cache, tags, minWeight);
          allCandidates = result;
          console.log(`    → Found ${result.length} candidate fonts with full profiles`);
          // Don't return yet - let Haiku call select_best_font next
        } else if (name === "select_best_font") {
          const maxCandidates = Math.min(input.max_candidates || 5, 10);

          // Take top N by popularity (they're already sorted by popularity in cache)
          const topCandidates = allCandidates.slice(0, maxCandidates);
          const fontFamilies = topCandidates.map((f) => f.family);

          const profiles = getFontProfiles(cache, fontFamilies);

          console.log(`    → Presenting top ${profiles.length} fonts for semantic evaluation`);

          // Show profiles to Haiku for semantic comparison
          result = {
            keyword: input.keyword,
            candidates: profiles.map((p, i) => ({
              rank: i + 1,
              family: p.family,
              category: p.category,
              // Show top 10 most defining tags (sorted by weight)
              topTags: p.tags.slice(0, 10),
            })),
            instruction: `Review these ${profiles.length} fonts and their complete semantic profiles. Pick the one that best captures the meaning of "${input.keyword}".

IMPORTANT: Return ONLY valid JSON in this exact format:
{"selected": "Font Family Name", "reasoning": "Brief explanation"}

Do not include markdown, explanations, or any other text - just the JSON object.`,
          };

          // Mark that we're awaiting Haiku's text response with font selection
          awaitingFontSelection = true;
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: id,
          content: JSON.stringify(result),
        });
      }
    }

    // Add assistant response and tool results to conversation
    messages.push({
      role: "assistant",
      content: response.content,
    });

    messages.push({
      role: "user",
      content: toolResults,
    });
  }

  console.log(`  [Warning] Max turns reached without final result`);
  return { selectedTags: currentTags, selectedFont: null, allCandidates };
}

// ============================================================================
// Database Queries
// ============================================================================

async function fetchKeywordsFromDatabase(limit: number): Promise<string[]> {
  const supabase = createServerClient();

  // Fetch individual keywords
  let keywordQuery = supabase
    .from("keywords")
    .select("keyword")
    .order("id", { ascending: true });

  if (limit > 0) {
    keywordQuery = keywordQuery.limit(limit);
  }

  const { data: keywordData, error: keywordError } = await keywordQuery;

  if (keywordError) {
    throw new Error(`Keywords table error: ${keywordError.message}`);
  }

  const keywords = keywordData.map((row) => row.keyword);

  // Fetch unique cluster labels from precomputed clusters
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: clusterData, error: clusterError } = await (supabase.from as any)(
    "precomputed_topic_clusters"
  )
    .select("cluster_label")
    .order("cluster_label", { ascending: true });

  if (clusterError) {
    console.warn(`Warning: Could not fetch cluster labels: ${clusterError.message}`);
    console.warn("Continuing with keywords only...");
    return keywords;
  }

  // Get unique cluster labels
  const clusterLabels = [...new Set(clusterData.map((row: any) => row.cluster_label))];

  // Combine and deduplicate
  const combined = [...new Set([...keywords, ...clusterLabels])];

  console.log(`Fetched ${keywords.length} keywords + ${clusterLabels.length} unique cluster labels = ${combined.length} total`);

  // Apply limit to combined set if specified
  if (limit > 0) {
    return combined.slice(0, limit);
  }

  return combined;
}

// ============================================================================
// Parallel Processing Utilities
// ============================================================================

/**
 * Process items in parallel with concurrency limit.
 * Similar pattern to Promise.all but with max concurrent executions.
 */
async function processConcurrently<T, R>(
  items: T[],
  concurrency: number,
  processor: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  const queue = items.map((item, index) => ({ item, index }));
  let activeCount = 0;

  return new Promise((resolve, reject) => {
    function runNext() {
      if (queue.length === 0 && activeCount === 0) {
        resolve(results);
        return;
      }

      while (activeCount < concurrency && queue.length > 0) {
        const { item, index } = queue.shift()!;
        activeCount++;

        processor(item, index)
          .then((result) => {
            results[index] = result;
            activeCount--;
            runNext();
          })
          .catch(reject);
      }
    }

    runNext();
  });
}

// ============================================================================
// Main Pipeline
// ============================================================================

async function main() {
  const limit = parseInt(process.argv[2] || "0", 10); // 0 = all keywords
  const concurrency = parseInt(process.argv[3] || "6", 10); // Default concurrent Haiku instances

  const limitDisplay = limit === 0 ? "all" : limit.toString();
  console.log(`\n=== Agentic Keyword-to-Font Matching (limit: ${limitDisplay}, concurrency: ${concurrency}) ===\n`);

  // Load font cache
  console.log("Loading font cache...");
  const cache = await loadFontCache();
  console.log(`✓ Loaded ${cache.fonts.length} fonts with ${cache.allTags.length} unique tags\n`);

  // Fetch keywords
  console.log("Fetching keywords from database...");
  const keywords = await fetchKeywordsFromDatabase(limit);
  console.log(`✓ Loaded ${keywords.length} keywords\n`);

  // Process keywords in parallel (with concurrency limit)
  console.log(`Processing keywords with ${concurrency} concurrent instances...\n`);

  // Prepare output file (JSONL format for safe concurrent append)
  const resultsPath = "./data/agentic-keyword-font-results.jsonl";
  await fs.mkdir(path.dirname(resultsPath), { recursive: true });

  // Clear previous results
  await fs.writeFile(resultsPath, "");

  const results = await processConcurrently(
    keywords,
    concurrency,
    async (keyword, index) => {
      console.log(`[${index + 1}/${keywords.length}] Starting: "${keyword}"`);

      const { selectedTags, selectedFont, allCandidates } = await findFontsForKeyword(keyword, cache);

      const result = {
        keyword,
        selectedTags,
        selectedFont,
        candidateCount: allCandidates.length,
      };

      // Save immediately (JSONL format - one JSON object per line)
      await fs.appendFile(resultsPath, JSON.stringify(result) + "\n");

      // Display result
      console.log(`[${index + 1}/${keywords.length}] ✓ "${keyword}"`);
      console.log(`  Tags: ${selectedTags.join(", ") || "none"}`);
      console.log(`  Font: ${selectedFont || "none"} (from ${allCandidates.length} candidates)`);
      console.log();

      return result;
    }
  );

  // Summary
  console.log("=== Summary ===");
  const withFonts = results.filter((r) => r.selectedFont !== null);

  console.log(`Keywords with fonts: ${withFonts.length}/${results.length}`);

  // Also save as regular JSON for convenience
  const jsonPath = "./data/agentic-keyword-font-results.json";
  await fs.writeFile(jsonPath, JSON.stringify(results, null, 2));
  console.log(`\n✓ Saved results to ${resultsPath} (JSONL) and ${jsonPath} (JSON)`);
}

main().catch(console.error);
