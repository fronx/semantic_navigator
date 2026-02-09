import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadCache, saveCache, getOrCompute, hash } from "../cache-utils";

// Mock fs/promises with default export
vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

const { default: mockFs } = await import("fs/promises");
const mockReadFile = mockFs.readFile as ReturnType<typeof vi.fn>;
const mockWriteFile = mockFs.writeFile as ReturnType<typeof vi.fn>;

describe("loadCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads valid JSON", async () => {
    const mockData = { key1: "value1", key2: "value2" };
    mockReadFile.mockResolvedValue(JSON.stringify(mockData));

    const result = await loadCache("test-cache.json");

    expect(mockReadFile).toHaveBeenCalledWith("test-cache.json", "utf-8");
    expect(result).toEqual(mockData);
  });

  it("returns empty object for non-existent file", async () => {
    mockReadFile.mockRejectedValue(new Error("ENOENT: no such file"));

    const result = await loadCache("missing.json");

    expect(result).toEqual({});
  });

  it("returns empty object for invalid JSON", async () => {
    mockReadFile.mockResolvedValue("not valid json");

    const result = await loadCache("invalid.json");

    expect(result).toEqual({});
  });

  it("handles malformed JSON", async () => {
    mockReadFile.mockResolvedValue('{"key": "value"');

    const result = await loadCache("malformed.json");

    expect(result).toEqual({});
  });
});

describe("saveCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes with pretty formatting (2-space indent)", async () => {
    const data = { key1: "value1", nested: { key2: "value2" } };

    await saveCache("test-cache.json", data);

    expect(mockWriteFile).toHaveBeenCalledWith(
      "test-cache.json",
      JSON.stringify(data, null, 2)
    );
  });

  it("overwrites existing file", async () => {
    const data1 = { key: "value1" };
    const data2 = { key: "value2" };

    await saveCache("cache.json", data1);
    await saveCache("cache.json", data2);

    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    expect(mockWriteFile).toHaveBeenLastCalledWith(
      "cache.json",
      JSON.stringify(data2, null, 2)
    );
  });

  it("creates new file", async () => {
    const data = { newKey: "newValue" };

    await saveCache("new-cache.json", data);

    expect(mockWriteFile).toHaveBeenCalledWith(
      "new-cache.json",
      JSON.stringify(data, null, 2)
    );
  });
});

