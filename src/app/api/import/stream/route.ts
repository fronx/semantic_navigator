import { NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { collectMarkdownFiles, readVaultFile } from "@/lib/vault";
import { ingestArticlesParallelChunked } from "@/lib/ingestion-parallel";

interface SSEWriter {
  write(event: string, data: unknown): void;
}

function createSSEWriter(controller: ReadableStreamDefaultController<Uint8Array>): SSEWriter {
  const encoder = new TextEncoder();
  return {
    write(event: string, data: unknown) {
      const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      controller.enqueue(encoder.encode(message));
    },
  };
}

export async function POST(request: NextRequest) {
  const { paths } = await request.json();
  const vaultPath = process.env.VAULT_PATH;

  if (!vaultPath) {
    return new Response(JSON.stringify({ error: "VAULT_PATH not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createServerClient();

  // Collect all markdown files from selected paths
  const allFilePaths: string[] = [];
  for (const p of paths) {
    const files = await collectMarkdownFiles(vaultPath, p);
    allFilePaths.push(...files);
  }

  // Read all file contents
  const files = await Promise.all(
    allFilePaths.map(async (filePath) => ({
      path: filePath,
      name: filePath.split("/").pop() || filePath,
      content: await readVaultFile(vaultPath, filePath),
    }))
  );

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sse = createSSEWriter(controller);

      console.log(`[Import] Starting parallel import of ${files.length} files`);
      sse.write("start", { totalFiles: files.length });

      try {
        const result = await ingestArticlesParallelChunked(supabase, files, {
          onProgress: (completed, total, activeFiles) => {
            console.log(`[Import] Progress: ${completed}/${total} | Active: ${activeFiles.join(", ")}`);
            sse.write("progress", {
              completed,
              total,
              activeFiles,
            });
          },
          onError: (error, context) => {
            console.error(`[Import] Error in ${context}: ${error.message}`);
            sse.write("error", {
              context,
              message: error.message,
            });
          },
        });

        console.log(`[Import] Complete: ${result.successful} successful, ${result.failed} failed`);
        sse.write("complete", {
          successful: result.successful,
          failed: result.failed,
          totalFiles: files.length,
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        console.error(`[Import] Fatal error: ${errorMessage}`);
        sse.write("complete", {
          successful: 0,
          failed: files.length,
          totalFiles: files.length,
          error: errorMessage,
        });
      }

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
