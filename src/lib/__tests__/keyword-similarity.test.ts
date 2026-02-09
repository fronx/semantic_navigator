import { describe, expect, it } from "vitest";
import {
  buildSimilarityMatrix,
  getTopSimilar,
  clusterByThreshold,
  pickRepresentative,
  deduplicateKeywords,
  countKeywords,
  filterAndSort,
  selectTopN,
} from "@/lib/keyword-similarity";

describe("buildSimilarityMatrix", () => {
  it("creates correct N×N structure", () => {
    const keywords = ["apple", "banana", "cherry"];
    const embeddings = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];

    const matrix = buildSimilarityMatrix(keywords, embeddings);

    expect(matrix.size).toBe(3);
    expect(matrix.get("apple")?.size).toBe(2); // No self-comparison
    expect(matrix.get("banana")?.size).toBe(2);
    expect(matrix.get("cherry")?.size).toBe(2);
  });

  it("excludes self-comparison", () => {
    const keywords = ["apple", "banana"];
    const embeddings = [
      [1, 0],
      [0, 1],
    ];

    const matrix = buildSimilarityMatrix(keywords, embeddings);

    expect(matrix.get("apple")?.has("apple")).toBe(false);
    expect(matrix.get("banana")?.has("banana")).toBe(false);
  });

  it("computes cosine similarity correctly", () => {
    const keywords = ["identical1", "identical2", "orthogonal"];
    const embeddings = [
      [1, 0],
      [1, 0], // Identical to first
      [0, 1], // Orthogonal to first
    ];

    const matrix = buildSimilarityMatrix(keywords, embeddings);

    // Identical vectors should have similarity ~1
    expect(matrix.get("identical1")?.get("identical2")).toBeCloseTo(1, 5);

    // Orthogonal vectors should have similarity 0
    expect(matrix.get("identical1")?.get("orthogonal")).toBeCloseTo(0, 5);
  });

  it("creates symmetric matrix", () => {
    const keywords = ["a", "b", "c"];
    const embeddings = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];

    const matrix = buildSimilarityMatrix(keywords, embeddings);

    // Check symmetry
    const ab = matrix.get("a")?.get("b");
    const ba = matrix.get("b")?.get("a");
    expect(ab).toBeCloseTo(ba!, 5);

    const ac = matrix.get("a")?.get("c");
    const ca = matrix.get("c")?.get("a");
    expect(ac).toBeCloseTo(ca!, 5);
  });
});

describe("filterAndSort", () => {
  it("filters entries below threshold", () => {
    const entries = new Map([
      ["a", 0.9],
      ["b", 0.5],
      ["c", 0.8],
      ["d", 0.3],
    ]);

    const result = filterAndSort(entries, 0.6);

    expect(result).toHaveLength(2);
    expect(result.map(([k]) => k)).toEqual(["a", "c"]);
  });

  it("sorts by score descending", () => {
    const entries = new Map([
      ["a", 0.5],
      ["b", 0.9],
      ["c", 0.7],
    ]);

    const result = filterAndSort(entries, 0);

    expect(result.map(([k]) => k)).toEqual(["b", "c", "a"]);
  });
});

describe("selectTopN", () => {
  it("returns top N items when all below highThreshold", () => {
    const items: Array<[string, number]> = [
      ["a", 0.85],
      ["b", 0.8],
      ["c", 0.75],
      ["d", 0.7],
      ["e", 0.65],
    ];

    const result = selectTopN(items, 3, 0.9);

    expect(result).toHaveLength(3);
    expect(result.map(([k]) => k)).toEqual(["a", "b", "c"]);
  });

  it("includes all high-priority matches even if exceeding topN", () => {
    const items: Array<[string, number]> = [
      ["high1", 0.95],
      ["high2", 0.92],
      ["high3", 0.91],
      ["low1", 0.85],
      ["low2", 0.8],
    ];

    const result = selectTopN(items, 2, 0.9);

    // Should include all 3 high items even though topN=2
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.map(([k]) => k)).toContain("high1");
    expect(result.map(([k]) => k)).toContain("high2");
    expect(result.map(([k]) => k)).toContain("high3");
  });

  it("maintains descending order", () => {
    const items: Array<[string, number]> = [
      ["a", 0.95],
      ["b", 0.85],
      ["c", 0.92],
      ["d", 0.8],
    ];

    const result = selectTopN(items, 3, 0.9);

    expect(result[0][1]).toBeGreaterThan(result[1][1]);
    expect(result[1][1]).toBeGreaterThan(result[2][1]);
  });
});

