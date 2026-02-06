import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { parseMarkdown, flattenSections } from "../src/lib/parser";

interface DocumentInfo {
  path: string;
  filename: string;
  sizeKB: number;
  lineCount: number;
  frontmatterLines: number;
  topLevelSections: number;
  totalSections: number;
  totalParagraphs: number;
  headingPattern: string; // e.g., "h1>h2>h3" or "h2>h3" or "flat"
  hasPromptResponse: boolean;
  hasNumberedSections: boolean;
  sampleHeadings: string[];
}

function getFiles(dir: string, files: string[] = []): string[] {
  const items = readdirSync(dir);
  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      getFiles(fullPath, files);
    } else if (item.endsWith(".md")) {
      files.push(fullPath);
    }
  }
  return files;
}

function analyzeDocument(filePath: string, vaultPath: string): DocumentInfo {
  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const filename = filePath.split("/").pop() || filePath;
  const relativePath = filePath.replace(vaultPath + "/", "");

  // Count frontmatter lines
  let frontmatterLines = 0;
  if (content.startsWith("---\n")) {
    const endMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
    if (endMatch) {
      frontmatterLines = endMatch[0].split("\n").length - 1;
    }
  }

  const parsed = parseMarkdown(content, filename);
  const flat = flattenSections(parsed.sections);

  let totalParagraphs = 0;
  for (const section of flat) {
    totalParagraphs += section.paragraphs.length;
  }

  // Analyze heading pattern
  const levels = flat.map(s => s.level);
  const uniqueLevels = [...new Set(levels)].sort();
  const headingPattern = uniqueLevels.length === 0 ? "none" :
    uniqueLevels.map(l => `h${l}`).join(">");

  // Check for prompt/response pattern (chat logs)
  const headings = flat.map(s => s.title.toLowerCase());
  const hasPromptResponse = headings.some(h =>
    h.includes("prompt") || h.includes("response") ||
    h.includes("user:") || h.includes("assistant:")
  );

  // Check for numbered sections
  const hasNumberedSections = flat.some(s => /^\d+\./.test(s.title));

  // Get sample headings (first 5)
  const sampleHeadings = flat.slice(0, 5).map(s =>
    `[h${s.level}] ${s.title.slice(0, 50)}${s.title.length > 50 ? "..." : ""}`
  );

  return {
    path: relativePath,
    filename,
    sizeKB: Math.round(content.length / 1024),
    lineCount: lines.length,
    frontmatterLines,
    topLevelSections: parsed.sections.length,
    totalSections: flat.length,
    totalParagraphs,
    headingPattern,
    hasPromptResponse,
    hasNumberedSections,
    sampleHeadings,
  };
}

async function main() {
  const vaultPath = process.env.VAULT_PATH;
  if (!vaultPath) {
    console.error("VAULT_PATH environment variable not set");
    process.exit(1);
  }

  const writingPath = join(vaultPath, "Writing");
  console.log(`Surveying documents in: ${writingPath}\n`);

  const files = getFiles(writingPath);
  console.log(`Found ${files.length} markdown files\n`);

  const documents: DocumentInfo[] = [];
  for (const file of files) {
    try {
      documents.push(analyzeDocument(file, vaultPath));
    } catch (e) {
      console.error(`Error analyzing ${file}: ${e}`);
    }
  }

  // Group by heading pattern
  const byPattern: Record<string, DocumentInfo[]> = {};
  for (const doc of documents) {
    const pattern = doc.headingPattern;
    if (!byPattern[pattern]) byPattern[pattern] = [];
    byPattern[pattern].push(doc);
  }

  console.log("=== Document Patterns ===\n");
  for (const [pattern, docs] of Object.entries(byPattern).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${pattern}: ${docs.length} documents`);
    // Show examples
    for (const doc of docs.slice(0, 3)) {
      console.log(`  - ${doc.filename} (${doc.totalSections} sections, ${doc.totalParagraphs} paragraphs)`);
      if (doc.sampleHeadings.length > 0) {
        console.log(`    Headings: ${doc.sampleHeadings.slice(0, 3).join(", ")}`);
      }
    }
    if (docs.length > 3) {
      console.log(`  ... and ${docs.length - 3} more`);
    }
    console.log();
  }

  // Identify chat logs / dialogs
  const chatLogs = documents.filter(d => d.hasPromptResponse);
  console.log("=== Chat Logs / Dialogs ===\n");
  console.log(`Found ${chatLogs.length} documents with prompt/response patterns:`);
  for (const doc of chatLogs.slice(0, 10)) {
    console.log(`  - ${doc.path}`);
    console.log(`    Headings: ${doc.sampleHeadings.slice(0, 3).join(", ")}`);
  }
  if (chatLogs.length > 10) {
    console.log(`  ... and ${chatLogs.length - 10} more`);
  }

  // Large documents
  console.log("\n=== Large Documents (>50KB) ===\n");
  const large = documents.filter(d => d.sizeKB > 50).sort((a, b) => b.sizeKB - a.sizeKB);
  for (const doc of large.slice(0, 10)) {
    console.log(`  - ${doc.filename}: ${doc.sizeKB}KB, ${doc.frontmatterLines} frontmatter lines`);
    console.log(`    ${doc.totalSections} sections, ${doc.totalParagraphs} paragraphs`);
  }

  // Summary stats
  console.log("\n=== Summary Statistics ===\n");
  const totalSize = documents.reduce((sum, d) => sum + d.sizeKB, 0);
  const totalSections = documents.reduce((sum, d) => sum + d.totalSections, 0);
  const totalParagraphs = documents.reduce((sum, d) => sum + d.totalParagraphs, 0);
  const avgSections = (totalSections / documents.length).toFixed(1);
  const avgParagraphs = (totalParagraphs / documents.length).toFixed(1);

  console.log(`Total documents: ${documents.length}`);
  console.log(`Total size: ${totalSize}KB (${(totalSize / 1024).toFixed(1)}MB)`);
  console.log(`Total sections: ${totalSections}`);
  console.log(`Total paragraphs: ${totalParagraphs}`);
  console.log(`Average sections per doc: ${avgSections}`);
  console.log(`Average paragraphs per doc: ${avgParagraphs}`);
  console.log(`Chat logs: ${chatLogs.length} (${((chatLogs.length / documents.length) * 100).toFixed(0)}%)`);
}

main().catch(console.error);
