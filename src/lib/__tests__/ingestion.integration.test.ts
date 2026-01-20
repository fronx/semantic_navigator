/**
 * Integration tests for article ingestion with reimport behavior.
 *
 * These tests use real Supabase database operations but mock LLM and embedding calls
 * to avoid API costs and test flakiness.
 *
 * Test scenarios:
 * 1. New article import - Creates article and chunks in database
 * 2. Unchanged article skip - Same content returns existing ID, no DB modifications
 * 3. Changed article reimport - Different content triggers delete + reimport, new ID returned
 * 4. Project associations preserved - Associations survive reimport with new article ID
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServerClient } from "../supabase";
import { ingestArticleWithChunks } from "../ingestion-chunks";
import type { Chunk } from "../chunker";

// Mock the chunker module
vi.mock("../chunker", () => ({
  chunkText: vi.fn(),
}));

// Mock the summarization module
vi.mock("../summarization", () => ({
  generateArticleSummary: vi.fn(),
  reduceKeywordsForArticle: vi.fn(),
}));

// Mock the embeddings module
vi.mock("../embeddings", () => ({
  generateEmbeddingsBatched: vi.fn(),
  truncateEmbedding: vi.fn(),
}));

// Import mocked modules to set up return values
import { chunkText } from "../chunker";
import { generateArticleSummary, reduceKeywordsForArticle } from "../summarization";
import { generateEmbeddingsBatched, truncateEmbedding } from "../embeddings";

const mockedChunkText = vi.mocked(chunkText);
const mockedGenerateArticleSummary = vi.mocked(generateArticleSummary);
const mockedReduceKeywordsForArticle = vi.mocked(reduceKeywordsForArticle);
const mockedGenerateEmbeddingsBatched = vi.mocked(generateEmbeddingsBatched);
const mockedTruncateEmbedding = vi.mocked(truncateEmbedding);

// Generate a fake 1536-dimension embedding
function fakeEmbedding(seed: number): number[] {
  return Array.from({ length: 1536 }, (_, i) => Math.sin(seed + i) * 0.1);
}

// Generate a fake 256-dimension embedding
function fakeEmbedding256(seed: number): number[] {
  return Array.from({ length: 256 }, (_, i) => Math.sin(seed + i) * 0.1);
}

// Async generator helper for mocking chunkText
async function* mockChunkGenerator(chunks: Chunk[]): AsyncGenerator<Chunk> {
  for (const chunk of chunks) {
    yield chunk;
  }
}

describe("ingestion integration", { timeout: 30000 }, () => {
  const supabase = createServerClient();

  // Track created nodes for cleanup
  let createdNodeIds: string[] = [];
  let createdProjectIds: string[] = [];

  // Test-specific source path to avoid collisions
  const testSourcePath = `__test__/ingestion-test-${Date.now()}.md`;

  beforeEach(() => {
    vi.clearAllMocks();
    createdNodeIds = [];
    createdProjectIds = [];

    // Default mock implementations
    mockedTruncateEmbedding.mockImplementation((embedding, dims) =>
      embedding.slice(0, dims)
    );
  });

  afterEach(async () => {
    // Clean up test data in correct order (associations first, then nodes)
    if (createdProjectIds.length > 0) {
      await supabase
        .from("project_associations")
        .delete()
        .in("project_id", createdProjectIds);

      await supabase.from("nodes").delete().in("id", createdProjectIds);
    }

    if (createdNodeIds.length > 0) {
      // Delete keywords first (foreign key to nodes)
      await supabase.from("keywords").delete().in("node_id", createdNodeIds);

      // Delete containment edges
      await supabase
        .from("containment_edges")
        .delete()
        .in("parent_id", createdNodeIds);
      await supabase
        .from("containment_edges")
        .delete()
        .in("child_id", createdNodeIds);

      // Delete backlink edges
      await supabase
        .from("backlink_edges")
        .delete()
        .in("source_id", createdNodeIds);
      await supabase
        .from("backlink_edges")
        .delete()
        .in("target_id", createdNodeIds);

      // Finally delete nodes
      await supabase.from("nodes").delete().in("id", createdNodeIds);
    }

    // Also clean up by source path in case we missed any
    const { data: staleNodes } = await supabase
      .from("nodes")
      .select("id")
      .like("source_path", "__test__%");

    if (staleNodes && staleNodes.length > 0) {
      const staleIds = staleNodes.map((n) => n.id);
      await supabase.from("keywords").delete().in("node_id", staleIds);
      await supabase.from("containment_edges").delete().in("parent_id", staleIds);
      await supabase.from("containment_edges").delete().in("child_id", staleIds);
      await supabase.from("backlink_edges").delete().in("source_id", staleIds);
      await supabase.from("backlink_edges").delete().in("target_id", staleIds);
      await supabase.from("nodes").delete().in("id", staleIds);
    }
  });

  function setupMocksForContent(content: string, chunkCount: number = 1) {
    const chunks: Chunk[] = Array.from({ length: chunkCount }, (_, i) => ({
      content: `Chunk ${i + 1} of test content`,
      position: i,
      headingContext: ["Test Section"],
      chunkType: "test-chunk",
      keywords: [`keyword-${i + 1}`],
    }));

    mockedChunkText.mockReturnValue(mockChunkGenerator(chunks));
    mockedGenerateArticleSummary.mockResolvedValue("Test article summary");
    mockedReduceKeywordsForArticle.mockResolvedValue(["test-keyword"]);

    // Generate embeddings: 1 article + N chunks + (N + 1) keywords
    const embeddingCount = 1 + chunkCount + chunkCount + 1; // article + chunks + chunk keywords + article keyword
    mockedGenerateEmbeddingsBatched.mockResolvedValue(
      Array.from({ length: embeddingCount }, (_, i) => fakeEmbedding(i))
    );
  }

  it("creates a new article and chunks in the database", async () => {
    const content = `# Test Article

This is test content for a new article.

## Section One

Some paragraph content here.
`;

    setupMocksForContent(content, 2);

    const articleId = await ingestArticleWithChunks(
      supabase,
      testSourcePath,
      content
    );

    createdNodeIds.push(articleId);

    // Verify article was created
    const { data: article } = await supabase
      .from("nodes")
      .select("*")
      .eq("id", articleId)
      .single();

    expect(article).toBeTruthy();
    expect(article!.node_type).toBe("article");
    expect(article!.source_path).toBe(testSourcePath);
    expect(article!.summary).toBe("Test article summary");
    expect(article!.content_hash).toBeTruthy();

    // Verify chunks were created
    const { data: edges } = await supabase
      .from("containment_edges")
      .select("child_id")
      .eq("parent_id", articleId);

    expect(edges).toHaveLength(2);

    // Track chunk IDs for cleanup
    for (const edge of edges!) {
      createdNodeIds.push(edge.child_id);
    }

    // Verify keywords were created
    const { data: keywords } = await supabase
      .from("keywords")
      .select("keyword, node_type")
      .eq("node_id", articleId);

    expect(keywords).toBeTruthy();
    expect(keywords!.some((k) => k.node_type === "article")).toBe(true);
  });

  it("skips unchanged article and returns existing ID", async () => {
    const content = `# Unchanged Test

Content that won't change.
`;

    setupMocksForContent(content, 1);

    // First import
    const firstId = await ingestArticleWithChunks(
      supabase,
      testSourcePath,
      content
    );
    createdNodeIds.push(firstId);

    // Get chunk IDs for cleanup
    const { data: edges } = await supabase
      .from("containment_edges")
      .select("child_id")
      .eq("parent_id", firstId);
    for (const edge of edges!) {
      createdNodeIds.push(edge.child_id);
    }

    // Record the article's updated_at timestamp
    const { data: beforeArticle } = await supabase
      .from("nodes")
      .select("updated_at")
      .eq("id", firstId)
      .single();

    // Clear mocks to verify they're not called again
    vi.clearAllMocks();
    setupMocksForContent(content, 1);

    // Second import with same content
    const secondId = await ingestArticleWithChunks(
      supabase,
      testSourcePath,
      content
    );

    // Should return same ID
    expect(secondId).toBe(firstId);

    // Verify no LLM calls were made (chunker should not be called for skip)
    expect(mockedChunkText).not.toHaveBeenCalled();
    expect(mockedGenerateArticleSummary).not.toHaveBeenCalled();

    // Verify article was not modified
    const { data: afterArticle } = await supabase
      .from("nodes")
      .select("updated_at")
      .eq("id", firstId)
      .single();

    expect(afterArticle!.updated_at).toBe(beforeArticle!.updated_at);
  });

  it("reimports article when content changes, returning new ID", async () => {
    const originalContent = `# Original Article

Original content here.
`;

    const updatedContent = `# Original Article

Updated content with new information.

## New Section

Additional content.
`;

    setupMocksForContent(originalContent, 1);

    // First import
    const firstId = await ingestArticleWithChunks(
      supabase,
      testSourcePath,
      originalContent
    );

    // Get original chunk IDs
    const { data: originalEdges } = await supabase
      .from("containment_edges")
      .select("child_id")
      .eq("parent_id", firstId);

    // Setup mocks for updated content
    vi.clearAllMocks();
    setupMocksForContent(updatedContent, 2);

    // Second import with different content
    const secondId = await ingestArticleWithChunks(
      supabase,
      testSourcePath,
      updatedContent
    );

    // Track new ID for cleanup
    createdNodeIds.push(secondId);

    // Get new chunk IDs for cleanup
    const { data: newEdges } = await supabase
      .from("containment_edges")
      .select("child_id")
      .eq("parent_id", secondId);
    for (const edge of newEdges!) {
      createdNodeIds.push(edge.child_id);
    }

    // Should return different ID
    expect(secondId).not.toBe(firstId);

    // Verify old article was deleted
    const { data: oldArticle } = await supabase
      .from("nodes")
      .select("id")
      .eq("id", firstId)
      .single();

    expect(oldArticle).toBeNull();

    // Verify old chunks were deleted
    for (const edge of originalEdges!) {
      const { data: oldChunk } = await supabase
        .from("nodes")
        .select("id")
        .eq("id", edge.child_id)
        .single();

      expect(oldChunk).toBeNull();
    }

    // Verify new article exists
    const { data: newArticle } = await supabase
      .from("nodes")
      .select("*")
      .eq("id", secondId)
      .single();

    expect(newArticle).toBeTruthy();
    expect(newArticle!.source_path).toBe(testSourcePath);

    // Verify LLM was called for new content
    expect(mockedChunkText).toHaveBeenCalled();
    expect(mockedGenerateArticleSummary).toHaveBeenCalled();
  });

  it("preserves project associations after reimport", async () => {
    const originalContent = `# Project Article

Article that belongs to a project.
`;

    const updatedContent = `# Project Article

Updated article content.
`;

    setupMocksForContent(originalContent, 1);

    // First import
    const firstId = await ingestArticleWithChunks(
      supabase,
      testSourcePath,
      originalContent
    );

    // Get chunk IDs
    const { data: edges } = await supabase
      .from("containment_edges")
      .select("child_id")
      .eq("parent_id", firstId);

    // Create a test project
    const { data: project } = await supabase
      .from("nodes")
      .insert({
        node_type: "project",
        title: `Test Project ${Date.now()}`,
        content: "Test project description",
        content_hash: "test-project-hash",
        provenance: "user",
      })
      .select()
      .single();

    createdProjectIds.push(project!.id);

    // Associate article with project
    await supabase.from("project_associations").insert({
      project_id: project!.id,
      target_id: firstId,
      association_type: "contains",
    });

    // Verify association exists
    const { data: beforeAssoc } = await supabase
      .from("project_associations")
      .select("*")
      .eq("project_id", project!.id)
      .eq("target_id", firstId)
      .single();

    expect(beforeAssoc).toBeTruthy();

    // Setup mocks for updated content
    vi.clearAllMocks();
    setupMocksForContent(updatedContent, 1);

    // Reimport with different content
    const secondId = await ingestArticleWithChunks(
      supabase,
      testSourcePath,
      updatedContent
    );

    // Track new ID for cleanup
    createdNodeIds.push(secondId);

    // Get new chunk IDs for cleanup
    const { data: newEdges } = await supabase
      .from("containment_edges")
      .select("child_id")
      .eq("parent_id", secondId);
    for (const edge of newEdges!) {
      createdNodeIds.push(edge.child_id);
    }

    // Verify new article ID is different
    expect(secondId).not.toBe(firstId);

    // Verify project association was preserved with new article ID
    const { data: afterAssoc } = await supabase
      .from("project_associations")
      .select("*")
      .eq("project_id", project!.id)
      .eq("target_id", secondId)
      .single();

    expect(afterAssoc).toBeTruthy();
    expect(afterAssoc!.association_type).toBe("contains");

    // Verify old association was removed (since old article was deleted)
    const { data: oldAssoc } = await supabase
      .from("project_associations")
      .select("*")
      .eq("project_id", project!.id)
      .eq("target_id", firstId)
      .single();

    expect(oldAssoc).toBeNull();
  });

  it("repairs incoming backlinks when target article is reimported", async () => {
    // Create two test files with unique paths
    const testPathA = `__test__/A-${Date.now()}.md`;
    const testPathB = `__test__/B-${Date.now()}.md`;

    const contentA = `# Article A

This is article A.
`;

    const contentB = `# Article B

This is article B with a link to [[A-${Date.now()}]].
`;

    setupMocksForContent(contentA, 1);

    // Import article A
    const articleAId = await ingestArticleWithChunks(supabase, testPathA, contentA);
    createdNodeIds.push(articleAId);

    // Get A's chunk IDs for cleanup
    const { data: edgesA } = await supabase
      .from("containment_edges")
      .select("child_id")
      .eq("parent_id", articleAId);
    for (const edge of edgesA!) {
      createdNodeIds.push(edge.child_id);
    }

    vi.clearAllMocks();
    setupMocksForContent(contentB, 1);

    // Import article B
    const articleBId = await ingestArticleWithChunks(supabase, testPathB, contentB);
    createdNodeIds.push(articleBId);

    // Get B's chunk IDs for cleanup
    const { data: edgesB } = await supabase
      .from("containment_edges")
      .select("child_id")
      .eq("parent_id", articleBId);
    for (const edge of edgesB!) {
      createdNodeIds.push(edge.child_id);
    }

    // Extract filename without extension from testPathA
    const filenameA = testPathA.split("/").pop()?.replace(/\.md$/, "")!;

    // Manually create a backlink edge from B to A (simulating B having [[A]] link)
    await supabase.from("backlink_edges").insert({
      source_id: articleBId,
      target_id: articleAId,
      link_text: filenameA,
    });

    // Verify backlink exists
    const { data: beforeBacklink } = await supabase
      .from("backlink_edges")
      .select("*")
      .eq("source_id", articleBId)
      .eq("target_id", articleAId)
      .single();

    expect(beforeBacklink).toBeTruthy();
    expect(beforeBacklink!.link_text).toBe(filenameA);

    // Reimport article A with changed content
    const updatedContentA = `# Article A

This is updated article A with new content.
`;

    vi.clearAllMocks();
    setupMocksForContent(updatedContentA, 1);

    const newArticleAId = await ingestArticleWithChunks(
      supabase,
      testPathA,
      updatedContentA
    );

    // Track new ID for cleanup
    createdNodeIds.push(newArticleAId);

    // Get new chunk IDs for cleanup
    const { data: newEdgesA } = await supabase
      .from("containment_edges")
      .select("child_id")
      .eq("parent_id", newArticleAId);
    for (const edge of newEdgesA!) {
      createdNodeIds.push(edge.child_id);
    }

    // Verify article A was reimported with new ID
    expect(newArticleAId).not.toBe(articleAId);

    // Verify the backlink from B now points to the NEW A article
    const { data: afterBacklink } = await supabase
      .from("backlink_edges")
      .select("*")
      .eq("source_id", articleBId)
      .eq("link_text", filenameA)
      .single();

    expect(afterBacklink).toBeTruthy();
    expect(afterBacklink!.target_id).toBe(newArticleAId);
    expect(afterBacklink!.target_id).not.toBe(articleAId);
  });
});