describe("getTopSimilar", () => {
  it("uses default parameters", () => {
    const matrix = new Map([
      [
        "a",
        new Map([
          ["b", 0.95],
          ["c", 0.85],
          ["d", 0.75],
          ["e", 0.65], // Below default minThreshold (0.7)
        ]),
      ],
    ]);

    const result = getTopSimilar(matrix);

    expect(result.get("a")).toHaveLength(3); // Only b, c, d pass threshold
    expect(result.get("a")?.map(([k]) => k)).toEqual(["b", "c", "d"]);
  });

  it("respects custom parameters", () => {
    const matrix = new Map([
      [
        "a",
        new Map([
          ["b", 0.95],
          ["c", 0.85],
          ["d", 0.75],
          ["e", 0.65],
          ["f", 0.55],
        ]),
      ],
    ]);

    const result = getTopSimilar(matrix, {
      minThreshold: 0.6,
      topN: 2,
      highThreshold: 0.9,
    });

    const topA = result.get("a")!;
    // Should have "b" (high-priority) plus top 2 of the rest
    expect(topA.length).toBeGreaterThanOrEqual(3); // b (high) + c, d
    expect(topA.map(([k]) => k)).toContain("b");
  });

  it("filters low-similarity entries", () => {
    const matrix = new Map([
      [
        "a",
        new Map([
          ["b", 0.5],
          ["c", 0.3],
        ]),
      ],
    ]);

    const result = getTopSimilar(matrix, { minThreshold: 0.7 });

    expect(result.get("a")).toHaveLength(0);
  });

  it("always includes high-priority matches", () => {
    const matrix = new Map([
      [
        "a",
        new Map([
          ["high1", 0.95],
          ["high2", 0.92],
          ["low1", 0.8],
        ]),
      ],
    ]);

    const result = getTopSimilar(matrix, {
      minThreshold: 0.7,
      topN: 1,
      highThreshold: 0.9,
    });

    const topA = result.get("a")!;
    // Should include both high-priority items even though topN=1
    expect(topA.map(([k]) => k)).toContain("high1");
    expect(topA.map(([k]) => k)).toContain("high2");
  });
});

describe("clusterByThreshold", () => {
  it("performs greedy clustering", () => {
    const matrix = new Map([
      ["a", new Map([["b", 0.9], ["c", 0.5]])],
      ["b", new Map([["a", 0.9], ["c", 0.85]])],
      ["c", new Map([["a", 0.5], ["b", 0.85]])],
    ]);

    const clusters = clusterByThreshold(matrix, 0.8);

    // "a" processed first, takes "b" (0.9 >= 0.8)
    // "c" can't join "a" (0.5 < 0.8), forms own cluster
    // Even though c-b is 0.85, "b" is already taken
    expect(clusters).toHaveLength(2);
    expect(clusters[0].sort()).toEqual(["a", "b"].sort());
    expect(clusters[1]).toEqual(["c"]);
  });

  it("filters by threshold", () => {
    const matrix = new Map([
      ["a", new Map([["b", 0.6], ["c", 0.5]])],
      ["b", new Map([["a", 0.6], ["c", 0.55]])],
      ["c", new Map([["a", 0.5], ["b", 0.55]])],
    ]);

    const clusters = clusterByThreshold(matrix, 0.7);

    // No connections meet threshold, each keyword forms own cluster
    expect(clusters).toHaveLength(3);
    expect(clusters.map((c) => c[0]).sort()).toEqual(["a", "b", "c"]);
  });

  it("handles keyword-specific clustering", () => {
    const matrix = new Map([
      ["x", new Map([["y", 0.95]])],
      ["y", new Map([["x", 0.95], ["z", 0.85]])],
      ["z", new Map([["y", 0.85]])],
    ]);

    const clusters = clusterByThreshold(matrix, 0.9);

    // "x" processed first, takes "y"
    // "z" can't join because y is taken and x-z doesn't meet threshold
    expect(clusters).toHaveLength(2);
    expect(clusters.find((c) => c.includes("x"))?.sort()).toEqual(["x", "y"].sort());
    expect(clusters.find((c) => c.includes("z"))).toEqual(["z"]);
  });

  it("creates single-item clusters for isolated keywords", () => {
    const matrix = new Map([
      ["a", new Map([["b", 0.5]])],
      ["b", new Map([["a", 0.5]])],
    ]);

    const clusters = clusterByThreshold(matrix, 0.8);

    expect(clusters).toHaveLength(2);
    expect(clusters[0]).toEqual(["a"]);
    expect(clusters[1]).toEqual(["b"]);
  });
});

