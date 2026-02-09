/**
 * Complete pipeline for preparing keyword-specific fonts
 *
 * This script orchestrates the full workflow:
 * 1. Fetch Google Fonts metadata (if not cached)
 * 2. Match keywords to fonts using Haiku (if not done)
 * 3. Download matched font files (if not downloaded)
 * 4. Generate TypeScript mapping file
 *
 * Usage:
 *   npm run script scripts/prepare-keyword-fonts.ts [--force-match] [--force-download]
 *
 * Options:
 *   --force-match     Re-run font matching even if results exist
 *   --force-download  Re-download fonts even if they exist locally
 */

import { loadCache, saveCache } from "@/lib/cache-utils";
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

// ============================================================================
// Configuration
// ============================================================================

const CACHE_PATH = "./data/google-fonts-tags-cache.json";
const RESULTS_JSONL_PATH = "./data/agentic-keyword-font-results.jsonl";
const RESULTS_JSON_PATH = "./data/agentic-keyword-font-results.json";
const FONTS_DIR = "./public/fonts/google";
const MAPPING_PATH = "./src/lib/keyword-fonts.ts";

interface GoogleFont {
  family: string;
  files: Record<string, string>; // variant -> download URL
  tags?: Array<{ name: string; weight: number }>;
}

interface FontCache {
  timestamp: string;
  fonts: GoogleFont[];
  allTags: string[];
  tagsByCategory: Record<string, string[]>;
}

interface FontMatchResult {
  keyword: string;
  selectedFont: string | null;
  selectedTags: string[];
  candidateCount: number;
}

// ============================================================================
// Pipeline Steps
// ============================================================================

async function checkFileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function step1_fetchMetadata(): Promise<void> {
  console.log("\n=== Step 1: Fetch Google Fonts Metadata ===\n");

  const cacheExists = await checkFileExists(CACHE_PATH);

  if (cacheExists) {
    console.log(`✓ Cache already exists at ${CACHE_PATH}`);
    const cache = await loadCache<FontCache>(CACHE_PATH);
    console.log(`  ${cache.fonts?.length || 0} fonts cached`);
    return;
  }

  console.log("Cache not found. Fetching from Google Fonts API...");

  const apiKey = process.env.GOOGLE_FONTS_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_FONTS_API_KEY not found in environment");
  }

  const url = `https://www.googleapis.com/webfonts/v1/webfonts?key=${apiKey}&sort=popularity&capability=FAMILY_TAGS`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Google Fonts API error: ${response.status}`);
  }

  const data = await response.json();
  const fonts = data.items.filter((f: any) => f.tags && f.tags.length > 0);

  // Extract all unique tags
  const allTags = new Set<string>();
  const tagsByCategory: Record<string, Set<string>> = {};

  for (const font of fonts) {
    if (font.tags) {
      for (const tag of font.tags) {
        allTags.add(tag.name);
        const parts = tag.name.split("/").filter((p: string) => p.length > 0);
        if (parts.length >= 2) {
          const category = parts[0];
          const value = parts.slice(1).join("/");
          if (!tagsByCategory[category]) {
            tagsByCategory[category] = new Set();
          }
          tagsByCategory[category].add(value);
        }
      }
    }
  }

  const cache = {
    timestamp: new Date().toISOString(),
    fonts,
    allTags: Array.from(allTags).sort(),
    tagsByCategory: Object.fromEntries(
      Object.entries(tagsByCategory).map(([cat, vals]) => [cat, Array.from(vals).sort()])
    ),
  };

  await fs.mkdir(path.dirname(CACHE_PATH), { recursive: true });
  await saveCache(CACHE_PATH, cache);

  console.log(`✓ Cached ${fonts.length} fonts with tags`);
}

async function step2_matchKeywords(forceMatch: boolean): Promise<void> {
  console.log("\n=== Step 2: Match Keywords to Fonts ===\n");

  const resultsExist = await checkFileExists(RESULTS_JSONL_PATH);

  if (resultsExist && !forceMatch) {
    console.log(`✓ Results already exist at ${RESULTS_JSONL_PATH}`);
    const lines = (await fs.readFile(RESULTS_JSONL_PATH, "utf-8")).trim().split("\n");
    console.log(`  ${lines.length} keywords matched`);
    return;
  }

  if (forceMatch) {
    console.log("Force match requested. Re-running matching...");
  } else {
    console.log("Results not found. Running keyword-to-font matching...");
  }

  console.log("\nRunning: npm run script scripts/match-keywords-to-fonts-agentic.ts\n");

  try {
    execSync("npm run script scripts/match-keywords-to-fonts-agentic.ts", {
      stdio: "inherit",
      cwd: process.cwd(),
    });
  } catch (error) {
    throw new Error("Font matching script failed");
  }

  console.log("\n✓ Font matching complete");
}

async function step3_downloadFonts(forceDownload: boolean): Promise<void> {
  console.log("\n=== Step 3: Download Font Files ===\n");

  // Read results
  const resultsExist = await checkFileExists(RESULTS_JSONL_PATH);
  if (!resultsExist) {
    throw new Error(`Results file not found: ${RESULTS_JSONL_PATH}`);
  }

  const lines = (await fs.readFile(RESULTS_JSONL_PATH, "utf-8")).trim().split("\n");
  const results: FontMatchResult[] = lines.map((line) => JSON.parse(line));

  // Get unique fonts (excluding null/missing)
  const uniqueFonts = new Set(
    results.map((r) => r.selectedFont).filter((f): f is string => f !== null)
  );

  console.log(`Found ${uniqueFonts.size} unique fonts to download`);

  // Load cache for font file URLs
  const cache = await loadCache<FontCache>(CACHE_PATH);
  const fontsByFamily = new Map<string, GoogleFont>();
  for (const font of cache.fonts || []) {
    fontsByFamily.set(font.family, font);
  }

  // Create fonts directory
  await fs.mkdir(FONTS_DIR, { recursive: true });

  // Download each font
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (const fontFamily of Array.from(uniqueFonts).sort()) {
    const font = fontsByFamily.get(fontFamily);
    if (!font) {
      console.log(`⚠ Font not found in cache: ${fontFamily}`);
      failed++;
      continue;
    }

    // Prefer regular/400 variant, fall back to first available
    let variant = "regular";
    let fileUrl = font.files?.[variant];

    if (!fileUrl && font.files) {
      // Try "400" variant
      fileUrl = font.files["400"];
    }

    if (!fileUrl && font.files) {
      // Take first available variant
      const variants = Object.keys(font.files);
      if (variants.length > 0) {
        variant = variants[0];
        fileUrl = font.files[variant];
      }
    }

    if (!fileUrl) {
      console.log(`⚠ No file URL found for ${fontFamily}`);
      failed++;
      continue;
    }

    // Generate safe filename
    const safeFamily = fontFamily.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
    const filename = `${safeFamily}.woff2`;
    const filepath = path.join(FONTS_DIR, filename);

    // Check if already downloaded
    if (!forceDownload && (await checkFileExists(filepath))) {
      skipped++;
      continue;
    }

    // Download
    try {
      console.log(`  Downloading ${fontFamily}...`);
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      await fs.writeFile(filepath, Buffer.from(buffer));
      downloaded++;
    } catch (error) {
      console.log(`  ✗ Failed to download ${fontFamily}: ${error}`);
      failed++;
    }
  }

  console.log(`\n✓ Downloaded ${downloaded} fonts`);
  if (skipped > 0) console.log(`  ${skipped} fonts already existed`);
  if (failed > 0) console.log(`  ⚠ ${failed} fonts failed`);
}

async function step4_generateMapping(): Promise<void> {
  console.log("\n=== Step 4: Generate TypeScript Mapping ===\n");

  // Read results
  const lines = (await fs.readFile(RESULTS_JSONL_PATH, "utf-8")).trim().split("\n");
  const results: FontMatchResult[] = lines.map((line) => JSON.parse(line));

  // Build mapping (keyword -> font family)
  const mapping: Record<string, string> = {};
  for (const result of results) {
    if (result.selectedFont) {
      mapping[result.keyword] = result.selectedFont;
    }
  }

  // Generate TypeScript file
  const tsContent = `/**
 * Keyword to font family mapping
 *
 * Auto-generated from agentic font matching results.
 * DO NOT EDIT MANUALLY - regenerate with prepare-keyword-fonts.ts
 */

