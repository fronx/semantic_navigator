import { SupabaseClient } from "@supabase/supabase-js";
import pLimit from "p-limit";
import { ingestArticle } from "./ingestion";

const DEFAULT_CONCURRENCY = 10;

export interface ParallelIngestionCallbacks {
  onProgress?: (completed: number, total: number, activeFiles: string[]) => void;
  onError?: (error: Error, context: string) => void;
}

interface FileData {
  path: string;
  name: string;
  content: string;
}

export async function ingestArticlesParallel(
  supabase: SupabaseClient,
  files: FileData[],
  callbacks?: ParallelIngestionCallbacks,
  concurrency: number = DEFAULT_CONCURRENCY
): Promise<{ successful: number; failed: number }> {
  const limit = pLimit(concurrency);

  let completed = 0;
  let successful = 0;
  let failed = 0;
  const activeFiles = new Set<string>();

  const report = () => {
    callbacks?.onProgress?.(completed, files.length, Array.from(activeFiles));
  };

  const promises = files.map((file) =>
    limit(async () => {
      activeFiles.add(file.name);
      report();

      try {
        await ingestArticle(supabase, file.path, file.content);
        successful++;
      } catch (error) {
        failed++;
        callbacks?.onError?.(
          error instanceof Error ? error : new Error(String(error)),
          file.name
        );
      } finally {
        activeFiles.delete(file.name);
        completed++;
        report();
      }
    })
  );

  await Promise.all(promises);

  return { successful, failed };
}
