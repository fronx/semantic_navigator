import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  const { data: pairs } = await supabase.rpc("get_article_keyword_graph", {
    similarity_threshold: 0.75,
  });

  // Collect unique article sizes
  const articleSizes = new Map<string, number>();
  for (const p of pairs || []) {
    articleSizes.set(p.article_path, p.article_size);
    articleSizes.set(p.similar_article_path, p.similar_article_size);
  }

  console.log("Article sizes (summary length):");
  const sorted = [...articleSizes.entries()].sort((a, b) => b[1] - a[1]);
  for (const [path, size] of sorted.slice(0, 15)) {
    const name = path.split("/").pop()?.replace(".md", "");
    console.log(`  ${size} chars: ${name}`);
  }

  console.log(`\nTotal articles: ${articleSizes.size}`);
  console.log(`Size range: ${Math.min(...articleSizes.values())} - ${Math.max(...articleSizes.values())}`);
}

main();
