/**
 * Batch font matching using Claude Haiku
 *
 * Processes 10 keywords per API call to reduce costs by ~94%
 * Uses single-turn matching with full font metadata provided upfront
 *
 * Usage:
 *   npm run script scripts/fonts/match-keywords-to-fonts-batch.ts [limit] [batchSize]
 *
 * Examples:
 *   npm run script scripts/fonts/match-keywords-to-fonts-batch.ts       # Process all
 *   npm run script scripts/fonts/match-keywords-to-fonts-batch.ts 50    # First 50 keywords
 *   npm run script scripts/fonts/match-keywords-to-fonts-batch.ts 0 20  # All keywords, 20 per batch
 */

import Anthropic from "@anthropic-ai/sdk";
import { createServerClient } from "@/lib/supabase";
import { loadCache } from "@/lib/cache-utils";
import fs from "fs/promises";
import path from "path";

// ============================================================================
// Configuration
// ============================================================================

const BATCH_SIZE = 10; // Keywords per API call
const RESULTS_PATH = "./data/agentic-keyword-font-results.jsonl";

interface GoogleFont {
  family: string;
  files: Record<string, string>;
  tags?: Array<{ name: string; weight: number }>;
}

interface FontCache {
  fonts: GoogleFont[];
  allTags: string[];
}

interface FontMatchResult {
  keyword: string;
  selectedFont: string | null;
  selectedTags: string[];
  candidateCount: number;
}

// ============================================================================
// Database
// ============================================================================

async function fetchKeywordsFromDatabase(limit: number): Promise<string[]> {
  const supabase = createServerClient();

  // Fetch individual keywords
  let keywordQuery = supabase.from("keywords").select("keyword").order("id", { ascending: true });
  if (limit > 0) keywordQuery = keywordQuery.limit(limit);
  const { data: keywordData, error: keywordError } = await keywordQuery;

  if (keywordError) throw keywordError;
  const keywords = keywordData.map((row) => row.keyword);

  // Fetch unique cluster labels
  const { data: clusterData, error: clusterError } = await (supabase.from as any)("precomputed_topic_clusters")
    .select("cluster_label")
    .order("cluster_label", { ascending: true });

  if (clusterError) throw clusterError;
  const clusterLabels = [...new Set(clusterData.map((row: any) => row.cluster_label))];

  const combined = [...new Set([...keywords, ...clusterLabels])];
  console.log(`Fetched ${keywords.length} keywords + ${clusterLabels.length} cluster labels = ${combined.length} total`);

  if (limit > 0) return combined.slice(0, limit);
  return combined;
}

// ============================================================================
// Font Matching
// ============================================================================

async function loadFontCache(): Promise<FontCache> {
  const cachePath = "./data/google-fonts-tags-cache.json";
  return await loadCache<FontCache>(cachePath);
}

function buildFontSummary(cache: FontCache): string {
  // Summarize fonts by category for more compact representation
  const tagFonts = new Map<string, string[]>();

  for (const font of cache.fonts) {
    if (!font.tags) continue;
    for (const tag of font.tags) {
      if (tag.weight < 60) continue; // Only strong associations
      if (!tagFonts.has(tag.name)) {
        tagFonts.set(tag.name, []);
      }
      tagFonts.get(tag.name)!.push(font.family);
    }
  }

  // Build compact summary
  const lines: string[] = [];
  for (const [tag, fonts] of tagFonts.entries()) {
    lines.push(`${tag}: ${fonts.slice(0, 20).join(", ")}${fonts.length > 20 ? `, +${fonts.length - 20} more` : ""}`);
  }

  return lines.join("\n");
}

