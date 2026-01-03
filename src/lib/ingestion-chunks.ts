import { createHash } from "crypto";
import { SupabaseClient } from "@supabase/supabase-js";
import { parseMarkdown } from "./parser";
import { generateEmbeddingsBatched, truncateEmbedding } from "./embeddings";
import { generateArticleSummary, reduceKeywordsForArticle } from "./summarization";
import { NodeType } from "./types";
import { findExistingNode } from "./node-identity";
import { chunkText, Chunk } from "./chunker";

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export interface ChunkIngestionCallbacks {
  onProgress?: (current: string, completed: number, total: number) => void;
  onError?: (error: Error, context: string) => void;
}

export interface ChunkIngestionOptions {
  forceReimport?: boolean;
}

// Delete an article and all its descendants (handles old section→paragraph hierarchy too)
async function deleteArticleWithChunks(
  supabase: SupabaseClient,
  articleId: string
): Promise<void> {
  // Recursively get all descendant node IDs
  const allNodeIds: string[] = [articleId];
  const toProcess = [articleId];

  while (toProcess.length > 0) {
    const parentId = toProcess.pop()!;
    const { data: childEdges } = await supabase
      .from("containment_edges")
      .select("child_id")
      .eq("parent_id", parentId);

    if (childEdges) {
      for (const edge of childEdges) {
        allNodeIds.push(edge.child_id);
        toProcess.push(edge.child_id); // Process grandchildren too
      }
    }
  }

  // Delete keywords for all nodes
  await supabase.from("keywords").delete().in("node_id", allNodeIds);

  // Delete containment edges
  await supabase.from("containment_edges").delete().in("parent_id", allNodeIds);
  await supabase.from("containment_edges").delete().in("child_id", allNodeIds);

  // Delete backlink edges
  await supabase.from("backlink_edges").delete().in("source_id", allNodeIds);
  await supabase.from("backlink_edges").delete().in("target_id", allNodeIds);

  // Delete all nodes
  await supabase.from("nodes").delete().in("id", allNodeIds);

  console.log(`[Reimport] Deleted ${allNodeIds.length} nodes (article + descendants)`);
}

