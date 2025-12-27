import { promises as fs } from "fs";
import path from "path";
import { VaultEntry } from "./types";
import { estimateTokens } from "./embeddings";

export async function browseVault(
  vaultPath: string,
  relativePath: string = ""
): Promise<VaultEntry[]> {
  const fullPath = path.join(vaultPath, relativePath);
  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  const result: VaultEntry[] = [];

  for (const entry of entries) {
    // Skip hidden files and folders
    if (entry.name.startsWith(".")) continue;

    const entryPath = path.join(relativePath, entry.name);

    if (entry.isDirectory()) {
      result.push({
        name: entry.name,
        path: entryPath,
        type: "directory",
      });
    } else if (entry.name.endsWith(".md")) {
      const stat = await fs.stat(path.join(vaultPath, entryPath));
      result.push({
        name: entry.name,
        path: entryPath,
        type: "file",
        size: stat.size,
        estimatedTokens: Math.ceil(stat.size / 4), // rough estimate
      });
    }
  }

  // Sort: directories first, then files, alphabetically
  result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return result;
}

export async function getVaultEntryWithChildren(
  vaultPath: string,
  relativePath: string
): Promise<VaultEntry> {
  const fullPath = path.join(vaultPath, relativePath);
  const stat = await fs.stat(fullPath);
  const name = path.basename(relativePath);

  if (stat.isDirectory()) {
    const children = await browseVault(vaultPath, relativePath);
    let totalTokens = 0;
    for (const child of children) {
      totalTokens += child.estimatedTokens || 0;
    }
    return {
      name,
      path: relativePath,
      type: "directory",
      estimatedTokens: totalTokens,
      children,
    };
  } else {
    return {
      name,
      path: relativePath,
      type: "file",
      size: stat.size,
      estimatedTokens: Math.ceil(stat.size / 4),
    };
  }
}

export async function readVaultFile(
  vaultPath: string,
  relativePath: string
): Promise<string> {
  const fullPath = path.join(vaultPath, relativePath);
  return fs.readFile(fullPath, "utf-8");
}

export async function collectMarkdownFiles(
  vaultPath: string,
  relativePath: string = ""
): Promise<string[]> {
  const fullPath = path.join(vaultPath, relativePath);
  const stat = await fs.stat(fullPath);

  if (!stat.isDirectory()) {
    return relativePath.endsWith(".md") ? [relativePath] : [];
  }

  const entries = await fs.readdir(fullPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const entryPath = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(vaultPath, entryPath)));
    } else if (entry.name.endsWith(".md")) {
      files.push(entryPath);
    }
  }

  return files;
}

// Estimate cost for importing files
export async function estimateImportCost(
  vaultPath: string,
  paths: string[]
): Promise<{ files: number; tokens: number; estimatedCost: number }> {
  let totalFiles = 0;
  let totalTokens = 0;

  for (const p of paths) {
    const files = await collectMarkdownFiles(vaultPath, p);
    for (const file of files) {
      const content = await readVaultFile(vaultPath, file);
      totalFiles++;
      totalTokens += estimateTokens(content);
    }
  }

  // Rough cost estimate:
  // - Embeddings: ~$0.02 per 1M tokens
  // - Claude summarization: ~$3 per 1M input tokens (assuming ~2x content for summaries)
  const embeddingCost = (totalTokens / 1_000_000) * 0.02;
  const summarizationCost = (totalTokens / 1_000_000) * 3 * 2;
  const estimatedCost = embeddingCost + summarizationCost;

  return { files: totalFiles, tokens: totalTokens, estimatedCost };
}
