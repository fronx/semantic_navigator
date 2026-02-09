import { describe, it, expect } from "vitest";
import {
  countOccurrences,
  topEntries,
  filterAndSort,
  selectTopN,
  buildComparisonMatrix,
  clusterByThreshold,
  pickRepresentativeBy,
} from "../array-utils";

describe("countOccurrences", () => {
  it("returns empty Map for empty array", () => {
    const result = countOccurrences([]);
    expect(result.size).toBe(0);
  });

  it("counts single item occurrence", () => {
    const result = countOccurrences(["apple"]);
    expect(result.get("apple")).toBe(1);
  });

  it("counts multiple occurrences of same item", () => {
    const result = countOccurrences(["apple", "banana", "apple", "apple"]);
    expect(result.get("apple")).toBe(3);
    expect(result.get("banana")).toBe(1);
  });

  it("handles different primitive types", () => {
    const numbers = countOccurrences([1, 2, 1, 3, 2, 1]);
    expect(numbers.get(1)).toBe(3);
    expect(numbers.get(2)).toBe(2);
    expect(numbers.get(3)).toBe(1);

    const booleans = countOccurrences([true, false, true, true]);
    expect(booleans.get(true)).toBe(3);
    expect(booleans.get(false)).toBe(1);
  });

  it("handles objects using reference equality", () => {
    const obj1 = { id: 1 };
    const obj2 = { id: 2 };
    const result = countOccurrences([obj1, obj2, obj1]);
    expect(result.get(obj1)).toBe(2);
    expect(result.get(obj2)).toBe(1);
  });
});

describe("topEntries", () => {
  it("returns entries sorted by value descending", () => {
    const map = new Map([
      ["a", 5],
      ["b", 10],
      ["c", 3],
    ]);
    const result = topEntries(map);
    expect(result).toEqual([
      ["b", 10],
      ["a", 5],
      ["c", 3],
    ]);
  });

  it("respects custom n parameter", () => {
    const map = new Map([
      ["a", 5],
      ["b", 10],
      ["c", 3],
      ["d", 7],
    ]);
    const result = topEntries(map, 2);
    expect(result).toEqual([
      ["b", 10],
      ["d", 7],
    ]);
  });

  it("uses default n=20", () => {
    const map = new Map(Array.from({ length: 25 }, (_, i) => [`key${i}`, i]));
    const result = topEntries(map);
    expect(result.length).toBe(20);
    expect(result[0]).toEqual(["key24", 24]);
  });

  it("handles Map smaller than n", () => {
    const map = new Map([
      ["a", 5],
      ["b", 10],
    ]);
    const result = topEntries(map, 10);
    expect(result.length).toBe(2);
  });

  it("returns empty array for empty Map", () => {
    const map = new Map<string, number>();
    const result = topEntries(map);
    expect(result).toEqual([]);
  });

  it("handles tied values", () => {
    const map = new Map([
      ["a", 10],
      ["b", 10],
      ["c", 5],
    ]);
    const result = topEntries(map, 2);
    expect(result.length).toBe(2);
    expect(result[0][1]).toBe(10);
    expect(result[1][1]).toBe(10);
  });
});

describe("filterAndSort", () => {
  it("filters entries below threshold", () => {
    const map = new Map([
      ["a", 5],
      ["b", 10],
      ["c", 3],
      ["d", 8],
    ]);
    const result = filterAndSort(map, 5);
    expect(result).toEqual([
      ["b", 10],
      ["d", 8],
      ["a", 5],
    ]);
  });

  it("sorts remaining entries descending", () => {
    const map = new Map([
      ["a", 5],
      ["b", 10],
      ["c", 7],
    ]);
    const result = filterAndSort(map, 1);
    expect(result).toEqual([
      ["b", 10],
      ["c", 7],
      ["a", 5],
    ]);
  });

  it("returns empty array when no entries meet threshold", () => {
    const map = new Map([
      ["a", 1],
      ["b", 2],
    ]);
    const result = filterAndSort(map, 10);
    expect(result).toEqual([]);
  });

  it("includes entries exactly at threshold", () => {
    const map = new Map([
      ["a", 5],
      ["b", 4],
    ]);
    const result = filterAndSort(map, 5);
    expect(result).toEqual([["a", 5]]);
  });

  it("handles empty Map", () => {
    const map = new Map<string, number>();
    const result = filterAndSort(map, 5);
    expect(result).toEqual([]);
  });
});

