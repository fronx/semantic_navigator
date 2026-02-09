import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Create mock function that will be shared across all tests
// We need to declare it outside so tests can access it
const mockCreateFn = vi.fn();

// Mock the Anthropic SDK before imports
vi.mock("@anthropic-ai/sdk", () => {
  // Use a getter to access the mock function
  const MockAnthropic = class {
    get messages() {
      return {
        create: mockCreateFn,
      };
    }
  };

  return {
    default: MockAnthropic,
  };
});

import {
  isLLMAvailable,
  extractJsonFromResponse,
  parseJsonArray,
  generateClusterLabels,
  refineClusterLabels,
  type RefinementRequest,
} from "../llm";

// Export for use in tests
const mockCreate = mockCreateFn;

describe("isLLMAvailable", () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
    // Force module reload to pick up env changes
    vi.resetModules();
  });

  it("returns true when ANTHROPIC_API_KEY is set and valid", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    const { isLLMAvailable } = await import("../llm");
    expect(isLLMAvailable()).toBe(true);
  });

  it("returns false when ANTHROPIC_API_KEY is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const { isLLMAvailable } = await import("../llm");
    expect(isLLMAvailable()).toBe(false);
  });

  it("returns false when ANTHROPIC_API_KEY is empty string", async () => {
    process.env.ANTHROPIC_API_KEY = "";
    const { isLLMAvailable } = await import("../llm");
    expect(isLLMAvailable()).toBe(false);
  });

  it("returns false when ANTHROPIC_API_KEY is whitespace only", async () => {
    process.env.ANTHROPIC_API_KEY = "   ";
    const { isLLMAvailable } = await import("../llm");
    expect(isLLMAvailable()).toBe(false);
  });

  it("returns false when ANTHROPIC_API_KEY is commented out with #", async () => {
    process.env.ANTHROPIC_API_KEY = "#sk-test-key";
    const { isLLMAvailable } = await import("../llm");
    expect(isLLMAvailable()).toBe(false);
  });
});

describe("extractJsonFromResponse", () => {
  it("extracts JSON from markdown code block with json language tag", () => {
    const response = '```json\n{"key": "value"}\n```';
    expect(extractJsonFromResponse(response)).toBe('{"key": "value"}');
  });

  it("extracts JSON from markdown code block without language tag", () => {
    const response = '```\n{"key": "value"}\n```';
    expect(extractJsonFromResponse(response)).toBe('{"key": "value"}');
  });

  it("finds JSON object in plain text", () => {
    const response = 'Here is the result: {"key": "value"} - done';
    expect(extractJsonFromResponse(response)).toBe('{"key": "value"}');
  });

  it("finds JSON array in plain text", () => {
    const response = 'The keywords are: ["keyword1", "keyword2"]';
    expect(extractJsonFromResponse(response)).toBe('["keyword1", "keyword2"]');
  });

  it("handles multiple JSON objects by extracting from first to last brace", () => {
    const response = '{"first": 1} some text {"second": 2}';
    expect(extractJsonFromResponse(response)).toBe(
      '{"first": 1} some text {"second": 2}'
    );
  });

  it("returns trimmed input if no JSON found", () => {
    const response = "  Just plain text with no JSON  ";
    expect(extractJsonFromResponse(response)).toBe("Just plain text with no JSON");
  });

  it("handles nested objects correctly", () => {
    const response = '{"outer": {"inner": "value"}}';
    expect(extractJsonFromResponse(response)).toBe('{"outer": {"inner": "value"}}');
  });

  it("handles nested arrays correctly", () => {
    const response = '[["item1", "item2"], ["item3"]]';
    expect(extractJsonFromResponse(response)).toBe('[["item1", "item2"], ["item3"]]');
  });

  it("trims whitespace from extracted code blocks", () => {
    const response = "```json\n\n  {\"key\": \"value\"}  \n\n```";
    expect(extractJsonFromResponse(response)).toBe('{"key": "value"}');
  });
});

