import { NextRequest } from "next/server";
import { createServerClient } from "@/lib/supabase";
import { collectMarkdownFiles, readVaultFile } from "@/lib/vault";
import { ingestArticle } from "@/lib/ingestion";

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
  const allFiles: string[] = [];
  for (const p of paths) {
    const files = await collectMarkdownFiles(vaultPath, p);
    allFiles.push(...files);
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const sse = createSSEWriter(controller);

      console.log(`[Import] Starting import of ${allFiles.length} files`);
      sse.write("start", { totalFiles: allFiles.length });

      let successful = 0;
      let failed = 0;

      for (let i = 0; i < allFiles.length; i++) {
        const file = allFiles[i];
        const fileName = file.split("/").pop() || file;

        console.log(`[Import] [${i + 1}/${allFiles.length}] Starting: ${fileName}`);
        sse.write("file-start", {
          file: fileName,
          filePath: file,
          fileIndex: i,
          totalFiles: allFiles.length,
        });

        try {
          const content = await readVaultFile(vaultPath, file);

          await ingestArticle(supabase, file, content, {
            onProgress: (item, completed, total) => {
              console.log(`[Import]   ${item} (${completed}/${total})`);
              sse.write("progress", {
                item,
                completed,
                total,
                file: fileName,
              });
            },
            onError: (error, context) => {
              console.error(`[Import]   Error in ${context}: ${error.message}`);
            },
          });

          successful++;
          console.log(`[Import] [${i + 1}/${allFiles.length}] Completed: ${fileName}`);
          sse.write("file-complete", {
            file: fileName,
            success: true,
            filesCompleted: successful + failed,
            totalFiles: allFiles.length,
          });
        } catch (error) {
          failed++;
          const errorMessage = error instanceof Error ? error.message : "Unknown error";
          console.error(`[Import] [${i + 1}/${allFiles.length}] Failed: ${fileName} - ${errorMessage}`);
          sse.write("file-complete", {
            file: fileName,
            success: false,
            error: errorMessage,
            filesCompleted: successful + failed,
            totalFiles: allFiles.length,
          });
        }
      }

      console.log(`[Import] Complete: ${successful} successful, ${failed} failed out of ${allFiles.length} files`);
      sse.write("complete", {
        successful,
        failed,
        totalFiles: allFiles.length,
      });

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
