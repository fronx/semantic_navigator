import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface EmbeddingContext {
  type: "article-summary" | "section-summary" | "paragraph" | "paragraph-summary" | "keyword";
  article: string;
  section?: string;
  keyword?: string;
}

function formatContext(ctx: EmbeddingContext): string {
  const location = ctx.section ? `"${ctx.article}" > ${ctx.section}` : `"${ctx.article}"`;
  switch (ctx.type) {
    case "keyword":
      return `keyword "${ctx.keyword}" in ${location}`;
    case "article-summary":
      return `article summary: ${location}`;
    case "section-summary":
      return `section summary: ${location}`;
    case "paragraph-summary":
      return `paragraph summary: ${location}`;
    case "paragraph":
      return `paragraph: ${location}`;
  }
}

export async function generateEmbedding(text: string, context?: EmbeddingContext): Promise<number[]> {
  const what = context ? formatContext(context) : `${text.length} chars`;
  console.log(`[OpenAI] Embedding ${what}`);
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: text,
  });
  return response.data[0].embedding;
}

export async function generateEmbeddings(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
  console.log(`[OpenAI] Generating ${texts.length} embeddings for ${totalChars} chars total`);
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });

  return response.data.map((d) => d.embedding);
}

// Rough token estimate (4 chars per token for English)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate an embedding to fewer dimensions and re-normalize.
 * OpenAI's text-embedding-3-* models use Matryoshka representation learning,
 * so truncated embeddings remain meaningful with minimal accuracy loss.
 */
export function truncateEmbedding(embedding: number[], dims: number): number[] {
  const truncated = embedding.slice(0, dims);
  const norm = Math.sqrt(truncated.reduce((sum, x) => sum + x * x, 0));
  if (norm === 0) return truncated;
  return truncated.map(x => x / norm);
}