describe("parseJsonArray", () => {
  it("parses JSON array from code block", () => {
    const response = '```json\n["keyword1", "keyword2", "keyword3"]\n```';
    expect(parseJsonArray(response)).toEqual(["keyword1", "keyword2", "keyword3"]);
  });

  it("filters out non-string elements from array", () => {
    const response = '["valid", 123, "also-valid", null, "third"]';
    expect(parseJsonArray(response)).toEqual(["valid", "also-valid", "third"]);
  });

  it("handles empty array", () => {
    const response = "[]";
    expect(parseJsonArray(response)).toEqual([]);
  });

  it("returns empty array for invalid JSON", () => {
    const response = "not valid json";
    expect(() => parseJsonArray(response)).toThrow();
  });

  it("returns empty array when JSON is not an array", () => {
    const response = '{"key": "value"}';
    expect(parseJsonArray(response)).toEqual([]);
  });

  it("delegates extraction to extractJsonFromResponse", () => {
    const response = 'Here are the keywords: ["one", "two", "three"]';
    expect(parseJsonArray(response)).toEqual(["one", "two", "three"]);
  });
});

describe("generateClusterLabels", () => {
  beforeEach(async () => {
    // Set API key for these tests
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns labels map when LLM is available", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: '{"0": "machine learning", "1": "web development"}',
        },
      ],
    });

    const { generateClusterLabels } = await import("../llm");
    const clusters = [
      { id: 0, keywords: ["neural networks", "deep learning"] },
      { id: 1, keywords: ["react", "javascript"] },
    ];

    const result = await generateClusterLabels(clusters);

    expect(result).toEqual({
      0: "machine learning",
      1: "web development",
    });
  });

  it("calls Anthropic API with correct parameters", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"0": "test"}' }],
    });

    const { generateClusterLabels } = await import("../llm");
    const clusters = [
      { id: 0, keywords: ["keyword1", "keyword2", "keyword3"] },
    ];

    await generateClusterLabels(clusters);

    expect(mockCreate).toHaveBeenCalledWith({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [
        {
          role: "user",
          content: expect.stringContaining("0: keyword1, keyword2, keyword3"),
        },
      ],
    });
  });

  it("parses response and converts string keys to number IDs", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: '```json\n{"10": "label for ten", "20": "label for twenty"}\n```',
        },
      ],
    });

    const { generateClusterLabels } = await import("../llm");
    const clusters = [
      { id: 10, keywords: ["test"] },
      { id: 20, keywords: ["another"] },
    ];

    const result = await generateClusterLabels(clusters);

    expect(result).toEqual({
      10: "label for ten",
      20: "label for twenty",
    });
  });

  it("falls back to first keyword when LLM is unavailable", async () => {
    process.env.ANTHROPIC_API_KEY = "";
    vi.resetModules();

    const { generateClusterLabels } = await import("../llm");
    const clusters = [
      { id: 0, keywords: ["first-keyword", "second-keyword"] },
      { id: 1, keywords: ["another-first", "another-second"] },
    ];

    const result = await generateClusterLabels(clusters);

    expect(result).toEqual({
      0: "first-keyword",
      1: "another-first",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("handles empty clusters array", async () => {
    const { generateClusterLabels } = await import("../llm");
    const result = await generateClusterLabels([]);

    expect(result).toEqual({});
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("uses cluster id as fallback when cluster has no keywords", async () => {
    process.env.ANTHROPIC_API_KEY = "";
    vi.resetModules();

    const { generateClusterLabels } = await import("../llm");
    const clusters = [{ id: 5, keywords: [] }];

    const result = await generateClusterLabels(clusters);

    expect(result).toEqual({
      5: "cluster 5",
    });
  });

  it("truncates long keyword lists in prompt", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"0": "test"}' }],
    });

    const { generateClusterLabels } = await import("../llm");
    const manyKeywords = Array.from({ length: 20 }, (_, i) => `keyword${i}`);
    const clusters = [{ id: 0, keywords: manyKeywords }];

    await generateClusterLabels(clusters);

    const callContent = mockCreate.mock.calls[0][0].messages[0].content;
    expect(callContent).toContain("...");
    expect(callContent).not.toContain("keyword15");
  });

  it("returns empty object when response has no text block", async () => {
    mockCreate.mockResolvedValue({
      content: [],
    });

    const { generateClusterLabels } = await import("../llm");
    const clusters = [{ id: 0, keywords: ["test"] }];

    const result = await generateClusterLabels(clusters);

    expect(result).toEqual({});
  });

  it("returns empty object when JSON parsing fails", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "not valid json at all" }],
    });

    const { generateClusterLabels } = await import("../llm");
    const clusters = [{ id: 0, keywords: ["test"] }];

    const result = await generateClusterLabels(clusters);

    expect(result).toEqual({});
  });

  it("filters out non-string values from response", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: '{"0": "valid label", "1": 123, "2": null, "3": "another valid"}',
        },
      ],
    });

    const { generateClusterLabels } = await import("../llm");
    const clusters = [
      { id: 0, keywords: ["test"] },
      { id: 1, keywords: ["test"] },
      { id: 2, keywords: ["test"] },
      { id: 3, keywords: ["test"] },
    ];

    const result = await generateClusterLabels(clusters);

    expect(result).toEqual({
      0: "valid label",
      3: "another valid",
    });
  });
});

