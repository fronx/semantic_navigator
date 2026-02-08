import { describe, it, expect } from "vitest";
import { renderMarkdownToSegments, type MarkdownSegment } from "@/lib/r3f-markdown";

function flattenText(segments: MarkdownSegment[]): string {
  return segments.map((s) => s.text).join("");
}

describe("renderMarkdownToSegments", () => {
  it("converts headings with larger font size", () => {
    const segments = renderMarkdownToSegments("# Title");
    expect(segments).toHaveLength(2); // text + newline
    const heading = segments[0];
    expect(heading.text).toBe("Title");
    expect(heading.fontSize).toBeGreaterThan(28); // larger than paragraph font size
    expect(heading.fontWeight).toBe("700");
  });

  it("handles inline bold and italic", () => {
    const segments = renderMarkdownToSegments("This is **bold** and _italic_.");
    const text = flattenText(segments);
    expect(text).toContain("This is ");
    const bold = segments.find((seg) => seg.fontWeight === "700");
    expect(bold?.text).toBe("bold");
    const italic = segments.find((seg) => seg.fontStyle === "italic");
    expect(italic?.text).toBe("italic");
  });

  it("renders bullet lists with prefixes", () => {
    const segments = renderMarkdownToSegments("- One\n- Two");
    const listText = flattenText(segments);
    expect(listText).toContain("• One");
    expect(listText).toContain("• Two");
  });

  it("formats code blocks with monospace font", () => {
    const segments = renderMarkdownToSegments("```\nconst x = 1;\n```");
    const codeSeg = segments.find((seg) => seg.fontFamily === "JetBrains Mono");
    expect(codeSeg).toBeDefined();
    expect(codeSeg?.text).toContain("const x");
  });
});