describe("getOrCompute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses cached values", async () => {
    const cache = { item1: "cached1", item2: "cached2" };
    mockReadFile.mockResolvedValue(JSON.stringify(cache));

    const items = ["item1", "item2"];
    const keyFn = (item: string) => item;
    const computeFn = vi.fn();

    const result = await getOrCompute(items, "cache.json", keyFn, computeFn);

    expect(computeFn).not.toHaveBeenCalled();
    expect(result.size).toBe(2);
    expect(result.get("item1")).toBe("cached1");
    expect(result.get("item2")).toBe("cached2");
  });

  it("computes missing values", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({}));

    const items = ["item1", "item2"];
    const keyFn = (item: string) => item;
    const computeFn = vi.fn().mockImplementation(async (item: string) => {
      return `computed-${item}`;
    });

    const result = await getOrCompute(items, "cache.json", keyFn, computeFn);

    expect(computeFn).toHaveBeenCalledTimes(2);
    expect(result.size).toBe(2);
    expect(result.get("item1")).toBe("computed-item1");
    expect(result.get("item2")).toBe("computed-item2");
  });

  it("updates cache with computed values", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({}));

    const items = ["item1"];
    const keyFn = (item: string) => item;
    const computeFn = vi.fn().mockResolvedValue("computed");

    await getOrCompute(items, "cache.json", keyFn, computeFn);

    expect(mockWriteFile).toHaveBeenCalledWith(
      "cache.json",
      JSON.stringify({ item1: "computed" }, null, 2)
    );
  });

  it("calls callbacks correctly", async () => {
    const cache = { item1: "cached1" };
    mockReadFile.mockResolvedValue(JSON.stringify(cache));

    const items = ["item1", "item2", "item3"];
    const keyFn = (item: string) => item;
    const computeFn = vi.fn().mockImplementation(async (item: string) => {
      return `computed-${item}`;
    });

    const onCached = vi.fn();
    const onCompute = vi.fn();
    const onComplete = vi.fn();

    await getOrCompute(items, "cache.json", keyFn, computeFn, {
      onCached,
      onCompute,
      onComplete,
    });

    // onCached called once for item1 (1-based index)
    expect(onCached).toHaveBeenCalledTimes(1);
    expect(onCached).toHaveBeenCalledWith("item1", 1, 3);

    // onCompute called twice for item2 and item3 (1-based indices)
    expect(onCompute).toHaveBeenCalledTimes(2);
    expect(onCompute).toHaveBeenNthCalledWith(1, "item2", 2, 3);
    expect(onCompute).toHaveBeenNthCalledWith(2, "item3", 3, 3);

    // onComplete called with counts
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(1, 2); // 1 cached, 2 computed
  });

  it("returns Map with correct keys", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({}));

    interface Item {
      id: string;
      value: number;
    }

    const items: Item[] = [
      { id: "a", value: 1 },
      { id: "b", value: 2 },
    ];
    const keyFn = (item: Item) => item.id;
    const computeFn = vi.fn().mockImplementation(async (item: Item) => {
      return item.value * 2;
    });

    const result = await getOrCompute(items, "cache.json", keyFn, computeFn);

    expect(result.size).toBe(2);
    expect(result.has("a")).toBe(true);
    expect(result.has("b")).toBe(true);
    expect(result.get("a")).toBe(2);
    expect(result.get("b")).toBe(4);
  });

  it("handles empty items array", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({}));

    const items: string[] = [];
    const keyFn = (item: string) => item;
    const computeFn = vi.fn();
    const onComplete = vi.fn();

    const result = await getOrCompute(items, "cache.json", keyFn, computeFn, {
      onComplete,
    });

    expect(result.size).toBe(0);
    expect(computeFn).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(0, 0);
  });

  it("preserves existing cache entries", async () => {
    const cache = { existing: "value", item1: "cached1" };
    mockReadFile.mockResolvedValue(JSON.stringify(cache));

    const items = ["item1", "item2"];
    const keyFn = (item: string) => item;
    const computeFn = vi.fn().mockResolvedValue("computed2");

    await getOrCompute(items, "cache.json", keyFn, computeFn);

    const savedCache = JSON.parse(mockWriteFile.mock.calls[0][1] as string);
    expect(savedCache).toEqual({
      existing: "value",
      item1: "cached1",
      item2: "computed2",
    });
  });

  it("progress callbacks get correct 1-based indices", async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({}));

    const items = ["a", "b", "c"];
    const keyFn = (item: string) => item;
    const computeFn = vi.fn().mockResolvedValue("value");
    const onCompute = vi.fn();

    await getOrCompute(items, "cache.json", keyFn, computeFn, { onCompute });

    expect(onCompute).toHaveBeenNthCalledWith(1, "a", 1, 3);
    expect(onCompute).toHaveBeenNthCalledWith(2, "b", 2, 3);
    expect(onCompute).toHaveBeenNthCalledWith(3, "c", 3, 3);
  });
});

describe("hash", () => {
  it("generates SHA256 hash (16 chars)", () => {
    const result = hash("test content");

    expect(result).toHaveLength(16);
    expect(result).toMatch(/^[a-f0-9]{16}$/);
  });

  it("is consistent for same content", () => {
    const content = "test content";

    const hash1 = hash(content);
    const hash2 = hash(content);

    expect(hash1).toBe(hash2);
  });

  it("is different for different content", () => {
    const hash1 = hash("content 1");
    const hash2 = hash("content 2");

    expect(hash1).not.toBe(hash2);
  });

  it("handles empty string", () => {
    const result = hash("");

    expect(result).toHaveLength(16);
    expect(result).toMatch(/^[a-f0-9]{16}$/);
  });
});
