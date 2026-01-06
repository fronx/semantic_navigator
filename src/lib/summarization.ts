import { anthropic, parseJsonArray } from "./llm";

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

export interface SectionKeywords {
  title: string;
  keywords: string[];
}

export async function reduceKeywordsForArticle(
  articleTitle: string,
  sections: SectionKeywords[]
): Promise<string[]> {
  const allKeywords = sections.flatMap((s) => s.keywords);
  if (allKeywords.length === 0) return [];

  const uniqueKeywords = [...new Set(allKeywords)];
  console.log(`[Claude] Reducing article keywords: "${articleTitle}" (${uniqueKeywords.length} unique from ${sections.length} sections)`);

  // If very few keywords, just return the unique ones
  if (uniqueKeywords.length <= 8) {
    return uniqueKeywords;
  }

  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [
      {
        role: "user",
        content: `You are reducing keywords from section-level to article-level for a knowledge base.

Article: "${articleTitle}"

Sections and their keywords:
${JSON.stringify(sections, null, 2)}

Task: Select or synthesize 5-10 keywords that best represent this ARTICLE as a whole.

Guidelines:
- Prefer keywords that appear across multiple sections (core themes)
- Merge near-synonyms into a single representative term
- Keep proper nouns and technical terms that are important
- Drop keywords that are too specific to one section
- You may synthesize a higher-level keyword if it captures the article's main thesis

Return ONLY a JSON array of strings.`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock?.text) return [];

  try {
    return parseJsonArray(textBlock.text);
  } catch {
    console.error("Failed to parse article keyword reduction response:", textBlock.text);
    return [];
  }
}
