import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock OpenAI module
// The mock function MUST be created inside the factory to avoid hoisting issues
vi.mock("openai", () => {
  const mockCreateFn = vi.fn();
  return {
    default: class MockOpenAI {
      embeddings = {
        create: mockCreateFn,
      };
    },
    __mockCreate: mockCreateFn,  // Export for test access
  };
});

// Now import after mocking
import {
  estimateTokens,
  truncateEmbedding,
  generateEmbedding,
  generateEmbeddings,
  generateEmbeddingsBatched,
  type EmbeddingContext,
} from "../embeddings";

// Import the mock for testing
// @ts-ignore - accessing internal mock export
import { __mockCreate as mockCreate } from "openai";

describe("estimateTokens", () => {
  it("estimates ~4 chars per token", () => {
    expect(estimateTokens("abcd")).toBe(1); // 4 chars = 1 token
    expect(estimateTokens("abcdefgh")).toBe(2); // 8 chars = 2 tokens
    expect(estimateTokens("Hello world")).toBe(3); // 11 chars = 3 tokens (ceil)
  });

  it("rounds up using Math.ceil", () => {
    expect(estimateTokens("a")).toBe(1); // 1 char = 0.25 tokens -> ceil = 1
    expect(estimateTokens("abc")).toBe(1); // 3 chars = 0.75 tokens -> ceil = 1
    expect(estimateTokens("abcde")).toBe(2); // 5 chars = 1.25 tokens -> ceil = 2
  });

  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("handles long text correctly", () => {
    const text = "a".repeat(1000); // 1000 chars
    expect(estimateTokens(text)).toBe(250); // 1000/4 = 250 tokens
  });
});

describe("truncateEmbedding", () => {
  it("truncates to specified dimensions", () => {
    const embedding = [0.1, 0.2, 0.3, 0.4, 0.5];
    const result = truncateEmbedding(embedding, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toBeDefined();
    expect(result[1]).toBeDefined();
    expect(result[2]).toBeDefined();
  });

  it("re-normalizes to unit length after truncation", () => {
    // Start with a normalized 5D vector
    const embedding = [0.4472, 0.4472, 0.4472, 0.4472, 0.4472]; // sqrt(5 * 0.2) ≈ 1
    const result = truncateEmbedding(embedding, 3);

    // Calculate magnitude
    const magnitude = Math.sqrt(result.reduce((sum, x) => sum + x * x, 0));
    expect(magnitude).toBeCloseTo(1.0, 10);
  });

  it("verifies magnitude approximately equals 1", () => {
    const embedding = [0.6, 0.8, 0.0, 0.0]; // Magnitude = 1.0
    const result = truncateEmbedding(embedding, 2); // Keep [0.6, 0.8]

    const magnitude = Math.sqrt(result.reduce((sum, x) => sum + x * x, 0));
    expect(magnitude).toBeCloseTo(1.0, 10);
  });

  it("handles zero vector gracefully", () => {
    const embedding = [0, 0, 0, 0];
    const result = truncateEmbedding(embedding, 2);

    expect(result).toEqual([0, 0]);
    expect(result).toHaveLength(2);
  });

  it("handles partial zero vectors", () => {
    const embedding = [0.6, 0.8, 0, 0, 0];
    const result = truncateEmbedding(embedding, 2);

    // [0.6, 0.8] is already normalized
    expect(result).toHaveLength(2);
    const magnitude = Math.sqrt(result.reduce((sum, x) => sum + x * x, 0));
    expect(magnitude).toBeCloseTo(1.0, 10);
  });

  it("preserves direction while normalizing", () => {
    const embedding = [3, 4, 5, 6]; // Not normalized
    const result = truncateEmbedding(embedding, 2);

    // Should keep ratio [3, 4] and normalize
    expect(result[0] / result[1]).toBeCloseTo(3 / 4, 10);

    const magnitude = Math.sqrt(result.reduce((sum, x) => sum + x * x, 0));
    expect(magnitude).toBeCloseTo(1.0, 10);
  });
});

describe("generateEmbedding", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default mock response
    mockCreate.mockResolvedValue({
      data: [{ embedding: Array(1536).fill(0.1) }],
    } as any);
  });

  it("calls OpenAI with correct model", async () => {
    await generateEmbedding("test text");

    expect(mockCreate).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: "test text",
    });
  });

  it("returns embedding array", async () => {
    const mockEmbedding = [0.1, 0.2, 0.3];
    mockCreate.mockResolvedValue({
      data: [{ embedding: mockEmbedding }],
    } as any);

    const result = await generateEmbedding("test");

    expect(result).toEqual(mockEmbedding);
  });

  it("logs context when provided - keyword type", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const context: EmbeddingContext = {
      type: "keyword",
      article: "My Article",
      keyword: "machine learning",
    };

    await generateEmbedding("test", context);

    expect(consoleSpy).toHaveBeenCalledWith(
      '[OpenAI] Embedding keyword "machine learning" in "My Article"'
    );

    consoleSpy.mockRestore();
  });

  it("logs context when provided - article-summary type", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const context: EmbeddingContext = {
      type: "article-summary",
      article: "My Article",
    };

    await generateEmbedding("test", context);

    expect(consoleSpy).toHaveBeenCalledWith(
      '[OpenAI] Embedding article summary: "My Article"'
    );

    consoleSpy.mockRestore();
  });

  it("logs context when provided - chunk type", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const context: EmbeddingContext = {
      type: "chunk",
      article: "My Article",
      position: 3,
    };

    await generateEmbedding("test", context);

    expect(consoleSpy).toHaveBeenCalledWith(
      '[OpenAI] Embedding chunk 3: "My Article"'
    );

    consoleSpy.mockRestore();
  });

  it("logs context when provided - chunk type without position", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const context: EmbeddingContext = {
      type: "chunk",
      article: "My Article",
    };

    await generateEmbedding("test", context);

    expect(consoleSpy).toHaveBeenCalledWith(
      '[OpenAI] Embedding chunk ?: "My Article"'
    );

    consoleSpy.mockRestore();
  });

  it("logs character count when no context provided", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    await generateEmbedding("hello world");

    expect(consoleSpy).toHaveBeenCalledWith("[OpenAI] Embedding 11 chars");

    consoleSpy.mockRestore();
  });
});

