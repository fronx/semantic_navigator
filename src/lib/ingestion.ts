import { createHash } from "crypto";
import { SupabaseClient } from "@supabase/supabase-js";
import { parseMarkdown, flattenSections } from "./parser";
import { generateEmbedding, estimateTokens, truncateEmbedding } from "./embeddings";
import {
  generateSummary,
  generateArticleSummary,
  extractKeywords,
  reduceKeywordsForSection,
  reduceKeywordsForArticle,
  SectionKeywords,
} from "./summarization";
import { Node, NodeType } from "./types";
import { findExistingNode } from "./node-identity";

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
  const articleContentHash = hash(parsed.content);

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

  // 1. Check if article already exists for this source_path
  const existingArticle = await findExistingNode(supabase, "article", {
    source_path: sourcePath,
  });

  let articleNode: Node;

  if (existingArticle) {
    if (existingArticle.content_hash === articleContentHash) {
      // Article exists with same content - reuse it
      articleNode = existingArticle;
      console.log(`[Skip] Article already exists: "${parsed.title}"`);
      report(`Article: ${parsed.title} (existing)`);
    } else {
      // Content changed - for now, skip with warning
      // TODO: Handle content updates (delete old + recreate, or update in place)
      console.warn(`[Import] Article "${parsed.title}" content changed, skipping (not implemented)`);
      return existingArticle.id;
    }
  } else {
    // Create new article node
    const articleSummary = await generateArticleSummary(
      parsed.title,
      parsed.content
    );
    const articleEmbedding = await generateEmbedding(articleSummary, {
      type: "article-summary",
      article: parsed.title,
    });

    const { data: newArticle, error: articleError } = await supabase
      .from("nodes")
      .insert({
        content: null,  // articles only use summary
        summary: articleSummary,
        content_hash: articleContentHash,
        embedding: articleEmbedding,
        node_type: "article" as NodeType,
        source_path: sourcePath,
        header_level: null,
      })
      .select()
      .single();

    if (articleError) throw articleError;
    articleNode = newArticle;
    report(`Article: ${parsed.title}`);
  }

  // Map to track section nodes for parent-child relationships
  const sectionNodes: Map<string, Node> = new Map();

  // 2. Create or reuse section nodes
  for (let i = 0; i < flatSections.length; i++) {
    const section = flatSections[i];
    const sectionContent = section.content || section.title;
    const sectionContentHash = hash(sectionContent);

    // Check if section already exists for this source_path + content_hash
    const existingSection = await findExistingNode(supabase, "section", {
      source_path: sourcePath,
      content_hash: sectionContentHash,
    });

    let sectionNode: Node;

    if (existingSection) {
      // Reuse existing section
      sectionNode = existingSection;
      console.log(`[Skip] Section already exists: "${parsed.title}" > ${section.title}`);
      report(`Section: ${section.title} (existing)`);
    } else {
      // Create new section
      const summary = await generateSummary(sectionContent, {
        articleTitle: parsed.title,
        sectionPath: section.path,
      });
      const embedding = await generateEmbedding(summary, {
        type: "section-summary",
        article: parsed.title,
        section: section.path.join(" > "),
      });

      const { data: newSection, error: sectionError } = await supabase
        .from("nodes")
        .insert({
          content: null,  // sections only use summary
          summary,
          content_hash: sectionContentHash,
          embedding,
          node_type: "section" as NodeType,
          source_path: sourcePath,
          header_level: section.level,
        })
        .select()
        .single();

      if (sectionError) throw sectionError;
      sectionNode = newSection;
      report(`Section: ${section.title}`);
    }

    sectionNodes.set(section.path.join("/"), sectionNode);

    // Create containment edge to parent (ignore if already exists)
    const parentPath = section.path.slice(0, -1).join("/");
    const parentId = parentPath
      ? sectionNodes.get(parentPath)?.id
      : articleNode.id;

    if (parentId) {
      await supabase.from("containment_edges")
        .upsert({
          parent_id: parentId,
          child_id: sectionNode.id,
          position: i,
        }, { onConflict: "parent_id,child_id" });
    }

    // 3. Create paragraph nodes for this section
    for (let j = 0; j < section.paragraphs.length; j++) {
      const paragraph = section.paragraphs[j];
      const contentHash = hash(paragraph);

      // Check if paragraph already exists (scoped to this article)
      const existingParagraph = await findExistingNode(supabase, "paragraph", {
        source_path: sourcePath,
        content_hash: contentHash,
      });

      let paragraphNodeId: string;

      if (existingParagraph) {
        // Reuse existing node
        paragraphNodeId = existingParagraph.id;
        console.log(`[Skip] Paragraph already exists: "${parsed.title}" > ${section.title} > para ${j + 1}`);
      } else {
        // Create new node
        const tokens = estimateTokens(paragraph);
        let paragraphSummary: string | null = null;
        let paragraphEmbedding: number[];

        const sectionLabel = section.path.join(" > ");
        if (tokens >= PARAGRAPH_TOKEN_THRESHOLD) {
          paragraphSummary = await generateSummary(paragraph, {
            articleTitle: parsed.title,
            sectionPath: section.path,
          });
          paragraphEmbedding = await generateEmbedding(paragraphSummary, {
            type: "paragraph-summary",
            article: parsed.title,
            section: sectionLabel,
          });
        } else {
          paragraphEmbedding = await generateEmbedding(paragraph, {
            type: "paragraph",
            article: parsed.title,
            section: sectionLabel,
          });
        }

        const { data: paragraphNode, error: paragraphError } = await supabase
          .from("nodes")
          .insert({
            content: paragraph,
            summary: paragraphSummary,
            content_hash: contentHash,
            embedding: paragraphEmbedding,
            node_type: "paragraph" as NodeType,
            source_path: sourcePath,
            header_level: null,
          })
          .select()
          .single();

        if (paragraphError) throw paragraphError;
        paragraphNodeId = paragraphNode.id;
      }

      // Create containment edge (upsert to handle existing)
      await supabase.from("containment_edges")
        .upsert({
          parent_id: sectionNode.id,
          child_id: paragraphNodeId,
          position: j,
        }, { onConflict: "parent_id,child_id" });

      // Check if keywords already exist for this node
      const { count: existingKeywordCount } = await supabase
        .from("keywords")
        .select("*", { count: "exact", head: true })
        .eq("node_id", paragraphNodeId);

      if (existingKeywordCount) {
        console.log(`[Skip] Keywords already exist: "${parsed.title}" > ${section.title} > para ${j + 1}`);
      } else {
        // Extract and store keywords
        const keywords = await extractKeywords(paragraph, {
          articleTitle: parsed.title,
          sectionPath: section.path,
        });

        for (const keyword of keywords) {
          const keywordEmbedding = await generateEmbedding(keyword, {
            type: "keyword",
            article: parsed.title,
            section: section.path.join(" > "),
            keyword,
          });
          await supabase.from("keywords").insert({
            keyword,
            embedding: keywordEmbedding,
            embedding_256: truncateEmbedding(keywordEmbedding, 256),
            node_id: paragraphNodeId,
          });
        }
      }

      report(`Paragraph ${j + 1}/${section.paragraphs.length}`);
    }

    // 3b. Bubble keywords up to section level
    const { count: existingSectionKeywords } = await supabase
      .from("keywords")
      .select("*", { count: "exact", head: true })
      .eq("node_id", sectionNode.id);

    if (!existingSectionKeywords) {
      // Get all paragraph IDs for this section
      const { data: sectionParaEdges } = await supabase
        .from("containment_edges")
        .select("child_id")
        .eq("parent_id", sectionNode.id);

      if (sectionParaEdges && sectionParaEdges.length > 0) {
        const paraIds = sectionParaEdges.map((e) => e.child_id);

        // Get all keywords for these paragraphs
        const { data: paraKeywords } = await supabase
          .from("keywords")
          .select("keyword")
          .in("node_id", paraIds);

        if (paraKeywords && paraKeywords.length > 0) {
          const keywordList = paraKeywords.map((k) => k.keyword);
          const sectionTitle = sectionNode.summary || section.title;
          const reducedKeywords = await reduceKeywordsForSection(sectionTitle, keywordList);

          for (const keyword of reducedKeywords) {
            const keywordEmbedding = await generateEmbedding(keyword, {
              type: "keyword",
              article: parsed.title,
              section: section.path.join(" > "),
              keyword,
            });
            await supabase.from("keywords").insert({
              keyword,
              embedding: keywordEmbedding,
              embedding_256: truncateEmbedding(keywordEmbedding, 256),
              node_id: sectionNode.id,
            });
          }
        }
      }
    } else {
      console.log(`[Skip] Section keywords already exist: "${parsed.title}" > ${section.title}`);
    }
  }

  // 4. Bubble keywords up to article level
  const { count: existingArticleKeywords } = await supabase
    .from("keywords")
    .select("*", { count: "exact", head: true })
    .eq("node_id", articleNode.id);

  if (!existingArticleKeywords) {
    // Gather section keywords
    const sectionKeywordsList: SectionKeywords[] = [];

    for (const [path, sectionNode] of sectionNodes) {
      const { data: sectionKws } = await supabase
        .from("keywords")
        .select("keyword")
        .eq("node_id", sectionNode.id);

      if (sectionKws && sectionKws.length > 0) {
        sectionKeywordsList.push({
          title: sectionNode.summary || path,
          keywords: sectionKws.map((k) => k.keyword),
        });
      }
    }

    if (sectionKeywordsList.length > 0) {
      const reducedKeywords = await reduceKeywordsForArticle(parsed.title, sectionKeywordsList);

      for (const keyword of reducedKeywords) {
        const keywordEmbedding = await generateEmbedding(keyword, {
          type: "keyword",
          article: parsed.title,
          keyword,
        });
        await supabase.from("keywords").insert({
          keyword,
          embedding: keywordEmbedding,
          embedding_256: truncateEmbedding(keywordEmbedding, 256),
          node_id: articleNode.id,
        });
      }
    }
  } else {
    console.log(`[Skip] Article keywords already exist: "${parsed.title}"`);
  }

  // 5. Create backlink edges (resolve targets later when all articles imported)
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
