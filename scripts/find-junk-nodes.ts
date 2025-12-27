import { createServerClient } from "../src/lib/supabase";

async function main() {
  const supabase = createServerClient();

  // Find paragraph nodes with junk content patterns
  const { data: nodes, error } = await supabase
    .from("nodes")
    .select("id, content")
    .eq("node_type", "paragraph")
    .not("content", "is", null);

  if (error) {
    console.error(error);
    process.exit(1);
  }

  const junkPatterns = {
    imageOnly: /^!\[[^\]]*\]\([^)]*\)$/,
    singleBracket: /^[\[\]]$/,
    brokenLinkClose: /^\]\([^)]*\)$/,
  };

  const junkNodes: { id: string; content: string; reason: string }[] = [];

  for (const node of nodes) {
    const content = node.content?.trim();
    if (!content) continue;

    for (const [reason, pattern] of Object.entries(junkPatterns)) {
      if (pattern.test(content)) {
        junkNodes.push({ id: node.id, content, reason });
        break;
      }
    }
  }

  console.log(`Found ${junkNodes.length} junk nodes out of ${nodes.length} paragraph nodes:\n`);

  for (const node of junkNodes) {
    console.log(`ID: ${node.id}`);
    console.log(`Reason: ${node.reason}`);
    console.log(`Content: ${node.content.slice(0, 100)}${node.content.length > 100 ? "..." : ""}`);
    console.log("---");
  }
}

main();
