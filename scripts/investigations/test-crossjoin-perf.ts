import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function test() {
  const SIMILARITY_THRESHOLD = 0.7;

  console.log(`--- Testing Cross-Join approach ---`);
  console.log(`Threshold: ${SIMILARITY_THRESHOLD * 100}%\n`);

  const start = performance.now();

  const { data: pairs, error } = await supabase.rpc("get_similar_keyword_pairs", {
    similarity_threshold: SIMILARITY_THRESHOLD,
  });

  const end = performance.now();

  if (error) {
    console.error(`Error: ${error.message}`);
    return;
  }

  console.log(`Time: ${(end - start).toFixed(0)}ms`);
  console.log(`Found ${pairs?.length || 0} pairs\n`);

  if (pairs && pairs.length > 0) {
    console.log(`Top 20 pairs:`);
    for (const pair of pairs.slice(0, 20)) {
      console.log(
        `  "${pair.keyword1_text}" <-> "${pair.keyword2_text}" (${(pair.similarity * 100).toFixed(1)}%)`
      );
    }
  }
}

test().catch(console.error);
