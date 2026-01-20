import { describe, it, expect } from "vitest";
import { determineImportAction } from "../ingestion-chunks";

describe("determineImportAction", () => {
  it("returns 'create' when no existing article", () => {
    const result = determineImportAction(null, "abc123");
    expect(result).toBe("create");
  });

  it("returns 'skip' when content hash matches", () => {
    const result = determineImportAction({ content_hash: "abc123" }, "abc123");
    expect(result).toBe("skip");
  });

  it("returns 'reimport' when content hash differs", () => {
    const result = determineImportAction({ content_hash: "abc123" }, "def456");
    expect(result).toBe("reimport");
  });

  it("returns 'reimport' when forceReimport is true, even if hash matches", () => {
    const result = determineImportAction({ content_hash: "abc123" }, "abc123", true);
    expect(result).toBe("reimport");
  });

  it("returns 'reimport' when forceReimport is true and hash differs", () => {
    const result = determineImportAction({ content_hash: "abc123" }, "def456", true);
    expect(result).toBe("reimport");
  });

  it("returns 'create' when forceReimport is true but no existing article", () => {
    const result = determineImportAction(null, "abc123", true);
    expect(result).toBe("create");
  });
});
