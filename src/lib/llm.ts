/**
 * Shared LLM infrastructure for Anthropic API calls.
 */
import Anthropic from "@anthropic-ai/sdk";

// Check if API key is configured
const apiKey = process.env.ANTHROPIC_API_KEY;
const isApiKeyConfigured = Boolean(apiKey && apiKey.trim() && !apiKey.startsWith("#"));

// Shared Anthropic client - reused across all LLM calls
// Only create if API key is configured to avoid SDK errors
export const anthropic = isApiKeyConfigured
  ? new Anthropic({ apiKey })
  : (null as unknown as Anthropic);

/** Check if LLM features are available */
export function isLLMAvailable(): boolean {
  return isApiKeyConfigured;
}

/**
 * Extract JSON from LLM response, handling markdown code blocks.
 */
export function extractJsonFromResponse(text: string): string {
  let jsonText = text.trim();

  // Try markdown code block first
  const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find JSON object/array in the response
  const jsonStart = jsonText.search(/[{\[]/);
  const jsonEndBrace = jsonText.lastIndexOf("}");
  const jsonEndBracket = jsonText.lastIndexOf("]");
  const jsonEnd = Math.max(jsonEndBrace, jsonEndBracket);

  if (jsonStart !== -1 && jsonEnd > jsonStart) {
    return jsonText.slice(jsonStart, jsonEnd + 1);
  }

  return jsonText;
}

/**
 * Parse a JSON array from LLM response text.
 * Handles markdown code blocks and filters non-strings.
 */
export function parseJsonArray(text: string): string[] {
  const jsonText = extractJsonFromResponse(text);
  const parsed = JSON.parse(jsonText);
  if (Array.isArray(parsed)) {
    return parsed.filter((k) => typeof k === "string");
  }
  return [];
}

/**
 * Generate semantic labels for keyword clusters using Haiku.
 *
 * @param clusters - Array of clusters, each with id and keywords
 * @returns Map from cluster ID to semantic label
 */
export async function generateClusterLabels(
  clusters: Array<{ id: number; keywords: string[] }>
): Promise<Record<number, string>> {
  if (clusters.length === 0) return {};

  // If LLM is not available, use first keyword as fallback label
  if (!isLLMAvailable()) {
    const result: Record<number, string> = {};
    for (const c of clusters) {
      result[c.id] = c.keywords[0] ?? `cluster ${c.id}`;
    }
    return result;
  }

  // Build a compact representation for the prompt
  const clusterDescriptions = clusters.map(
    (c) => `${c.id}: ${c.keywords.slice(0, 15).join(", ")}${c.keywords.length > 15 ? "..." : ""}`
  );

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: `You are labeling keyword clusters for a knowledge graph visualization.

Each cluster contains semantically related keywords. Generate a SHORT label (2-4 words) that captures what the cluster is about.

Clusters:
${clusterDescriptions.join("\n")}

Return a JSON object mapping cluster IDs to labels, like:
{"0": "machine learning basics", "1": "web development", "2": "data structures"}

Labels should be:
- Descriptive but concise (1-4 words)
- In lowercase
- Capture the common theme, not just list keywords

Return ONLY the JSON object.`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock?.text) return {};

  try {
    const jsonText = extractJsonFromResponse(textBlock.text);
    const parsed = JSON.parse(jsonText);

    // Convert string keys to numbers
    const result: Record<number, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        result[parseInt(key, 10)] = value;
      }
    }
    return result;
  } catch (error) {
    console.error("[llm] Failed to parse cluster labels response:", textBlock.text);
    return {};
  }
}

export interface RefinementRequest {
  id: number;
  oldLabel: string;
  oldKeywords: string[];
  newKeywords: string[];
}

/**
 * Refine cluster labels when keywords have changed slightly.
 * Used for near-matches from the cache (0.85-0.95 similarity).
 *
 * @param refinements - Array of clusters needing label refinement
 * @returns Map from cluster ID to refined label (or same label if kept)
 */
