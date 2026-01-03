import { readFileSync } from "fs";
import { chunkText } from "../src/lib/chunker";

// Strip frontmatter (copy from parser.ts)
function stripFrontmatter(content: string): string {
  const frontmatterRegex = /^---\n[\s\S]*?\n---\n?/;
  return content.replace(frontmatterRegex, "").trim();
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: npm run script scripts/test-chunker.ts <file-path>");
    process.exit(1);
  }

  const vaultPath = process.env.VAULT_PATH;
  const fullPath = filePath.startsWith("/") ? filePath : `${vaultPath}/${filePath}`;

  console.log(`Reading: ${fullPath}\n`);
  const raw = readFileSync(fullPath, "utf-8");
  const content = stripFrontmatter(raw);

  console.log(`Content length: ${content.length} chars (~${Math.ceil(content.length / 4)} tokens)\n`);
  console.log("Chunking with Haiku (streaming)...\n");

  const startTime = Date.now();
  let chunkCount = 0;
  let totalChars = 0;

  // Stream chunks as they're produced
  for await (const chunk of chunkText(content)) {
    chunkCount++;
    totalChars += chunk.content.length;
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const tokens = Math.ceil(chunk.content.length / 4);

    console.log(`\n${"=".repeat(60)}`);
    console.log(`[${elapsed}s] CHUNK ${chunkCount} | ${chunk.chunkType || "?"} | ${tokens} tokens`);
    console.log(`Keywords: ${chunk.keywords.join(", ") || "(none)"}`);
    console.log(`${"=".repeat(60)}`);
    console.log(chunk.content.trim());
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`=== Done (${totalTime}s) ===`);
  console.log(`Total chunks: ${chunkCount}`);
  console.log(`Average chunk size: ${Math.round(totalChars / chunkCount)} chars (~${Math.round(totalChars / chunkCount / 4)} tokens)`);
}

main().catch(console.error);