describe("refineClusterLabels", () => {
  beforeEach(async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test-key";
    vi.resetModules();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns refined labels when LLM is available", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: '{"0": "keep", "1": "new label"}',
        },
      ],
    });

    const { refineClusterLabels } = await import("../llm");
    const refinements: RefinementRequest[] = [
      {
        id: 0,
        oldLabel: "old label",
        oldKeywords: ["keyword1"],
        newKeywords: ["keyword1", "keyword2"],
      },
      {
        id: 1,
        oldLabel: "another old",
        oldKeywords: ["keyword3"],
        newKeywords: ["keyword4"],
      },
    ];

    const result = await refineClusterLabels(refinements);

    expect(result).toEqual({
      0: "old label", // "keep" replaced with original
      1: "new label",
    });
  });

  it("replaces 'keep' with original label", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: '{"5": "keep", "10": "keep"}',
        },
      ],
    });

    const { refineClusterLabels } = await import("../llm");
    const refinements: RefinementRequest[] = [
      {
        id: 5,
        oldLabel: "preserved label",
        oldKeywords: ["a"],
        newKeywords: ["a", "b"],
      },
      {
        id: 10,
        oldLabel: "also preserved",
        oldKeywords: ["c"],
        newKeywords: ["c", "d"],
      },
    ];

    const result = await refineClusterLabels(refinements);

    expect(result).toEqual({
      5: "preserved label",
      10: "also preserved",
    });
  });

  it("returns new labels when not 'keep'", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: '{"0": "updated label", "1": "another update"}',
        },
      ],
    });

    const { refineClusterLabels } = await import("../llm");
    const refinements: RefinementRequest[] = [
      {
        id: 0,
        oldLabel: "old",
        oldKeywords: ["a"],
        newKeywords: ["b"],
      },
      {
        id: 1,
        oldLabel: "old2",
        oldKeywords: ["c"],
        newKeywords: ["d"],
      },
    ];

    const result = await refineClusterLabels(refinements);

    expect(result).toEqual({
      0: "updated label",
      1: "another update",
    });
  });

  it("falls back to original labels when LLM is unavailable", async () => {
    process.env.ANTHROPIC_API_KEY = "";
    vi.resetModules();

    const { refineClusterLabels } = await import("../llm");
    const refinements: RefinementRequest[] = [
      {
        id: 0,
        oldLabel: "keep this",
        oldKeywords: ["a"],
        newKeywords: ["b"],
      },
      {
        id: 1,
        oldLabel: "keep that",
        oldKeywords: ["c"],
        newKeywords: ["d"],
      },
    ];

    const result = await refineClusterLabels(refinements);

    expect(result).toEqual({
      0: "keep this",
      1: "keep that",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("handles empty refinements array", async () => {
    const { refineClusterLabels } = await import("../llm");
    const result = await refineClusterLabels([]);

    expect(result).toEqual({});
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("calls API with correct parameters", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"0": "keep"}' }],
    });

    const { refineClusterLabels } = await import("../llm");
    const refinements: RefinementRequest[] = [
      {
        id: 0,
        oldLabel: "test label",
        oldKeywords: ["old1", "old2"],
        newKeywords: ["new1", "new2"],
      },
    ];

    await refineClusterLabels(refinements);

    expect(mockCreate).toHaveBeenCalledWith({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 500,
      messages: [
        {
          role: "user",
          content: expect.stringContaining("test label"),
        },
      ],
    });

    const callContent = mockCreate.mock.calls[0][0].messages[0].content;
    expect(callContent).toContain("old1, old2");
    expect(callContent).toContain("new1, new2");
  });

  it("returns empty object when response has no text block", async () => {
    mockCreate.mockResolvedValue({
      content: [],
    });

    const { refineClusterLabels } = await import("../llm");
    const refinements: RefinementRequest[] = [
      {
        id: 0,
        oldLabel: "test",
        oldKeywords: ["a"],
        newKeywords: ["b"],
      },
    ];

    const result = await refineClusterLabels(refinements);

    expect(result).toEqual({});
  });

  it("returns empty object when JSON parsing fails", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "invalid json" }],
    });

    const { refineClusterLabels } = await import("../llm");
    const refinements: RefinementRequest[] = [
      {
        id: 0,
        oldLabel: "test",
        oldKeywords: ["a"],
        newKeywords: ["b"],
      },
    ];

    const result = await refineClusterLabels(refinements);

    expect(result).toEqual({});
  });

  it("filters out non-string values from response", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: '{"0": "valid", "1": 123, "2": null, "3": "also valid"}',
        },
      ],
    });

    const { refineClusterLabels } = await import("../llm");
    const refinements: RefinementRequest[] = [
      {
        id: 0,
        oldLabel: "old0",
        oldKeywords: ["a"],
        newKeywords: ["b"],
      },
      {
        id: 1,
        oldLabel: "old1",
        oldKeywords: ["c"],
        newKeywords: ["d"],
      },
      {
        id: 2,
        oldLabel: "old2",
        oldKeywords: ["e"],
        newKeywords: ["f"],
      },
      {
        id: 3,
        oldLabel: "old3",
        oldKeywords: ["g"],
        newKeywords: ["h"],
      },
    ];

    const result = await refineClusterLabels(refinements);

    expect(result).toEqual({
      0: "valid",
      3: "also valid",
    });
  });

  it("truncates long keyword lists in prompt", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"0": "keep"}' }],
    });

    const { refineClusterLabels } = await import("../llm");
    const manyKeywords = Array.from({ length: 15 }, (_, i) => `keyword${i}`);
    const refinements: RefinementRequest[] = [
      {
        id: 0,
        oldLabel: "test",
        oldKeywords: manyKeywords,
        newKeywords: manyKeywords,
      },
    ];

    await refineClusterLabels(refinements);

    const callContent = mockCreate.mock.calls[0][0].messages[0].content;
    // Prompt uses slice(0, 10) so should only include first 10
    expect(callContent).toContain("keyword0");
    expect(callContent).toContain("keyword9");
    expect(callContent).not.toContain("keyword10");
  });

  it("handles 'keep' case-sensitively", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: '{"0": "keep", "1": "KEEP", "2": "Keep"}',
        },
      ],
    });

    const { refineClusterLabels } = await import("../llm");
    const refinements: RefinementRequest[] = [
      {
        id: 0,
        oldLabel: "label0",
        oldKeywords: ["a"],
        newKeywords: ["b"],
      },
      {
        id: 1,
        oldLabel: "label1",
        oldKeywords: ["c"],
        newKeywords: ["d"],
      },
      {
        id: 2,
        oldLabel: "label2",
        oldKeywords: ["e"],
        newKeywords: ["f"],
      },
    ];

    const result = await refineClusterLabels(refinements);

    // Only lowercase "keep" is replaced (per implementation)
    expect(result).toEqual({
      0: "label0",
      1: "KEEP",
      2: "Keep",
    });
  });
});
