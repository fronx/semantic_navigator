import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function generateEmbedding(text: string): Promise<number[]> {
  console.log(`[OpenAI] Generating embedding for ${text.length} chars`);
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
