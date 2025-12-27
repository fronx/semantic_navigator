import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { collectMarkdownFiles, readVaultFile } from "@/lib/vault";
import { ingestArticle } from "@/lib/ingestion";

export async function POST(request: NextRequest) {
  const { paths } = await request.json();
  const vaultPath = process.env.VAULT_PATH;

  if (!vaultPath) {
    return NextResponse.json(
      { error: "VAULT_PATH not configured" },
      { status: 500 }
    );
  }

  const supabase = createServerClient();

  // Collect all markdown files from selected paths
  const allFiles: string[] = [];
  for (const p of paths) {
    const files = await collectMarkdownFiles(vaultPath, p);
    allFiles.push(...files);
  }

  const results: { path: string; success: boolean; error?: string }[] = [];

  for (const file of allFiles) {
    try {
      const content = await readVaultFile(vaultPath, file);
      await ingestArticle(supabase, file, content);
      results.push({ path: file, success: true });
    } catch (error) {
      results.push({
        path: file,
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  return NextResponse.json({
    total: allFiles.length,
    successful: results.filter((r) => r.success).length,
    results,
  });
}
