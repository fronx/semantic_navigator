import { createServerClient } from "../src/lib/supabase";

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

async function main() {
  const supabase = createServerClient();

  // Get semantic* keywords with embeddings
  const { data: keywords } = await supabase
    .from("keywords")
    .select("keyword, embedding")
    .eq("node_type", "article")
    .ilike("keyword", "semantic%")
    .not("embedding", "is", null)
    .limit(10);

  if (!keywords || keywords.length < 2) {
    console.log("Not enough keywords found");
    return;
  }

  console.log(`Checking similarities between ${keywords.length} semantic* keywords:\n`);

  // Parse embeddings
  const parsed = keywords.map((k) => ({
    keyword: k.keyword,
    embedding:
      typeof k.embedding === "string" ? JSON.parse(k.embedding) : k.embedding,
  }));

  // Compute pairwise similarities
  const pairs: Array<{ a: string; b: string; sim: number }> = [];
  for (let i = 0; i < parsed.length; i++) {
    for (let j = i + 1; j < parsed.length; j++) {
      const sim = cosineSimilarity(parsed[i].embedding, parsed[j].embedding);
      pairs.push({ a: parsed[i].keyword, b: parsed[j].keyword, sim });
    }
  }

  // Sort by similarity descending
  pairs.sort((a, b) => b.sim - a.sim);

  console.log("Top 15 pairs by similarity:");
  for (const p of pairs.slice(0, 15)) {
    const marker = p.sim >= 0.7 ? " [above threshold]" : "";
    console.log(`  ${p.sim.toFixed(3)}: "${p.a}" <-> "${p.b}"${marker}`);
  }

  console.log("\nPairs below 0.7 threshold:");
  const below = pairs.filter((p) => p.sim < 0.7);
  console.log(`  ${below.length} / ${pairs.length} pairs are below threshold`);
}

main();