describe("pickRepresentative", () => {
  it("prefers frequent keywords", () => {
    const cluster = ["rare", "common"];
    const counts = new Map([
      ["rare", 1],
      ["common", 10],
    ]);

    const rep = pickRepresentative(cluster, counts);

    expect(rep).toBe("common");
  });

  it("prefers shorter when counts equal", () => {
    const cluster = ["longkeyword", "short"];
    const counts = new Map([
      ["longkeyword", 5],
      ["short", 5],
    ]);

    const rep = pickRepresentative(cluster, counts);

    expect(rep).toBe("short");
  });

  it("uses formula: count*1000 - length", () => {
    const cluster = ["a", "b", "c"];
    const counts = new Map([
      ["a", 10], // 10*1000 - 1 = 9999
      ["b", 5],  // 5*1000 - 1 = 4999
      ["c", 9],  // 9*1000 - 1 = 8999
    ]);

    const rep = pickRepresentative(cluster, counts);

    expect(rep).toBe("a"); // Highest score
  });

  it("handles missing counts", () => {
    const cluster = ["known", "unknown"];
    const counts = new Map([["known", 5]]);

    const rep = pickRepresentative(cluster, counts);

    // "unknown" has count=0, score = 0*1000 - 7 = -7
    // "known" has count=5, score = 5*1000 - 5 = 4995
    expect(rep).toBe("known");
  });

  it("prefers shorter with significant length difference", () => {
    const cluster = ["verylongkeywordname", "tiny"];
    const counts = new Map([
      ["verylongkeywordname", 2], // 2*1000 - 19 = 1981
      ["tiny", 1],                 // 1*1000 - 4 = 996
    ]);

    const rep = pickRepresentative(cluster, counts);

    expect(rep).toBe("verylongkeywordname"); // Higher count wins despite length
  });
});

describe("deduplicateKeywords", () => {
  it("maps all cluster members to representative", () => {
    const clusters = [
      ["common", "rare1", "rare2"],
      ["freq", "infreq"],
    ];
    const counts = new Map([
      ["common", 10],
      ["rare1", 2],
      ["rare2", 1],
      ["freq", 8],
      ["infreq", 3],
    ]);

    const mapping = deduplicateKeywords(clusters, counts);

    expect(mapping.get("common")).toBe("common");
    expect(mapping.get("rare1")).toBe("common");
    expect(mapping.get("rare2")).toBe("common");
    expect(mapping.get("freq")).toBe("freq");
    expect(mapping.get("infreq")).toBe("freq");
  });

  it("uses pickRepresentative for selection", () => {
    const clusters = [["longkeyword", "short"]];
    const counts = new Map([
      ["longkeyword", 5],
      ["short", 5],
    ]);

    const mapping = deduplicateKeywords(clusters, counts);

    // Same count, shorter wins (5*1000 - 11 = 4989 vs 5*1000 - 5 = 4995)
    expect(mapping.get("longkeyword")).toBe("short");
    expect(mapping.get("short")).toBe("short");
  });

  it("handles single-item clusters", () => {
    const clusters = [["solo1"], ["solo2"]];
    const counts = new Map([
      ["solo1", 1],
      ["solo2", 1],
    ]);

    const mapping = deduplicateKeywords(clusters, counts);

    expect(mapping.get("solo1")).toBe("solo1");
    expect(mapping.get("solo2")).toBe("solo2");
  });

  it("creates mapping for all keywords", () => {
    const clusters = [
      ["a", "b"],
      ["c"],
    ];
    const counts = new Map([
      ["a", 3],
      ["b", 2],
      ["c", 1],
    ]);

    const mapping = deduplicateKeywords(clusters, counts);

    expect(mapping.size).toBe(3);
    expect(mapping.has("a")).toBe(true);
    expect(mapping.has("b")).toBe(true);
    expect(mapping.has("c")).toBe(true);
  });
});

describe("countKeywords", () => {
  it("counts occurrences", () => {
    const keywords = ["apple", "banana", "apple", "cherry", "apple"];

    const counts = countKeywords(keywords);

    expect(counts.get("apple")).toBe(3);
    expect(counts.get("banana")).toBe(1);
    expect(counts.get("cherry")).toBe(1);
  });

  it("handles empty array", () => {
    const counts = countKeywords([]);

    expect(counts.size).toBe(0);
  });

  it("handles duplicates correctly", () => {
    const keywords = ["same", "same", "same"];

    const counts = countKeywords(keywords);

    expect(counts.size).toBe(1);
    expect(counts.get("same")).toBe(3);
  });

  it("handles single keyword", () => {
    const keywords = ["unique"];

    const counts = countKeywords(keywords);

    expect(counts.size).toBe(1);
    expect(counts.get("unique")).toBe(1);
  });
});
