import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function generateSummary(
  content: string,
  context: { articleTitle: string; sectionPath: string[] }
): Promise<string> {
  const contextInfo =
    context.sectionPath.length > 0
      ? `This is from the article "${context.articleTitle}", section: ${context.sectionPath.join(" > ")}`
      : `This is the full article "${context.articleTitle}"`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
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
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
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
