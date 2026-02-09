/**
 * Explore Google Fonts API categories and match keywords to font styles
 *
 * Usage:
 *   npm run script scripts/explore-font-categories.ts list-categories
 *   npm run script scripts/explore-font-categories.ts match "machine learning"
 */

interface FontTag {
  name: string; // e.g., "/Expressive/Business"
  weight: number; // 0-100 confidence score
}

interface GoogleFont {
  family: string;
  variants: string[];
  subsets: string[];
  version: string;
  lastModified: string;
  files: Record<string, string>;
  category: string;
  kind: string;
  menu: string;
  axes?: Array<{ tag: string; start: number; end: number }>;
  colorCapabilities?: string[];
  tags?: FontTag[]; // Available when capability=FAMILY_TAGS
}

interface GoogleFontsApiResponse {
  kind: string;
  items: GoogleFont[];
}

async function fetchGoogleFonts(apiKey: string, includeTags = false): Promise<GoogleFont[]> {
  let url = `https://www.googleapis.com/webfonts/v1/webfonts?key=${apiKey}&sort=popularity`;
  if (includeTags) {
    url += "&capability=FAMILY_TAGS";
  }
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Google Fonts API error: ${response.status} ${response.statusText}`);
  }

  const data: GoogleFontsApiResponse = await response.json();
  return data.items;
}

async function inspectFontMetadata() {
  const apiKey = process.env.GOOGLE_FONTS_API_KEY;

  if (!apiKey) {
    console.error("Error: GOOGLE_FONTS_API_KEY not found in environment");
    process.exit(1);
  }

  console.log("Fetching font metadata with tags from Google Fonts API...\n");
  const fonts = await fetchGoogleFonts(apiKey, true); // Include tags

  // Inspect first font (Roboto) to see all available fields
  console.log("Full metadata for Roboto:\n");
  const roboto = fonts.find((f) => f.family === "Roboto");
  if (roboto) {
    console.log(JSON.stringify(roboto, null, 2));
  } else {
    console.log("Roboto not found, showing first font:");
    console.log(JSON.stringify(fonts[0], null, 2));
  }

  console.log("\n\nAll available fields across all fonts:");
  const allFields = new Set<string>();
  for (const font of fonts.slice(0, 20)) {
    for (const key of Object.keys(font)) {
      allFields.add(key);
    }
  }
  console.log(Array.from(allFields).sort().join(", "));
}

async function listTags() {
  const apiKey = process.env.GOOGLE_FONTS_API_KEY;

  if (!apiKey) {
    console.error("Error: GOOGLE_FONTS_API_KEY not found in environment");
    process.exit(1);
  }

  console.log("Fetching all font tags from Google Fonts API...\n");
  const fonts = await fetchGoogleFonts(apiKey, true);

  const fontsWithTags = fonts.filter((f) => f.tags && f.tags.length > 0);
  console.log(`Fonts with tags: ${fontsWithTags.length}/${fonts.length}\n`);

  // Collect all unique tag names
  const allTagNames = new Set<string>();
  for (const font of fonts) {
    if (font.tags) {
      for (const tag of font.tags) {
        allTagNames.add(tag.name);
      }
    }
  }

  // Organize tags by category (first path segment)
  // Tag format: "/Category/Subcategory" or "/Category/Subcategory/Value"
  const tagsByCategory = new Map<string, Set<string>>();
  for (const tagName of allTagNames) {
    // Split by "/" and remove empty first element
    const parts = tagName.split("/").filter((p) => p.length > 0);
    if (parts.length >= 2) {
      const category = parts[0]; // e.g., "Expressive"
      const value = parts.slice(1).join("/"); // e.g., "Business" or "Neo Grotesque"
      if (!tagsByCategory.has(category)) {
        tagsByCategory.set(category, new Set());
      }
      tagsByCategory.get(category)!.add(value);
    }
  }

  console.log("Tag taxonomies discovered:\n");
  for (const [category, values] of Array.from(tagsByCategory.entries()).sort()) {
    console.log(`${category.toUpperCase()} (${values.size} values):`);
    const sortedValues = Array.from(values).sort();
    // Show first 20 values to avoid overwhelming output
    for (const value of sortedValues.slice(0, 20)) {
      console.log(`  - ${value}`);
    }
    if (sortedValues.length > 20) {
      console.log(`  ... and ${sortedValues.length - 20} more`);
    }
    console.log();
  }

  console.log(`Total unique tag names: ${allTagNames.size}`);
  console.log(`Total tag categories: ${tagsByCategory.size}`);
}

async function listCategories() {
  const apiKey = process.env.GOOGLE_FONTS_API_KEY;

  if (!apiKey) {
    console.error("Error: GOOGLE_FONTS_API_KEY not found in environment");
    console.error("\nTo get an API key:");
    console.error("1. Go to https://console.cloud.google.com/");
    console.error("2. Create a new project (or select existing)");
    console.error("3. Enable 'Web Fonts Developer API'");
    console.error("4. Go to 'Credentials' → 'Create Credentials' → 'API Key'");
    console.error("5. Add GOOGLE_FONTS_API_KEY=your_key_here to .env.local");
    process.exit(1);
  }

  console.log("Fetching fonts from Google Fonts API...\n");
  const fonts = await fetchGoogleFonts(apiKey);

  // Count fonts by category
  const categoryCount = new Map<string, number>();
  const categoryExamples = new Map<string, string[]>();

  for (const font of fonts) {
    const count = categoryCount.get(font.category) || 0;
    categoryCount.set(font.category, count + 1);

    // Keep first 5 examples
    const examples = categoryExamples.get(font.category) || [];
    if (examples.length < 5) {
      examples.push(font.family);
      categoryExamples.set(font.category, examples);
    }
  }

  console.log("Google Fonts Categories:\n");
  for (const [category, count] of Array.from(categoryCount.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`${category.toUpperCase()}`);
    console.log(`  Total: ${count} fonts`);
    console.log(`  Examples: ${categoryExamples.get(category)!.join(", ")}`);
    console.log();
  }

  console.log(`Total fonts: ${fonts.length}`);
}

interface FontAttributes {
  family: string;
  category: string;
  variants: string[];
  popularity: number; // rank in API response
  hasRegular: boolean;
  hasBold: boolean;
  hasItalic: boolean;
  weightRange: string;
}

function analyzeFontAttributes(fonts: GoogleFont[]): FontAttributes[] {
  return fonts.map((font, index) => {
    const variants = font.variants;
    const hasRegular = variants.includes("regular") || variants.includes("400");
    const hasBold = variants.some((v) => v.includes("700") || v.includes("bold"));
    const hasItalic = variants.some((v) => v.includes("italic"));

    // Determine weight range
    const weights = variants
      .filter((v) => /^\d+$/.test(v))
      .map((v) => parseInt(v))
      .sort((a, b) => a - b);
    const weightRange = weights.length > 0 ? `${weights[0]}-${weights[weights.length - 1]}` : "unknown";

    return {
      family: font.family,
      category: font.category,
      variants,
      popularity: index + 1,
      hasRegular,
      hasBold,
      hasItalic,
      weightRange,
    };
  });
}

async function matchKeywordToFonts(keyword: string) {
  const googleApiKey = process.env.GOOGLE_FONTS_API_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (!googleApiKey) {
    console.error("Error: GOOGLE_FONTS_API_KEY not found in environment");
    process.exit(1);
  }

  if (!anthropicApiKey) {
    console.error("Error: ANTHROPIC_API_KEY not found in environment");
    process.exit(1);
  }

  console.log(`Fetching Google Fonts and analyzing "${keyword}"...\n`);

  // Fetch top 100 fonts by popularity
  const allFonts = await fetchGoogleFonts(googleApiKey);
  const topFonts = allFonts.slice(0, 100);
  const fontAttributes = analyzeFontAttributes(topFonts);

  // Create a summary of available fonts per category
  const categoryFonts = new Map<string, FontAttributes[]>();
  for (const font of fontAttributes) {
    const list = categoryFonts.get(font.category) || [];
    list.push(font);
    categoryFonts.set(font.category, list);
  }

  // Build font catalog for Claude
  let fontCatalog = "Top 100 Google Fonts by popularity:\n\n";
  for (const [category, fonts] of categoryFonts.entries()) {
    fontCatalog += `${category.toUpperCase()} (${fonts.length} fonts):\n`;
    for (const font of fonts.slice(0, 10)) {
      fontCatalog += `  - ${font.family} (rank #${font.popularity}, weights: ${font.weightRange}`;
      if (font.hasBold) fontCatalog += ", bold";
      if (font.hasItalic) fontCatalog += ", italic";
      fontCatalog += ")\n";
    }
    fontCatalog += "\n";
  }

  const prompt = `Given the keyword or phrase "${keyword}", recommend 3-5 specific Google Fonts that would be most appropriate for displaying this text as a graph cluster label.

${fontCatalog}

Consider:
1. Semantic fit: Does the font's style match the meaning/tone of the keyword?
2. Readability: Will it work well for graph labels at various zoom levels?
3. Weight availability: Bold variants help with visibility
4. Visual hierarchy: Display fonts for emphasis, sans-serif for neutrality, monospace for technical content

Return your recommendations as a ranked list with brief explanations:

1. [Font Name] ([category]): [why it fits semantically and visually]
2. [Font Name] ([category]): [why it fits semantically and visually]
...`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": anthropicApiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-5-20250929",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error: ${response.status} ${response.statusText}\n${errorText}`);
  }

  const data = await response.json();
  const text = data.content[0].text;

  console.log("Recommended fonts:\n");
  console.log(text);
}

// Main CLI
const command = process.argv[2];
const arg = process.argv[3];

if (command === "inspect") {
  inspectFontMetadata().catch(console.error);
} else if (command === "list-categories") {
  listCategories().catch(console.error);
} else if (command === "list-tags") {
  listTags().catch(console.error);
} else if (command === "match" && arg) {
  matchKeywordToFonts(arg).catch(console.error);
} else {
  console.log("Usage:");
  console.log("  npm run script scripts/explore-font-categories.ts inspect");
  console.log("  npm run script scripts/explore-font-categories.ts list-categories");
  console.log("  npm run script scripts/explore-font-categories.ts list-tags");
  console.log("  npm run script scripts/explore-font-categories.ts match \"your keyword\"");
}