export const KEYWORD_FONTS: Record<string, string> = ${JSON.stringify(mapping, null, 2)};

/**
 * Get font path for a keyword or cluster label
 * Returns path to .woff2 file in /public/fonts/google/
 */
export function getFontPath(keyword: string): string {
  const fontFamily = KEYWORD_FONTS[keyword];
  if (!fontFamily) {
    return "/fonts/source-code-pro-regular.woff2"; // fallback
  }

  // Convert font family to safe filename
  const safeFamily = fontFamily.replace(/\\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
  return \`/fonts/google/\${safeFamily}.woff2\`;
}
`;

  await fs.writeFile(MAPPING_PATH, tsContent);

  console.log(`✓ Generated mapping at ${MAPPING_PATH}`);
  console.log(`  ${Object.keys(mapping).length} keywords mapped to fonts`);
}

// ============================================================================
// Main Pipeline
// ============================================================================

async function main() {
  const args = process.argv.slice(2);
  const forceMatch = args.includes("--force-match");
  const forceDownload = args.includes("--force-download");

  console.log("\n╔══════════════════════════════════════════╗");
  console.log("║  Keyword Font Preparation Pipeline      ║");
  console.log("╚══════════════════════════════════════════╝");

  try {
    await step1_fetchMetadata();
    await step2_matchKeywords(forceMatch);
    await step3_downloadFonts(forceDownload);
    await step4_generateMapping();

    console.log("\n╔══════════════════════════════════════════╗");
    console.log("║  ✓ Pipeline Complete                    ║");
    console.log("╚══════════════════════════════════════════╝\n");

    console.log("Next steps:");
    console.log("  1. Fonts are in: ./public/fonts/google/");
    console.log("  2. Mapping is in: ./src/lib/keyword-fonts.ts");
    console.log("  3. Use getFontPath(keyword) in ClusterLabels3D.tsx\n");
  } catch (error) {
    console.error("\n✗ Pipeline failed:", error);
    process.exit(1);
  }
}

main().catch(console.error);
