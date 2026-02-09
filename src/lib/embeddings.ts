import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export interface EmbeddingContext {
  type: "article-summary" | "keyword" | "chunk";
  article: string;
  keyword?: string;
  position?: number;
}

function formatContext(ctx: EmbeddingContext): string {
  switch (ctx.type) {
    case "keyword":
      return `keyword "${ctx.keyword}" in "${ctx.article}"`;
    case "article-summary":
      return `article summary: "${ctx.article}"`;
    case "chunk":
      return `chunk ${ctx.position ?? "?"}: "${ctx.article}"`;
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

  const invalid = texts.findIndex(t => !t || typeof t !== "string");
  if (invalid !== -1) {
    throw new Error(`generateEmbeddings: invalid input at index ${invalid}: ${JSON.stringify(texts[invalid])}`);
  }

  const totalChars = texts.reduce((sum, t) => sum + t.length, 0);
  console.log(`[OpenAI] Generating ${texts.length} embeddings for ${totalChars} chars total`);
  const response = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: texts,
  });

  return response.data.map((d) => d.embedding);
}

const OPENAI_BATCH_SIZE = 2048;  // Max inputs per request
const RATE_LIMIT_DELAY_MS = 100;  // Delay between batches to avoid rate limits

/**
 * Generate embeddings for many texts, batching to stay within API limits.
 * More efficient than calling generateEmbedding() in a loop.
 */
export async function generateEmbeddingsBatched(
  texts: string[],
  onProgress?: (completed: number, total: number) => void
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += OPENAI_BATCH_SIZE) {
    const batch = texts.slice(i, i + OPENAI_BATCH_SIZE);

    // Rate limit delay between batches (skip for first batch)
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_DELAY_MS));
    }

    const batchEmbeddings = await generateEmbeddings(batch);
    results.push(...batchEmbeddings);

    const completed = Math.min(i + OPENAI_BATCH_SIZE, texts.length);
    onProgress?.(completed, texts.length);
  }

  return results;
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