async function matchKeywordBatch(
  keywords: string[],
  cache: FontCache,
  anthropic: Anthropic
): Promise<FontMatchResult[]> {
  const fontSummary = buildFontSummary(cache);

  const prompt = `Match these ${keywords.length} keywords/labels to Google Fonts based on their semantic meaning.

KEYWORDS TO MATCH:
${keywords.map((k, i) => `${i + 1}. ${k}`).join("\n")}

AVAILABLE FONTS BY SEMANTIC TAG:
${fontSummary}

For each keyword, select the most semantically appropriate font. Consider:
- The meaning and feeling of the keyword
- Font personality (expressive, calm, technical, fancy, etc.)
- Visual appropriateness for the concept

Return ONLY a JSON array (no other text) with this exact format:
[
  {"keyword": "example", "font": "Font Name", "tags": ["/Category/Value"], "reasoning": "brief explanation"},
  ...
]

If no good match exists, use "font": null.`;

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  // Parse response
  const text = message.content[0].type === "text" ? message.content[0].text : "";

  // Extract JSON (handle markdown code blocks)
  let jsonText = text;
  const jsonMatch = text.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (jsonMatch) {
    jsonText = jsonMatch[1];
  } else if (!text.trim().startsWith("[")) {
    // Try to find JSON array anywhere in the text
    const arrayMatch = text.match(/(\[[\s\S]*\])/);
    if (arrayMatch) {
      jsonText = arrayMatch[1];
    }
  }

  try {
    const parsed = JSON.parse(jsonText) as Array<{
      keyword: string;
      font: string | null;
      tags?: string[];
      reasoning?: string;
    }>;

    // Convert to our result format
    return parsed.map(p => ({
      keyword: p.keyword,
      selectedFont: p.font,
      selectedTags: p.tags || [],
      candidateCount: 0, // Not tracked in batch mode
    }));
  } catch (error) {
    console.error("Failed to parse batch response:", error);
    console.error("Response text:", text);

    // Return empty matches for this batch
    return keywords.map(keyword => ({
      keyword,
      selectedFont: null,
      selectedTags: [],
      candidateCount: 0,
    }));
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const limit = parseInt(process.argv[2] || "0", 10);
  const batchSize = parseInt(process.argv[3] || BATCH_SIZE.toString(), 10);

  const limitDisplay = limit === 0 ? "all" : limit.toString();
  console.log(`\n=== Batch Font Matching (limit: ${limitDisplay}, batch size: ${batchSize}) ===\n`);

  // Load font cache
  console.log("Loading font cache...");
  const cache = await loadFontCache();
  console.log(`✓ Loaded ${cache.fonts.length} fonts\n`);

  // Fetch keywords
  console.log("Fetching keywords and cluster labels...");
  const allItems = await fetchKeywordsFromDatabase(limit);
  console.log(`✓ Loaded ${allItems.length} items\n`);

  // Load existing results
  await fs.mkdir(path.dirname(RESULTS_PATH), { recursive: true });

  let existingMatches = new Set<string>();
  let existingResults: FontMatchResult[] = [];

  try {
    const existingData = await fs.readFile(RESULTS_PATH, "utf-8");
    const lines = existingData.trim().split("\n").filter(l => l.length > 0);
    existingResults = lines.map(line => JSON.parse(line));
    existingMatches = new Set(existingResults.map(r => r.keyword));
    console.log(`✓ Found ${existingMatches.size} existing matches\n`);
  } catch {
    console.log("No existing results found\n");
  }

  // Filter to new items only
  const newItems = allItems.filter(item => !existingMatches.has(item));

  if (newItems.length === 0) {
    console.log("✓ All items already matched!");
    return;
  }

  console.log(`Processing ${newItems.length} new items (${existingMatches.size} already matched)\n`);

  // Process in batches
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  const numBatches = Math.ceil(newItems.length / batchSize);
  let processed = 0;

  for (let i = 0; i < numBatches; i++) {
    const batch = newItems.slice(i * batchSize, (i + 1) * batchSize);
    console.log(`[Batch ${i + 1}/${numBatches}] Processing ${batch.length} items...`);

    try {
      const results = await matchKeywordBatch(batch, cache, anthropic);

      // Save each result
      for (const result of results) {
        await fs.appendFile(RESULTS_PATH, JSON.stringify(result) + "\n");
        processed++;

        const fontDisplay = result.selectedFont || "none";
        console.log(`  ✓ "${result.keyword}" → ${fontDisplay}`);
      }

      console.log();
    } catch (error) {
      console.error(`  ✗ Batch failed:`, error);
      console.log();
    }
  }

  // Summary
  console.log("\n=== Summary ===");
  console.log(`Processed: ${processed} items`);
  console.log(`Total matches: ${existingMatches.size + processed}`);

  // Read all results to count successful matches
  const allData = await fs.readFile(RESULTS_PATH, "utf-8");
  const allLines = allData.trim().split("\n").filter(l => l.length > 0);
  const allResults: FontMatchResult[] = allLines.map(line => JSON.parse(line));
  const withFonts = allResults.filter(r => r.selectedFont !== null);

  console.log(`With fonts: ${withFonts.length}/${allResults.length}`);
}

main().catch(console.error);
