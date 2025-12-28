/**
 * Test script for keyword reduction functions.
 * Validates that reduceKeywordsForSection and reduceKeywordsForArticle
 * work correctly with real data from the database.
 *
 * Run with: npm run script scripts/test-keyword-reduction.ts
 */
import { createServerClient } from "../src/lib/supabase";
import {
  reduceKeywordsForSection,
  reduceKeywordsForArticle,
  SectionKeywords,
} from "../src/lib/summarization";

const supabase = createServerClient();

async function main() {
  console.log("Testing keyword reduction functions...\n");

  // Find an article with sections that have paragraph-level keywords
  const { data: articles } = await supabase
    .from("nodes")
    .select("id, summary, source_path")
    .eq("node_type", "article")
    .limit(10);

  if (!articles?.length) {
    console.log("No articles found");
    return;
  }

  for (const article of articles) {
    // Get sections for this article
    const { data: sectionEdges } = await supabase
      .from("containment_edges")
      .select("child_id")
      .eq("parent_id", article.id);

    if (!sectionEdges || sectionEdges.length < 2) continue;

    const sectionIds = sectionEdges.map((e) => e.child_id);
    const { data: sections } = await supabase
      .from("nodes")
      .select("id, summary")
      .in("id", sectionIds)
      .eq("node_type", "section");

    if (!sections || sections.length < 2) continue;

    // Collect all paragraph keywords for this article's sections
    const sectionsWithKeywords: SectionKeywords[] = [];
    let totalParagraphKeywords = 0;

    for (const section of sections) {
      // Get paragraphs in this section
      const { data: paraEdges } = await supabase
        .from("containment_edges")
        .select("child_id")
        .eq("parent_id", section.id);

      if (!paraEdges) continue;

      const paraIds = paraEdges.map((e) => e.child_id);

      // Get keywords for all paragraphs
      const { data: keywords } = await supabase
        .from("keywords")
        .select("keyword")
        .in("node_id", paraIds);

      if (!keywords || keywords.length === 0) continue;

      const sectionKeywords = keywords.map((k) => k.keyword);
      totalParagraphKeywords += sectionKeywords.length;

      sectionsWithKeywords.push({
        title: section.summary?.slice(0, 80) || "Untitled",
        keywords: sectionKeywords,
      });
    }

    if (sectionsWithKeywords.length < 2 || totalParagraphKeywords < 10) continue;

    // Found a good article for testing!
    console.log(`${"=".repeat(60)}`);
    console.log(`ARTICLE: ${article.source_path}`);
    console.log(`Summary: ${article.summary?.slice(0, 100)}...`);
    console.log(`${"=".repeat(60)}`);

    console.log(`\n--- Paragraph-level keywords per section ---`);
    for (const s of sectionsWithKeywords) {
      console.log(`\n"${s.title}..."`);
      console.log(`  [${s.keywords.join(", ")}]`);
    }

    // Step 1: Test reduceKeywordsForSection on each section
    console.log(`\n--- Step 1: Testing reduceKeywordsForSection ---`);
    const reducedSections: SectionKeywords[] = [];
    let allPassed = true;

    for (const s of sectionsWithKeywords) {
      const reduced = await reduceKeywordsForSection(s.title, s.keywords);

      // Validate output
      if (!Array.isArray(reduced)) {
        console.error(`FAIL: Expected array, got ${typeof reduced}`);
        allPassed = false;
        continue;
      }

      if (reduced.length === 0 && s.keywords.length > 0) {
        console.error(`FAIL: Got 0 keywords from ${s.keywords.length} input keywords`);
        allPassed = false;
        continue;
      }

      if (reduced.length > 7) {
        console.error(`FAIL: Expected 3-7 keywords, got ${reduced.length}`);
        allPassed = false;
      }

      reducedSections.push({ title: s.title, keywords: reduced });
      console.log(`"${s.title.slice(0, 40)}..." -> [${reduced.join(", ")}]`);
    }

    // Step 2: Test reduceKeywordsForArticle
    console.log(`\n--- Step 2: Testing reduceKeywordsForArticle ---`);
    const articleTitle = article.source_path?.split("/").pop()?.replace(".md", "") || "Untitled";
    const articleKeywords = await reduceKeywordsForArticle(articleTitle, reducedSections);

    // Validate output
    if (!Array.isArray(articleKeywords)) {
      console.error(`FAIL: Expected array, got ${typeof articleKeywords}`);
      allPassed = false;
    } else if (articleKeywords.length === 0 && reducedSections.length > 0) {
      console.error(`FAIL: Got 0 keywords from ${reducedSections.length} sections`);
      allPassed = false;
    } else if (articleKeywords.length > 10) {
      console.error(`FAIL: Expected 5-10 keywords, got ${articleKeywords.length}`);
      allPassed = false;
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`FINAL ARTICLE KEYWORDS:`);
    console.log(`[${articleKeywords.join(", ")}]`);
    console.log(`${"=".repeat(60)}`);

    // Summary
    const uniqueInput = [...new Set(sectionsWithKeywords.flatMap((s) => s.keywords))];
    console.log(`\nSummary:`);
    console.log(`  Input: ${totalParagraphKeywords} paragraph keywords (${uniqueInput.length} unique)`);
    console.log(`  -> ${reducedSections.reduce((acc, s) => acc + s.keywords.length, 0)} section keywords`);
    console.log(`  -> ${articleKeywords.length} article keywords`);
    console.log(`\nTest result: ${allPassed ? "PASSED" : "FAILED"}`);

    process.exit(allPassed ? 0 : 1);
  }

  console.log("No suitable articles found for testing (need 2+ sections with 10+ keywords)");
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
