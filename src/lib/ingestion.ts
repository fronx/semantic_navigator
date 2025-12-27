import { createHash } from "crypto";
import { SupabaseClient } from "@supabase/supabase-js";
import { parseMarkdown, flattenSections } from "./parser";
import { generateEmbedding, estimateTokens } from "./embeddings";
import { generateSummary, generateArticleSummary } from "./summarization";
import { Node, NodeType } from "./types";

const PARAGRAPH_TOKEN_THRESHOLD = 1000;

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export interface IngestionCallbacks {
  onProgress?: (current: string, completed: number, total: number) => void;
  onError?: (error: Error, context: string) => void;
}

export async function ingestArticle(
  supabase: SupabaseClient,
  sourcePath: string,
  content: string,
  callbacks?: IngestionCallbacks
): Promise<string> {
  const filename = sourcePath.split("/").pop() || sourcePath;
  const parsed = parseMarkdown(content, filename);
  const flatSections = flattenSections(parsed.sections);

  // Calculate total work: 1 article + sections + paragraphs
  let totalParagraphs = 0;
  for (const section of flatSections) {
    totalParagraphs += section.paragraphs.length;
  }
  const totalWork = 1 + flatSections.length + totalParagraphs;
  let completed = 0;

  const report = (item: string) => {
    completed++;
    callbacks?.onProgress?.(item, completed, totalWork);
  };

  // 1. Create article node
  const articleSummary = await generateArticleSummary(
    parsed.title,
    parsed.content
  );
  const articleEmbedding = await generateEmbedding(articleSummary);

  const { data: articleNode, error: articleError } = await supabase
    .from("nodes")
    .insert({
      content: parsed.content,
      summary: articleSummary,
      content_hash: hash(parsed.content),
      embedding: articleEmbedding,
      node_type: "article" as NodeType,
      source_path: sourcePath,
      header_level: null,
    })
    .select()
    .single();

  if (articleError) throw articleError;
  report(`Article: ${parsed.title}`);

  // Map to track section nodes for parent-child relationships
  const sectionNodes: Map<string, Node> = new Map();

  // 2. Create section nodes
  for (let i = 0; i < flatSections.length; i++) {
    const section = flatSections[i];
    const sectionContent = section.content || section.title;

    const summary = await generateSummary(sectionContent, {
      articleTitle: parsed.title,
      sectionPath: section.path,
    });
    const embedding = await generateEmbedding(summary);

    const { data: sectionNode, error: sectionError } = await supabase
      .from("nodes")
      .insert({
        content: sectionContent,
        summary,
        content_hash: hash(sectionContent),
        embedding,
        node_type: "section" as NodeType,
        source_path: sourcePath,
        header_level: section.level,
      })
      .select()
      .single();

    if (sectionError) throw sectionError;
    sectionNodes.set(section.path.join("/"), sectionNode);
    report(`Section: ${section.title}`);

    // Create containment edge to parent
    const parentPath = section.path.slice(0, -1).join("/");
    const parentId = parentPath
      ? sectionNodes.get(parentPath)?.id
      : articleNode.id;

    if (parentId) {
      await supabase.from("containment_edges").insert({
        parent_id: parentId,
        child_id: sectionNode.id,
        position: i,
      });
    }

    // 3. Create paragraph nodes for this section
    for (let j = 0; j < section.paragraphs.length; j++) {
      const paragraph = section.paragraphs[j];
      const tokens = estimateTokens(paragraph);

      let paragraphSummary: string | null = null;
      let paragraphEmbedding: number[];

      if (tokens >= PARAGRAPH_TOKEN_THRESHOLD) {
        paragraphSummary = await generateSummary(paragraph, {
          articleTitle: parsed.title,
          sectionPath: section.path,
        });
        paragraphEmbedding = await generateEmbedding(paragraphSummary);
      } else {
        paragraphEmbedding = await generateEmbedding(paragraph);
      }

      const { data: paragraphNode, error: paragraphError } = await supabase
        .from("nodes")
        .insert({
          content: paragraph,
          summary: paragraphSummary,
          content_hash: hash(paragraph),
          embedding: paragraphEmbedding,
          node_type: "paragraph" as NodeType,
          source_path: sourcePath,
          header_level: null,
        })
        .select()
        .single();

      if (paragraphError) throw paragraphError;

      await supabase.from("containment_edges").insert({
        parent_id: sectionNode.id,
        child_id: paragraphNode.id,
        position: j,
      });

      report(`Paragraph ${j + 1}/${section.paragraphs.length}`);
    }
  }

  // 4. Create backlink edges (resolve targets later when all articles imported)
  // For now, store as pending backlinks that can be resolved in a second pass
  for (const linkText of parsed.backlinks) {
    // Find target article by name
    const { data: targetNodes } = await supabase
      .from("nodes")
      .select("id")
      .eq("node_type", "article")
      .ilike("source_path", `%${linkText}.md`);

    if (targetNodes && targetNodes.length > 0) {
      await supabase.from("backlink_edges").insert({
        source_id: articleNode.id,
        target_id: targetNodes[0].id,
        link_text: linkText,
      });
    }
  }

  return articleNode.id;
}