describe("selectTopN", () => {
  it("selects first N items when all below highThreshold, then sorts", () => {
    const items: Array<[string, number]> = [
      ["a", 5],
      ["b", 10],
      ["c", 3],
      ["d", 7],
    ];
    const result = selectTopN(items, 2, 20);
    // Takes first 2 items ["a", 5], ["b", 10], then sorts descending
    expect(result).toEqual([
      ["b", 10],
      ["a", 5],
    ]);
  });

  it("always includes items above highThreshold even if exceeds topN", () => {
    const items: Array<[string, number]> = [
      ["a", 25],
      ["b", 30],
      ["c", 5],
      ["d", 7],
    ];
    const result = selectTopN(items, 2, 20);
    expect(result.length).toBe(4);
    expect(result).toEqual([
      ["b", 30],
      ["a", 25],
      ["d", 7],
      ["c", 5],
    ]);
  });

  it("sorts final result descending", () => {
    const items: Array<[string, number]> = [
      ["a", 5],
      ["b", 25],
      ["c", 10],
      ["d", 3],
    ];
    const result = selectTopN(items, 2, 20);
    expect(result[0]).toEqual(["b", 25]);
    expect(result[1][1]).toBeGreaterThan(result[2]?.[1] || 0);
  });

  it("handles topN=0 with high-priority items", () => {
    const items: Array<[string, number]> = [
      ["a", 25],
      ["b", 5],
    ];
    const result = selectTopN(items, 0, 20);
    expect(result).toEqual([["a", 25]]);
  });

  it("handles empty items array", () => {
    const items: Array<[string, number]> = [];
    const result = selectTopN(items, 2, 20);
    expect(result).toEqual([]);
  });

  it("handles all items above highThreshold", () => {
    const items: Array<[string, number]> = [
      ["a", 25],
      ["b", 30],
      ["c", 22],
    ];
    const result = selectTopN(items, 1, 20);
    expect(result.length).toBe(3);
    expect(result).toEqual([
      ["b", 30],
      ["a", 25],
      ["c", 22],
    ]);
  });
});

describe("buildComparisonMatrix", () => {
  it("creates N×N structure for N items", () => {
    const items = ["a", "b", "c"];
    const compareFn = () => 1;
    const matrix = buildComparisonMatrix(items, compareFn);
    expect(matrix.size).toBe(3);
    expect(matrix.get("a")?.size).toBe(2);
    expect(matrix.get("b")?.size).toBe(2);
    expect(matrix.get("c")?.size).toBe(2);
  });

  it("excludes self-comparison", () => {
    const items = ["a", "b"];
    const compareFn = () => 1;
    const matrix = buildComparisonMatrix(items, compareFn);
    expect(matrix.get("a")?.has("a")).toBe(false);
    expect(matrix.get("b")?.has("b")).toBe(false);
  });

  it("uses correct indices in compareFn", () => {
    const items = ["a", "b", "c"];
    const indexPairs: Array<[number, number]> = [];
    const compareFn = (a: string, b: string, indexA: number, indexB: number) => {
      indexPairs.push([indexA, indexB]);
      return 1;
    };
    buildComparisonMatrix(items, compareFn);
    expect(indexPairs).toContainEqual([0, 1]);
    expect(indexPairs).toContainEqual([0, 2]);
    expect(indexPairs).toContainEqual([1, 0]);
    expect(indexPairs).toContainEqual([1, 2]);
    expect(indexPairs).toContainEqual([2, 0]);
    expect(indexPairs).toContainEqual([2, 1]);
  });

  it("stores comparison results correctly", () => {
    const items = ["a", "b", "c"];
    const compareFn = (a: string, b: string) => {
      if (a === "a" && b === "b") return 10;
      if (a === "a" && b === "c") return 5;
      return 1;
    };
    const matrix = buildComparisonMatrix(items, compareFn);
    expect(matrix.get("a")?.get("b")).toBe(10);
    expect(matrix.get("a")?.get("c")).toBe(5);
  });

  it("returns correct Map structure", () => {
    const items = [1, 2];
    const compareFn = (a: number, b: number) => a + b;
    const matrix = buildComparisonMatrix(items, compareFn);
    expect(matrix instanceof Map).toBe(true);
    expect(matrix.get(1) instanceof Map).toBe(true);
  });

  it("handles single item", () => {
    const items = ["a"];
    const compareFn = () => 1;
    const matrix = buildComparisonMatrix(items, compareFn);
    expect(matrix.size).toBe(1);
    expect(matrix.get("a")?.size).toBe(0);
  });

  it("handles empty array", () => {
    const items: string[] = [];
    const compareFn = () => 1;
    const matrix = buildComparisonMatrix(items, compareFn);
    expect(matrix.size).toBe(0);
  });
});

