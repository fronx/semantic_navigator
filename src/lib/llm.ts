/**
 * Shared LLM infrastructure for Anthropic API calls.
 */
import Anthropic from "@anthropic-ai/sdk";

// Shared Anthropic client - reused across all LLM calls
export const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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
- Descriptive but concise (2-4 words)
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