export async function ingestArticleWithChunks(
  supabase: SupabaseClient,
  sourcePath: string,
  content: string,
  callbacks?: ChunkIngestionCallbacks,
  options?: ChunkIngestionOptions
): Promise<string> {
  const filename = sourcePath.split("/").pop() || sourcePath;
  const parsed = parseMarkdown(content, filename);
  const articleContentHash = hash(parsed.content);

  // Check if article already exists
  const existingArticle = await findExistingNode(supabase, "article", {
    source_path: sourcePath,
  });

  if (existingArticle && options?.forceReimport) {
    console.log(`[Reimport] Deleting existing article: "${parsed.title}"`);
    await deleteArticleWithChunks(supabase, existingArticle.id);
  } else if (existingArticle) {
    if (existingArticle.content_hash === articleContentHash) {
      console.log(`[Skip] Article already exists: "${parsed.title}"`);
      callbacks?.onProgress?.(`Article: ${parsed.title} (existing)`, 1, 1);
      return existingArticle.id;
    } else {
      console.warn(`[Import] Article "${parsed.title}" content changed, skipping (not implemented)`);
      return existingArticle.id;
    }
  }

  // Run chunker to get all chunks
  console.log(`[Chunking] Processing "${parsed.title}"...`);
  const chunks: Chunk[] = [];
  for await (const chunk of chunkText(parsed.content)) {
    chunks.push(chunk);
  }
  console.log(`[Chunking] Got ${chunks.length} chunks`);

  // Generate article summary (requires LLM call)
  const articleSummary = await generateArticleSummary(parsed.title, parsed.content);

  // Collect all unique keywords from all chunks
  const allChunkKeywords: string[] = [];
  const keywordToChunkIndices = new Map<string, number[]>();  // keyword -> which chunks have it

  for (let i = 0; i < chunks.length; i++) {
    for (const keyword of chunks[i].keywords) {
      allChunkKeywords.push(keyword);
      const indices = keywordToChunkIndices.get(keyword) || [];
      indices.push(i);
      keywordToChunkIndices.set(keyword, indices);
    }
  }

  const uniqueKeywords = [...new Set(allChunkKeywords)];

  // Collect ALL texts that need embeddings:
  // [0]: article summary
  // [1..N]: chunk contents
  // [N+1..M]: unique keywords
  const textsToEmbed: string[] = [
    articleSummary,
    ...chunks.map(c => c.content),
    ...uniqueKeywords,
  ];

  console.log(`[Embeddings] Batching ${textsToEmbed.length} texts (1 article + ${chunks.length} chunks + ${uniqueKeywords.length} keywords)`);

  const embeddings = await generateEmbeddingsBatched(textsToEmbed, (completed, total) => {
    console.log(`[Embeddings] ${completed}/${total}`);
  });

  // Extract embeddings by index
  const articleEmbedding = embeddings[0];
  const chunkEmbeddings = embeddings.slice(1, 1 + chunks.length);
  const keywordEmbeddings = embeddings.slice(1 + chunks.length);

  // Build keyword -> embedding map
  const keywordEmbeddingMap = new Map<string, number[]>();
  for (let i = 0; i < uniqueKeywords.length; i++) {
    keywordEmbeddingMap.set(uniqueKeywords[i], keywordEmbeddings[i]);
  }

  // Progress tracking
  const totalWork = 1 + chunks.length + 1;  // article + chunks + keyword bubbling
  let completed = 0;
  const report = (item: string) => {
    completed++;
    callbacks?.onProgress?.(item, completed, totalWork);
  };

  // Create article node
  const { data: articleNode, error: articleError } = await supabase
    .from("nodes")
    .insert({
      content: null,
      summary: articleSummary,
      content_hash: articleContentHash,
      embedding: articleEmbedding,
      node_type: "article" as NodeType,
      source_path: sourcePath,
      header_level: null,
      chunk_type: null,
      heading_context: null,
    })
    .select()
    .single();

  if (articleError) throw articleError;
  report(`Article: ${parsed.title}`);

  // Create chunk nodes
  const chunkNodeIds: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const contentHash = hash(chunk.content);

    const { data: chunkNode, error: chunkError } = await supabase
      .from("nodes")
      .insert({
        content: chunk.content,
        summary: null,
        content_hash: contentHash,
        embedding: chunkEmbeddings[i],
        node_type: "chunk" as NodeType,
        source_path: sourcePath,
        header_level: null,
        chunk_type: chunk.chunkType || null,
        heading_context: chunk.headingContext.length > 0 ? chunk.headingContext : null,
      })
      .select()
      .single();

    if (chunkError) throw chunkError;
    chunkNodeIds.push(chunkNode.id);

    // Create containment edge to article
    await supabase.from("containment_edges").upsert(
      {
        parent_id: articleNode.id,
        child_id: chunkNode.id,
        position: chunk.position,
      },
      { onConflict: "parent_id,child_id" }
    );

    // Store keywords for this chunk
    for (const keyword of chunk.keywords) {
      const embedding = keywordEmbeddingMap.get(keyword)!;
      await supabase.from("keywords").upsert(
        {
          keyword,
          embedding,
          embedding_256: truncateEmbedding(embedding, 256),
          node_id: chunkNode.id,
          node_type: "chunk",  // Denormalized for efficient filtering
        },
        { onConflict: "node_id,keyword" }
      );
    }

    report(`Chunk ${i + 1}/${chunks.length}: ${chunk.chunkType || "unlabeled"}`);
  }

  // Bubble keywords up to article level
  if (uniqueKeywords.length > 0) {
    // Use reduceKeywordsForArticle to get article-level keywords
    // Pass all chunks as "sections" for the reduction
    const chunkKeywordsList = chunks.map((chunk, i) => ({
      title: chunk.headingContext.join(" > ") || `Chunk ${i + 1}`,
      keywords: chunk.keywords,
    }));

    const articleKeywords = await reduceKeywordsForArticle(parsed.title, chunkKeywordsList);

    // Store article-level keywords
    for (const keyword of articleKeywords) {
      // Reuse embedding if we have it, otherwise it's a synthesized keyword
      let embedding = keywordEmbeddingMap.get(keyword);
      if (!embedding) {
        // Need to generate embedding for synthesized keyword
        const [newEmbedding] = await generateEmbeddingsBatched([keyword]);
        embedding = newEmbedding;
      }

      await supabase.from("keywords").upsert(
        {
          keyword,
          embedding,
          embedding_256: truncateEmbedding(embedding, 256),
          node_id: articleNode.id,
          node_type: "article",  // Denormalized for efficient filtering
        },
        { onConflict: "node_id,keyword" }
      );
    }

    console.log(`[Keywords] Bubbled ${articleKeywords.length} keywords to article level`);
  }

  report(`Keywords bubbled to article`);

  // Create backlink edges
  for (const linkText of parsed.backlinks) {
    const { data: targetNodes } = await supabase
      .from("nodes")
      .select("id")
      .eq("node_type", "article")
      .ilike("source_path", `%${linkText}.md`);

    if (targetNodes && targetNodes.length > 0) {
      await supabase.from("backlink_edges").upsert(
        {
          source_id: articleNode.id,
          target_id: targetNodes[0].id,
          link_text: linkText,
        },
        { onConflict: "source_id,target_id" }
      );
    }
  }

  return articleNode.id;
}