describe("generateEmbeddings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles empty array", async () => {
    const result = await generateEmbeddings([]);
    expect(result).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("batch calls API once for multiple texts", async () => {
    const mockEmbeddings = [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
      [0.7, 0.8, 0.9],
    ];

    mockCreate.mockResolvedValue({
      data: mockEmbeddings.map((embedding) => ({ embedding })),
    } as any);

    const texts = ["text1", "text2", "text3"];
    const result = await generateEmbeddings(texts);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledWith({
      model: "text-embedding-3-small",
      input: texts,
    });

    expect(result).toEqual(mockEmbeddings);
  });

  it("returns array of embeddings", async () => {
    const mockEmbeddings = [
      [0.1, 0.2],
      [0.3, 0.4],
    ];

    mockCreate.mockResolvedValue({
      data: mockEmbeddings.map((embedding) => ({ embedding })),
    } as any);

    const result = await generateEmbeddings(["text1", "text2"]);

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual([0.1, 0.2]);
    expect(result[1]).toEqual([0.3, 0.4]);
  });

  it("throws on empty string in input", async () => {
    await expect(generateEmbeddings(["hello", "", "world"])).rejects.toThrow(
      "generateEmbeddings: invalid input at index 1"
    );
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("throws on null/undefined in input", async () => {
    await expect(
      generateEmbeddings(["hello", null as any, "world"])
    ).rejects.toThrow("generateEmbeddings: invalid input at index 1");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("logs total characters", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    mockCreate.mockResolvedValue({
      data: [{ embedding: [0.1] }, { embedding: [0.2] }],
    } as any);

    await generateEmbeddings(["hello", "world"]);

    expect(consoleSpy).toHaveBeenCalledWith(
      "[OpenAI] Generating 2 embeddings for 10 chars total"
    );

    consoleSpy.mockRestore();
  });
});

describe("generateEmbeddingsBatched", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("handles empty array", async () => {
    const result = await generateEmbeddingsBatched([]);
    expect(result).toEqual([]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("single batch for small input (< 2048 items)", async () => {
    const texts = Array(100).fill("test");
    const mockEmbeddings = texts.map((_, i) => [i * 0.1, i * 0.2]);

    mockCreate.mockResolvedValue({
      data: mockEmbeddings.map((embedding) => ({ embedding })),
    } as any);

    const result = await generateEmbeddingsBatched(texts);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(100);
    expect(result).toEqual(mockEmbeddings);
  });

  it("batches to OPENAI_BATCH_SIZE (2048)", async () => {
    const texts = Array(3000).fill("test"); // Will require 2 batches

    // Mock responses for each batch
    let callCount = 0;
    mockCreate.mockImplementation((params: { input: string[] }) => {
      const batchSize = params.input.length;
      const embeddings = Array(batchSize)
        .fill(0)
        .map((_, i) => [callCount + i * 0.1]);
      callCount++;
      return Promise.resolve({
        data: embeddings.map((embedding) => ({ embedding })),
      });
    });

    const result = await generateEmbeddingsBatched(texts);

    expect(mockCreate).toHaveBeenCalledTimes(2);

    // First call should have 2048 items
    expect(mockCreate.mock.calls[0][0].input).toHaveLength(2048);

    // Second call should have remaining 952 items
    expect(mockCreate.mock.calls[1][0].input).toHaveLength(952);

    expect(result).toHaveLength(3000);
  });

  it("adds delay between batches (RATE_LIMIT_DELAY_MS=100ms)", async () => {
    const texts = Array(3000).fill("test"); // 2 batches

    const timestamps: number[] = [];
    mockCreate.mockImplementation(() => {
      timestamps.push(Date.now());
      return Promise.resolve({
        data: [{ embedding: [0.1] }],
      });
    });

    await generateEmbeddingsBatched(texts);

    expect(timestamps).toHaveLength(2);
    // Allow some tolerance for timing (at least 80ms)
    const delay = timestamps[1] - timestamps[0];
    expect(delay).toBeGreaterThanOrEqual(80);
  });

  it("calls onProgress correctly - single batch", async () => {
    const texts = Array(100).fill("test");
    const mockEmbeddings = texts.map(() => [0.1]);

    mockCreate.mockResolvedValue({
      data: mockEmbeddings.map((embedding) => ({ embedding })),
    } as any);

    const progressCalls: [number, number][] = [];
    const onProgress = (completed: number, total: number) => {
      progressCalls.push([completed, total]);
    };

    await generateEmbeddingsBatched(texts, onProgress);

    expect(progressCalls).toHaveLength(1);
    expect(progressCalls[0]).toEqual([100, 100]);
  });

  it("calls onProgress correctly - multiple batches", async () => {
    const texts = Array(3000).fill("test"); // 2 batches

    mockCreate.mockImplementation((params: { input: string[] }) => {
      const batchSize = params.input.length;
      const embeddings = Array(batchSize).fill([0.1]);
      return Promise.resolve({
        data: embeddings.map((embedding) => ({ embedding })),
      });
    });

    const progressCalls: [number, number][] = [];
    const onProgress = (completed: number, total: number) => {
      progressCalls.push([completed, total]);
    };

    await generateEmbeddingsBatched(texts, onProgress);

    expect(progressCalls).toHaveLength(2);
    expect(progressCalls[0]).toEqual([2048, 3000]); // After first batch
    expect(progressCalls[1]).toEqual([3000, 3000]); // After second batch
  });

  it("flattens results correctly across batches", async () => {
    const texts = Array(3000).fill("test");

    let batchNum = 0;
    mockCreate.mockImplementation((params: { input: string[] }) => {
      const batchSize = params.input.length;
      const baseValue = batchNum * 100;
      batchNum++;

      const embeddings = Array(batchSize)
        .fill(0)
        .map((_, i) => [baseValue + i]);

      return Promise.resolve({
        data: embeddings.map((embedding) => ({ embedding })),
      });
    });

    const result = await generateEmbeddingsBatched(texts);

    expect(result).toHaveLength(3000);

    // Verify first batch results
    expect(result[0][0]).toBe(0);
    expect(result[2047][0]).toBe(2047);

    // Verify second batch results (start at 100 + offset)
    expect(result[2048][0]).toBe(100);
    expect(result[2999][0]).toBe(100 + 951);
  });

  it("handles exactly BATCH_SIZE items (no delay)", async () => {
    const texts = Array(2048).fill("test");
    const mockEmbeddings = texts.map(() => [0.1]);

    mockCreate.mockResolvedValue({
      data: mockEmbeddings.map((embedding) => ({ embedding })),
    } as any);

    await generateEmbeddingsBatched(texts);

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("handles BATCH_SIZE + 1 items (triggers delay)", async () => {
    const texts = Array(2049).fill("test");

    mockCreate.mockImplementation((params: { input: string[] }) => {
      const batchSize = params.input.length;
      return Promise.resolve({
        data: Array(batchSize).fill({ embedding: [0.1] }),
      });
    });

    const result = await generateEmbeddingsBatched(texts);

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(2049);
  });
});
