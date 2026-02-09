/**
 * Test keyword-to-font matching pipeline
 *
 * This script validates that we can:
 * 1. Cache Google Fonts tag metadata
 * 2. Fetch keywords from the database
 * 3. Use Claude Haiku to recommend font tags for keywords
 * 4. Find fonts that match those tag combinations
 *
 * Usage:
 *   npm run script scripts/test-keyword-font-matching.ts [limit]
 *
 * Arguments:
 *   limit: Number of keywords to test (default: 10)
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

interface GoogleFontsApiResponse {
  kind: string;
  items: GoogleFont[];
}

interface TagCache {
  timestamp: string;
  fonts: GoogleFont[];
  allTags: string[]; // All unique tag names (e.g., "/Expressive/Business")
  tagsByCategory: Record<string, string[]>; // Category -> tag values
}

interface KeywordFontRecommendation {
  keyword: string;
  recommendedTags: string[];
  matchingFonts: Array<{
    family: string;
    category: string;
    tags: Array<{ name: string; weight: number }>;
  }>;
}

// ============================================================================
// Google Fonts API
// ============================================================================

async function fetchGoogleFonts(apiKey: string): Promise<GoogleFont[]> {
  const url = `https://www.googleapis.com/webfonts/v1/webfonts?key=${apiKey}&sort=popularity&capability=FAMILY_TAGS`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Google Fonts API error: ${response.status} ${response.statusText}`);
  }

  const data: GoogleFontsApiResponse = await response.json();
  return data.items;
}

// ============================================================================
// Cache Management
// ============================================================================

const CACHE_PATH = "./data/google-fonts-tags-cache.json";

async function getOrFetchFontTags(apiKey: string, forceRefresh = false): Promise<TagCache> {
  // Try to load from cache
  if (!forceRefresh) {
    try {
      const cacheData = await fs.readFile(CACHE_PATH, "utf-8");
      const cache: TagCache = JSON.parse(cacheData);
      console.log(`[Cache] Loaded ${cache.fonts.length} fonts from cache`);
      console.log(`[Cache] ${cache.allTags.length} unique tags`);
      return cache;
    } catch {
      console.log("[Cache] No cache found, fetching from API...");
    }
  }

  // Fetch from API
  console.log("[API] Fetching fonts from Google Fonts API...");
  const fonts = await fetchGoogleFonts(apiKey);

  // Extract all unique tag names
  const allTagNames = new Set<string>();
  for (const font of fonts) {
    if (font.tags) {
      for (const tag of font.tags) {
        allTagNames.add(tag.name);
      }
    }
  }

  // Organize by category
  const tagsByCategory: Record<string, Set<string>> = {};
  for (const tagName of allTagNames) {
    const parts = tagName.split("/").filter((p) => p.length > 0);
    if (parts.length >= 2) {
      const category = parts[0];
      const value = parts.slice(1).join("/");
      if (!tagsByCategory[category]) {
        tagsByCategory[category] = new Set();
      }
      tagsByCategory[category].add(value);
    }
  }

  // Convert Sets to arrays for JSON serialization
  const cache: TagCache = {
    timestamp: new Date().toISOString(),
    fonts: fonts.filter((f) => f.tags && f.tags.length > 0), // Only keep fonts with tags
    allTags: Array.from(allTagNames).sort(),
    tagsByCategory: Object.fromEntries(
      Object.entries(tagsByCategory).map(([cat, vals]) => [cat, Array.from(vals).sort()])
    ),
  };

  // Save to cache
  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));

  console.log(`[Cache] Cached ${cache.fonts.length} fonts with tags`);
  console.log(`[Cache] ${cache.allTags.length} unique tags across ${Object.keys(cache.tagsByCategory).length} categories`);

  return cache;
}

// ============================================================================
// Database Queries
// ============================================================================

async function fetchKeywordsFromDatabase(limit: number): Promise<string[]> {
  const supabase = createServerClient();

  // Fetch keywords ordered by their occurrence count
  const { data, error } = await supabase
    .from("keywords")
    .select("keyword")
    .order("id", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(`Database error: ${error.message}`);
  }

  return data.map((row) => row.keyword);
}

// ============================================================================
// LLM-based Tag Recommendation
// ============================================================================

async function recommendTagsForKeywords(
  keywords: string[],
  availableTags: string[]
): Promise<Record<string, string[]>> {
  if (keywords.length === 0) return {};

  // Build a compact representation of available tags for the prompt
  const tagsByCategory: Record<string, string[]> = {};
  for (const tag of availableTags) {
    const parts = tag.split("/").filter((p) => p.length > 0);
    if (parts.length >= 2) {
      const category = parts[0];
      const value = parts.slice(1).join("/");
      if (!tagsByCategory[category]) {
        tagsByCategory[category] = [];
      }
      tagsByCategory[category].push(value);
    }
  }

  const tagCategoriesDescription = Object.entries(tagsByCategory)
    .map(([category, values]) => `${category}: ${values.slice(0, 20).join(", ")}${values.length > 20 ? ` (${values.length - 20} more)` : ""}`)
    .join("\n");

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2000,
    messages: [
      {
        role: "user",
        content: `You are matching keywords to Google Fonts semantic tags for a graph visualization.

For each keyword, select 2-4 font tags that would be most appropriate for displaying that keyword as a cluster label.

Available tag categories and values:
${tagCategoriesDescription}

Keywords to match:
${keywords.map((kw, i) => `${i + 1}. ${kw}`).join("\n")}

Return a JSON object mapping each keyword to an array of full tag paths (e.g., "/Expressive/Business", "/Sans/Geometric").

Example format:
{
  "machine learning": ["/Technology/Computer Science", "/Sans/Geometric"],
  "emotional intelligence": ["/Expressive/Calm", "/Serif/Humanist"]
}

Consider:
- Semantic fit: Does the tag match the meaning/tone of the keyword?
- Readability: Sans-serif and monospace are easier to read at small sizes
- Visual hierarchy: Display fonts for emphasis, sans-serif for neutrality, monospace for technical content

Return ONLY the JSON object.`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock?.text) return {};

  try {
    // Extract JSON from response (might be in code block)
    let jsonText = textBlock.text.trim();
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1].trim();
    }

    const parsed = JSON.parse(jsonText);
    return parsed as Record<string, string[]>;
  } catch (error) {
    console.error("[LLM] Failed to parse tag recommendations:", textBlock.text);
    return {};
  }
}

// ============================================================================
// Font Matching
// ============================================================================

function findFontsMatchingTags(
  fonts: GoogleFont[],
  requiredTags: string[],
  minWeight = 60
): Array<{ family: string; category: string; tags: Array<{ name: string; weight: number }> }> {
  const matches: Array<{ family: string; category: string; tags: Array<{ name: string; weight: number }> }> = [];

  for (const font of fonts) {
    if (!font.tags) continue;

    // Check if font has ALL required tags with sufficient weight
    const matchingTags: Array<{ name: string; weight: number }> = [];
    let hasAllTags = true;

    for (const requiredTag of requiredTags) {
      const fontTag = font.tags.find((t) => t.name === requiredTag);
      if (!fontTag || fontTag.weight < minWeight) {
        hasAllTags = false;
        break;
      }
      matchingTags.push({ name: fontTag.name, weight: fontTag.weight });
    }

    if (hasAllTags) {
      matches.push({
        family: font.family,
        category: font.category,
        tags: matchingTags,
      });
    }
  }

  return matches;
}

// ============================================================================
// Main Pipeline
// ============================================================================

async function main() {
  const googleApiKey = process.env.GOOGLE_FONTS_API_KEY;

  if (!googleApiKey) {
    console.error("Error: GOOGLE_FONTS_API_KEY not found in environment");
    console.error("\nTo get an API key:");
    console.error("1. Go to https://console.cloud.google.com/");
    console.error("2. Create a new project (or select existing)");
    console.error("3. Enable 'Web Fonts Developer API'");
    console.error("4. Go to 'Credentials' → 'Create Credentials' → 'API Key'");
    console.error("5. Add GOOGLE_FONTS_API_KEY=your_key_here to .env.local");
    process.exit(1);
  }

  // Parse limit from command line
  const limit = parseInt(process.argv[2] || "10", 10);
  console.log(`\n=== Keyword-to-Font Matching Test (limit: ${limit}) ===\n`);

  // Step 1: Load or fetch font tag cache
  console.log("Step 1: Loading font tag metadata...");
  const tagCache = await getOrFetchFontTags(googleApiKey);
  console.log();

  // Step 2: Fetch keywords from database
  console.log("Step 2: Fetching keywords from database...");
  const keywords = await fetchKeywordsFromDatabase(limit);
  console.log(`[Database] Loaded ${keywords.length} keywords`);
  console.log(`  Examples: ${keywords.slice(0, 5).join(", ")}`);
  console.log();

  // Step 3: Get tag recommendations from Claude Haiku
  console.log("Step 3: Getting tag recommendations from Claude Haiku...");
  const tagRecommendations = await recommendTagsForKeywords(keywords, tagCache.allTags);
  console.log(`[LLM] Received recommendations for ${Object.keys(tagRecommendations).length} keywords`);
  console.log();

  // Step 4: Find matching fonts for each keyword
  console.log("Step 4: Finding fonts that match recommended tags...\n");
  const results: KeywordFontRecommendation[] = [];

  for (const keyword of keywords) {
    const recommendedTags = tagRecommendations[keyword] || [];
    const matchingFonts = findFontsMatchingTags(tagCache.fonts, recommendedTags);

    results.push({
      keyword,
      recommendedTags,
      matchingFonts,
    });

    // Display result
    console.log(`Keyword: "${keyword}"`);
    console.log(`  Recommended tags: ${recommendedTags.join(", ") || "none"}`);
    console.log(`  Matching fonts: ${matchingFonts.length}`);

    if (matchingFonts.length > 0) {
      console.log(`  Top matches:`);
      for (const font of matchingFonts.slice(0, 3)) {
        const tagWeights = font.tags.map((t) => `${t.name} (${t.weight})`).join(", ");
        console.log(`    - ${font.family} (${font.category})`);
        console.log(`      Tags: ${tagWeights}`);
      }
    } else if (recommendedTags.length > 0) {
      console.log(`  ⚠ No fonts found with ALL these tags at weight ≥ 60`);
    }
    console.log();
  }

  // Summary statistics
  console.log("=== Summary ===");
  const withMatches = results.filter((r) => r.matchingFonts.length > 0);
  const withoutMatches = results.filter((r) => r.recommendedTags.length > 0 && r.matchingFonts.length === 0);
  const noTags = results.filter((r) => r.recommendedTags.length === 0);

  console.log(`Keywords with matching fonts: ${withMatches.length}/${results.length}`);
  console.log(`Keywords with tags but no matches: ${withoutMatches.length}/${results.length}`);
  console.log(`Keywords without tag recommendations: ${noTags.length}/${results.length}`);

  if (withoutMatches.length > 0) {
    console.log("\n⚠ Keywords that had no matching fonts:");
    for (const result of withoutMatches) {
      console.log(`  - "${result.keyword}" (tags: ${result.recommendedTags.join(", ")})`);
    }
    console.log("\nConsider:");
    console.log("  1. Relaxing tag requirements (e.g., select 1-2 tags instead of 3-4)");
    console.log("  2. Lowering the weight threshold (currently 60)");
    console.log("  3. Using fuzzy matching (any tag instead of all tags)");
  }

  // Save results to JSON
  const resultsPath = "./data/keyword-font-test-results.json";
  await fs.mkdir(path.dirname(resultsPath), { recursive: true });
  await fs.writeFile(resultsPath, JSON.stringify(results, null, 2));
  console.log(`\n✓ Saved results to ${resultsPath}`);
}

main().catch(console.error);
