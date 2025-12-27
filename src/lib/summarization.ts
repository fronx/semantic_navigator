import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function formatLocation(articleTitle: string, sectionPath: string[]): string {
  return sectionPath.length > 0
    ? `"${articleTitle}" > ${sectionPath.join(" > ")}`
    : `"${articleTitle}"`;
}

export async function extractKeywords(
  content: string,
  context: { articleTitle: string; sectionPath: string[] }
): Promise<string[]> {
  console.log(`[Claude] Extracting keywords: ${formatLocation(context.articleTitle, context.sectionPath)}`);
  const contextInfo =
    context.sectionPath.length > 0
      ? `This is from the article "${context.articleTitle}", section: ${context.sectionPath.join(" > ")}`
      : `This is the full article "${context.articleTitle}"`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 200,
    messages: [
      {
        role: "user",
        content: `${contextInfo}

Extract 1-5 key concepts or topics from this content that would help someone find it via search.

Requirements for good keywords:
- Single words or short noun phrases (max 3 words)
- Represent concepts, topics, or named entities (people, papers, techniques)
- Lowercase unless it's a proper noun or acronym

Do NOT use as keywords:
- Full sentences or clauses
- Section headings or titles from the text
- Quotes or phrases copied verbatim from the content
- Meta-commentary (e.g. "key insight", "main argument")
- Dates, attributions, or formatting artifacts

Good: ["active inference", "free energy principle", "Karl Friston"]
Bad: ["The key insight here is that agency emerges from...", "Section 3: Agency"]

Return ONLY a JSON array. Include only genuinely distinct concepts - fewer is better than padding.

Content:
${content}`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock?.text) return [];

  try {
    const parsed = JSON.parse(textBlock.text.trim());
    if (Array.isArray(parsed)) {
      return parsed.filter((k) => typeof k === "string").slice(0, 5);
    }
  } catch {
    // If JSON parsing fails, try to extract words from the response
    const matches = textBlock.text.match(/"([^"]+)"/g);
    if (matches) {
      return matches.map((m) => m.replace(/"/g, "")).slice(0, 5);
    }
  }
  return [];
}

export async function generateSummary(
  content: string,
  context: { articleTitle: string; sectionPath: string[] }
): Promise<string> {
  console.log(`[Claude] Generating summary: ${formatLocation(context.articleTitle, context.sectionPath)}`);
  const contextInfo =
    context.sectionPath.length > 0
      ? `This is from the article "${context.articleTitle}", section: ${context.sectionPath.join(" > ")}`
      : `This is the full article "${context.articleTitle}"`;

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `${contextInfo}

Summarize the following content in 1-3 sentences. Focus on the key ideas and how they relate to the broader context. Be concise.

Content:
${content}`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock?.text ?? "";
}

export async function generateArticleSummary(
  title: string,
  content: string
): Promise<string> {
  console.log(`[Claude] Generating article summary: "${title}"`);
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `Summarize this article titled "${title}" in 2-4 sentences. Capture the main themes and key takeaways.

${content}`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock?.text ?? "";
}