export async function refineClusterLabels(
  refinements: RefinementRequest[]
): Promise<Record<number, string>> {
  if (refinements.length === 0) return {};

  // If LLM is not available, keep all existing labels
  if (!isLLMAvailable()) {
    const result: Record<number, string> = {};
    for (const r of refinements) {
      result[r.id] = r.oldLabel;
    }
    return result;
  }

  // Build compact descriptions showing old vs new
  const descriptions = refinements.map((r) => {
    const oldKw = r.oldKeywords.slice(0, 10).join(", ");
    const newKw = r.newKeywords.slice(0, 10).join(", ");
    return `${r.id}:
  Previous label: "${r.oldLabel}"
  Previous keywords: ${oldKw}
  Current keywords: ${newKw}`;
  });

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `You previously labeled some keyword clusters. The cluster membership has changed slightly.

For each cluster, decide if the label still fits or needs updating.

${descriptions.join("\n\n")}

Return a JSON object mapping cluster IDs to either:
- "keep" if the label still fits
- A new label (1-2 words, rarely 3 if needed for specificity)

Example: {"0": "keep", "1": "neural networks", "2": "keep"}

Return ONLY the JSON object.`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock?.text) return {};

  try {
    const jsonText = extractJsonFromResponse(textBlock.text);
    const parsed = JSON.parse(jsonText);

    // Convert responses, replacing "keep" with original label
    const result: Record<number, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        const id = parseInt(key, 10);
        const original = refinements.find((r) => r.id === id);
        result[id] = value === "keep" && original ? original.oldLabel : value;
      }
    }
    return result;
  } catch (error) {
    console.error("[llm] Failed to parse refinement response:", textBlock.text);
    return {};
  }
}

/**
 * Generate labels for chunk clusters using content excerpts.
 * Each cluster sends first ~200 chars of up to 15 member chunks to Haiku.
 */
export async function generateChunkClusterLabels(
  clusters: Array<{ id: number; excerpts: string[] }>
): Promise<Record<number, string>> {
  if (clusters.length === 0) return {};

  if (!isLLMAvailable()) {
    const result: Record<number, string> = {};
    for (const c of clusters) {
      result[c.id] = c.excerpts[0]?.slice(0, 30) ?? `cluster ${c.id}`;
    }
    return result;
  }

  const clusterDescriptions = clusters
    .map((c) => `Cluster ${c.id}:\n${c.excerpts.slice(0, 15).map((e) => `  - ${e}`).join("\n")}`)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    messages: [
      {
        role: "user",
        content: `Label these clusters of personal writing for a 2D map. Labels float over regions like chapter titles.

Format: 2 words strongly preferred. 3 only when truly necessary. Lowercase. No "the" to start. No commas.

Style: treat the writing as philosophical poetry, not academic text. Don't retheorize — resonate.
Noun phrases preferred. If you use a verb, make it blunt and specific, not poetic or soft.
No verb gerunds (words acting as verbs: "forming", "questioning", "breaking"). Nouns ending in -ing are fine ("sneezing", "meaning").
Do not lift words directly from the excerpts — find your own angle on what the cluster is about.
Aim to intrigue, not summarize. A reader should think "what's that?" not "I see".

Bad (soft verb): "thoughts drift", "patterns emerge", "habits return"
Bad (verb gerund): "pattern forming", "self questioning", "habit breaking"
Bad (too long): "what sneezing reveals", "how stories shape us", "the cost of clarity"
Bad (flat pair): "concept limit", "value reach", "idea count"
Good: "two hungers", "borrowed time", "maps lie", "static breaks", "artful sneezing", "fault inside"

${clusterDescriptions}

Return ONLY a JSON object: {"0": "label", "1": "label", ...}`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock?.text) return {};

  try {
    const jsonText = extractJsonFromResponse(textBlock.text);
    const parsed = JSON.parse(jsonText);
    const result: Record<number, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        result[parseInt(key, 10)] = value;
      }
    }
    return result;
  } catch (error) {
    console.error("[llm] Failed to parse chunk cluster labels:", textBlock.text);
    return {};
  }
}
