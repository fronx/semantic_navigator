import { createServerClient } from "../src/lib/supabase";

const ids = process.argv.slice(2);

if (ids.length === 0) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/query-nodes.ts <uuid> [uuid...]");
  process.exit(1);
}

async function main() {
  const supabase = createServerClient();

  const { data, error } = await supabase
    .from("nodes")
    .select("id, content, node_type, source_path")
    .in("id", ids);

  if (error) {
    console.error(error);
    process.exit(1);
  }

  for (const node of data) {
    console.log("---");
    console.log("ID:", node.id);
    console.log("Type:", node.node_type);
    console.log("Source:", node.source_path);
    console.log("Content:", node.content);
  }
}

main();
