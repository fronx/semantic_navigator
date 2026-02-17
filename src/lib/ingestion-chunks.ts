import { createHash } from "crypto";
import { SupabaseClient } from "@supabase/supabase-js";
import { parseMarkdown } from "./parser";
import { generateEmbeddingsBatched, truncateEmbedding } from "./embeddings";
import { generateArticleSummary, reduceKeywordsForArticle } from "./summarization";
import { NodeType, AssociationType } from "./types";
import { findExistingNode } from "./node-identity";
import { chunkText, Chunk } from "./chunker";

interface SavedAssociation {
  project_id: string;
  association_type: AssociationType;
}

interface SavedBacklink {
  source_id: string;
  link_text: string;
  context: string | null;
}

interface DeleteResult {
  savedAssociations: SavedAssociation[];
  savedBacklinks: SavedBacklink[];
}

/**
 * Determines what action to take when importing an article.
 * Extracted as a pure function for easy unit testing.
 */
export type ImportAction = "create" | "skip" | "reimport";

export function determineImportAction(
  existingArticle: { content_hash: string } | null,
  newContentHash: string,
  forceReimport?: boolean
): ImportAction {
  if (!existingArticle) {
    return "create";
  }
  if (forceReimport) {
    return "reimport";
  }
  if (existingArticle.content_hash === newContentHash) {
    return "skip";
  }
  return "reimport";
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Inserts or updates a keyword in the canonical keywords table and creates
 * an occurrence linking it to a node.
 *
 * The new schema enforces uniqueness on keyword text, so this function:
 * 1. Upserts into `keywords` table (creating or reusing the canonical keyword)
 * 2. Inserts into `keyword_occurrences` (linking keyword to node)
 */
async function upsertKeywordOccurrence(
  supabase: SupabaseClient,
  keyword: string,
  embedding: number[],
  nodeId: string,
  nodeType: NodeType
): Promise<void> {
  // Step 1: Upsert canonical keyword (enforces uniqueness on keyword text)
  const { data: keywordRow, error: keywordError } = await supabase
    .from("keywords")
    .upsert(
      {
        keyword,
        embedding,
        embedding_256: truncateEmbedding(embedding, 256),
      },
      { onConflict: "keyword" }
    )
    .select()
    .single();

  if (keywordError) throw keywordError;

  // Step 2: Link keyword to node (may already exist, that's OK)
  const { error: occurrenceError } = await supabase
    .from("keyword_occurrences")
    .upsert(
      {
        keyword_id: keywordRow.id,
        node_id: nodeId,
        node_type: nodeType,
      },
      { onConflict: "keyword_id,node_id" }
    );

  if (occurrenceError) throw occurrenceError;
}

export interface ChunkIngestionCallbacks {
  onProgress?: (current: string, completed: number, total: number) => void;
  onError?: (error: Error, context: string) => void;
}

export interface ChunkIngestionOptions {
  forceReimport?: boolean;
}

// Delete an article and all its descendants (handles old section→paragraph hierarchy too)
// Returns saved project associations and incoming backlinks so they can be restored after reimport
async function deleteArticleWithChunks(
  supabase: SupabaseClient,
  articleId: string
): Promise<DeleteResult> {
  // Save project associations before deletion (so they can be restored)
  const { data: associations } = await supabase
    .from("project_associations")
    .select("project_id, association_type")
    .eq("target_id", articleId);

  const savedAssociations: SavedAssociation[] = (associations || []).map((a) => ({
    project_id: a.project_id,
    association_type: a.association_type as AssociationType,
  }));

  if (savedAssociations.length > 0) {
    console.log(`[Reimport] Saving ${savedAssociations.length} project associations for restoration`);
  }

  // Save incoming backlinks before deletion (so they can be restored)
  // These are backlinks FROM other articles TO this article
  const { data: backlinks } = await supabase
    .from("backlink_edges")
    .select("source_id, link_text, context")
    .eq("target_id", articleId);

  const savedBacklinks: SavedBacklink[] = (backlinks || []).map((b) => ({
    source_id: b.source_id,
    link_text: b.link_text,
    context: b.context,
  }));

  if (savedBacklinks.length > 0) {
    console.log(`[Reimport] Saving ${savedBacklinks.length} incoming backlinks for restoration`);
  }

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

  // Delete keyword occurrences for all nodes (keywords themselves are canonical and may be reused)
  await supabase.from("keyword_occurrences").delete().in("node_id", allNodeIds);

  // Delete containment edges
  await supabase.from("containment_edges").delete().in("parent_id", allNodeIds);
  await supabase.from("containment_edges").delete().in("child_id", allNodeIds);

  // Delete backlink edges (both incoming and outgoing)
  // Note: We saved incoming backlinks above so they can be restored
  await supabase.from("backlink_edges").delete().in("source_id", allNodeIds);
  await supabase.from("backlink_edges").delete().in("target_id", allNodeIds);

  // Note: project_associations for this target will be cascade-deleted via FK
  // We saved them above so they can be restored

  // Delete all nodes
  await supabase.from("nodes").delete().in("id", allNodeIds);

  console.log(`[Reimport] Deleted ${allNodeIds.length} nodes (article + descendants)`);

  return { savedAssociations, savedBacklinks };
}

// Restore project associations after article reimport
async function restoreProjectAssociations(
  supabase: SupabaseClient,
  newArticleId: string,
  associations: SavedAssociation[]
): Promise<void> {
  if (associations.length === 0) return;

  for (const assoc of associations) {
    await supabase.from("project_associations").insert({
      project_id: assoc.project_id,
      target_id: newArticleId,
      association_type: assoc.association_type,
    });
  }

  console.log(`[Reimport] Restored ${associations.length} project associations`);
}

// Restore incoming backlinks after article reimport
async function restoreBacklinks(
  supabase: SupabaseClient,
  newArticleId: string,
  backlinks: SavedBacklink[]
): Promise<void> {
  if (backlinks.length === 0) return;

  for (const backlink of backlinks) {
    const { error } = await supabase.from("backlink_edges").insert({
      source_id: backlink.source_id,
      target_id: newArticleId,
      link_text: backlink.link_text,
      context: backlink.context,
    });

    if (error) {
      console.warn(`[Backlinks] Failed to restore backlink from ${backlink.source_id}: ${error.message}`);
    }
  }

  console.log(`[Reimport] Restored ${backlinks.length} incoming backlinks`);
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

  // Determine what action to take
  const action = determineImportAction(
    existingArticle ? { content_hash: existingArticle.content_hash } : null,
    articleContentHash,
    options?.forceReimport
  );

  // Track data to restore after reimport
  let savedAssociations: SavedAssociation[] = [];
  let savedBacklinks: SavedBacklink[] = [];

  if (action === "skip") {
    console.log(`[Skip] Article already exists: "${parsed.title}"`);
    callbacks?.onProgress?.(`Article: ${parsed.title} (existing)`, 1, 1);
    return existingArticle!.id;
  }

  if (action === "reimport") {
    const reason = options?.forceReimport ? "force reimport" : "content changed";
    console.log(`[Reimport] Article "${parsed.title}" (${reason}), reimporting`);
    const deleteResult = await deleteArticleWithChunks(supabase, existingArticle!.id);
    savedAssociations = deleteResult.savedAssociations;
    savedBacklinks = deleteResult.savedBacklinks;
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
  // [0]: article summary text
  // [1..N]: chunk contents
  // [N+1..M]: unique keywords
  const summaryText = articleSummary.teaser ?? articleSummary.content ?? '';
  const textsToEmbed: string[] = [
    summaryText,
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
      summary: JSON.stringify(articleSummary),
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
      await upsertKeywordOccurrence(
        supabase,
        keyword,
        embedding,
        chunkNode.id,
        "chunk"
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

      await upsertKeywordOccurrence(
        supabase,
        keyword,
        embedding,
        articleNode.id,
        "article"
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

  // Restore project associations and incoming backlinks if this was a reimport
  await restoreProjectAssociations(supabase, articleNode.id, savedAssociations);
  await restoreBacklinks(supabase, articleNode.id, savedBacklinks);

  return articleNode.id;
}
