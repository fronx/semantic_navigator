import { anthropic, parseJsonArray, extractJsonFromResponse } from "./llm";

export interface ArticleSummary {
  type: string;
  teaser?: string;  // For longer pieces - LLM-generated teaser
  content?: string;  // For short pieces - full content
}

export async function generateArticleSummary(
  title: string,
  content: string
): Promise<ArticleSummary> {
  // For very short content, use full content directly
  const contentLength = content.length;
  const typicalSummaryLength = 300;
  const maxDirectContentLength = typicalSummaryLength * 1.5; // ~450 chars

  if (contentLength < maxDirectContentLength) {
    console.log(`[Claude] Short content (${contentLength} chars), using full content`);

    // Still detect type via LLM
    const typeResponse = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 50,
      messages: [
        {
          role: "user",
          content: `Identify the TYPE of this writing in one word (essay, poem, article, reflection, dialogue, guide, etc.):

${content}`,
        },
      ],
    });

    const typeBlock = typeResponse.content.find((block) => block.type === "text");
    const type = typeBlock?.type === "text" ? typeBlock.text.trim().toLowerCase() : "article";

    return { type, content };
  }

  // For longer content, generate a teaser
  console.log(`[Claude] Generating article teaser: "${title}"`);
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `You are creating a teaser for this piece of writing. Your task has two parts:

1. Identify the TYPE of writing (essay, poem, article, reflection, dialogue, guide, etc.)

2. Write a 2-3 sentence teaser that:
   - Speaks FROM the piece's perspective, not ABOUT it (avoid "this essay argues...")
   - MATCHES THE ORIGINAL'S VOICE:
     * Use "I" ONLY if the piece is personal/autobiographical
     * For conceptual or philosophical pieces, make direct statements
     * For instructional pieces, use "you" or imperative voice
   - Captures its unique voice, style, and approach
   - Highlights what makes THIS piece distinctive
   - Makes the reader want to engage with it
   - Uses plain text only (no markdown, no formatting)

Return ONLY a JSON object:
{"type": "essay", "teaser": "Your teaser here"}

Title: "${title}"

Content:
${content}`,
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    return { type: "article", teaser: "" };
  }

  try {
    const jsonText = extractJsonFromResponse(textBlock.text);
    return JSON.parse(jsonText) as ArticleSummary;
  } catch {
    console.error("Failed to parse article summary response:", textBlock.text);
    return { type: "article", teaser: textBlock.text };
  }
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
