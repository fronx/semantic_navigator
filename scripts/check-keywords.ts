import { createServerClient } from "../src/lib/supabase";

async function main() {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('keywords')
    .select('keyword');

  if (error) { console.error(error); process.exit(1); }

  // Show longest keywords first
  const sorted = data.map(k => k.keyword).sort((a, b) => b.length - a.length);
  console.log('Longest keywords:');
  sorted.slice(0, 30).forEach((k, i) => console.log(`${i+1}. (${k.length} chars) ${k}`));
}

main();