describe("clusterByThreshold", () => {
  it("groups items above threshold into clusters", () => {
    const matrix = new Map([
      ["a", new Map([["b", 10], ["c", 3]])],
      ["b", new Map([["a", 10], ["c", 2]])],
      ["c", new Map([["a", 3], ["b", 2]])],
    ]);
    const clusters = clusterByThreshold(matrix, 5);
    expect(clusters.length).toBe(2);
    expect(clusters[0]).toContain("a");
    expect(clusters[0]).toContain("b");
    expect(clusters[1]).toEqual(["c"]);
  });

  it("uses greedy algorithm - items not reconsidered", () => {
    const matrix = new Map([
      ["a", new Map([["b", 10], ["c", 10]])],
      ["b", new Map([["a", 10], ["c", 10]])],
      ["c", new Map([["a", 10], ["b", 10]])],
    ]);
    const clusters = clusterByThreshold(matrix, 5);
    expect(clusters.length).toBe(1);
    expect(clusters[0]).toEqual(["a", "b", "c"]);
  });

  it("creates single-item clusters for items below threshold", () => {
    const matrix = new Map([
      ["a", new Map([["b", 1], ["c", 1]])],
      ["b", new Map([["a", 1], ["c", 1]])],
      ["c", new Map([["a", 1], ["b", 1]])],
    ]);
    const clusters = clusterByThreshold(matrix, 5);
    expect(clusters.length).toBe(3);
    expect(clusters).toEqual([["a"], ["b"], ["c"]]);
  });

  it("ensures each item appears in exactly one cluster", () => {
    const matrix = new Map([
      ["a", new Map([["b", 10], ["c", 3]])],
      ["b", new Map([["a", 10], ["c", 8]])],
      ["c", new Map([["a", 3], ["b", 8]])],
    ]);
    const clusters = clusterByThreshold(matrix, 5);
    const allItems = clusters.flat();
    expect(allItems.length).toBe(3);
    expect(new Set(allItems).size).toBe(3);
  });

  it("handles empty matrix", () => {
    const matrix = new Map<string, Map<string, number>>();
    const clusters = clusterByThreshold(matrix, 5);
    expect(clusters).toEqual([]);
  });

  it("handles threshold exactly at boundary", () => {
    const matrix = new Map([
      ["a", new Map([["b", 5]])],
      ["b", new Map([["a", 5]])],
    ]);
    const clusters = clusterByThreshold(matrix, 5);
    expect(clusters.length).toBe(1);
    expect(clusters[0]).toEqual(["a", "b"]);
  });

  it("preserves insertion order in first cluster formation", () => {
    const matrix = new Map([
      ["a", new Map([["b", 10], ["c", 10]])],
      ["b", new Map([["a", 10], ["c", 10]])],
      ["c", new Map([["a", 10], ["b", 10]])],
    ]);
    const clusters = clusterByThreshold(matrix, 5);
    expect(clusters[0][0]).toBe("a");
  });
});

describe("pickRepresentativeBy", () => {
  it("selects item with highest score", () => {
    const cluster = ["short", "medium", "verylongword"];
    const scoreFn = (item: string) => item.length;
    const result = pickRepresentativeBy(cluster, scoreFn);
    expect(result).toBe("verylongword");
  });

  it("works with different scoring functions", () => {
    const cluster = [5, 2, 8, 1];
    const result = pickRepresentativeBy(cluster, (x) => x);
    expect(result).toBe(8);
  });

  it("handles frequency-based scoring", () => {
    const cluster = ["apple", "banana", "apple"];
    const counts = new Map([
      ["apple", 2],
      ["banana", 1],
    ]);
    const result = pickRepresentativeBy(
      Array.from(new Set(cluster)),
      (item) => counts.get(item) || 0
    );
    expect(result).toBe("apple");
  });

  it("handles ties by returning first item with max score", () => {
    const cluster = ["a", "b", "c"];
    const scoreFn = () => 1;
    const result = pickRepresentativeBy(cluster, scoreFn);
    expect(result).toBe("a");
  });

  it("works with single-item cluster", () => {
    const cluster = ["only"];
    const result = pickRepresentativeBy(cluster, (x) => x.length);
    expect(result).toBe("only");
  });

  it("handles negative scores", () => {
    const cluster = [1, -5, 3, -2];
    const result = pickRepresentativeBy(cluster, (x) => x);
    expect(result).toBe(3);
  });

  it("handles complex scoring combining multiple factors", () => {
    type Item = { name: string; frequency: number; length: number };
    const cluster: Item[] = [
      { name: "a", frequency: 5, length: 1 },
      { name: "bb", frequency: 3, length: 2 },
      { name: "ccc", frequency: 4, length: 3 },
    ];
    const result = pickRepresentativeBy(
      cluster,
      (item) => item.frequency * 10 - item.length
    );
    expect(result.name).toBe("a");
  });
});
