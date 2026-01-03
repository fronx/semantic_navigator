import { parseMarkdown, flattenSections } from "../parser";

describe("parseMarkdown", () => {
  it("extracts hierarchical sections from headings", () => {
    const content = `
# Top Level

Some intro text.

## Second Level

More text here.

### Third Level

Deep content.

## Another Second Level

Back up.
`.trim();

    const result = parseMarkdown(content, "test.md");

    expect(result.title).toBe("test");
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].title).toBe("Top Level");
    expect(result.sections[0].level).toBe(1);
    expect(result.sections[0].children).toHaveLength(2);
    expect(result.sections[0].children[0].title).toBe("Second Level");
    expect(result.sections[0].children[0].children[0].title).toBe("Third Level");
  });

  it("extracts paragraphs as text content only", () => {
    const content = `
# Section

First paragraph with some text.

Second paragraph here.
`.trim();

    const result = parseMarkdown(content, "test.md");
    const flat = flattenSections(result.sections);

    expect(flat[0].paragraphs).toHaveLength(2);
    expect(flat[0].paragraphs[0]).toBe("First paragraph with some text.");
    expect(flat[0].paragraphs[1]).toBe("Second paragraph here.");
  });

  it("filters out image-only paragraphs", () => {
    const content = `
# Section

Text before image.

![](image.png)

Text after image.
`.trim();

    const result = parseMarkdown(content, "test.md");
    const flat = flattenSections(result.sections);

    expect(flat[0].paragraphs).toHaveLength(2);
    expect(flat[0].paragraphs[0]).toBe("Text before image.");
    expect(flat[0].paragraphs[1]).toBe("Text after image.");
  });

  it("filters out Substack-style linked images spanning multiple lines", () => {
    // This is the actual pattern from Substack exports that causes problems
    const content = `
# Section

Text before.

[

![](56768506-9ecb-4bc5-8ee8-f63711723e4f_1024x585.png)



](https://substackcdn.com/image/fetch/f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F56768506-9ecb-4bc5-8ee8-f63711723e4f_1024x585.png)

Text after.
`.trim();

    const result = parseMarkdown(content, "test.md");
    const flat = flattenSections(result.sections);

    // Should only have the two text paragraphs, not the image fragments
    expect(flat[0].paragraphs).toHaveLength(2);
    expect(flat[0].paragraphs[0]).toBe("Text before.");
    expect(flat[0].paragraphs[1]).toBe("Text after.");
  });

  it("preserves text content from links while filtering link-only-with-image", () => {
    const content = `
# Section

Check out [this link](https://example.com) for more info.

Here is an inline image: ![alt](img.png) in text.
`.trim();

    const result = parseMarkdown(content, "test.md");
    const flat = flattenSections(result.sections);

    expect(flat[0].paragraphs).toHaveLength(2);
    expect(flat[0].paragraphs[0]).toBe("Check out this link for more info.");
    expect(flat[0].paragraphs[1]).toBe("Here is an inline image: in text.");
  });

  it("strips frontmatter correctly", () => {
    const content = `---
title: Test
date: 2024-01-01
---

# Actual Content

Paragraph here.
`;

    const result = parseMarkdown(content, "test.md");

    expect(result.sections[0].title).toBe("Actual Content");
    expect(result.sections[0].paragraphs[0]).toBe("Paragraph here.");
  });

  it("strips large frontmatter with semantic data", () => {
    // Simulating the large frontmatter from Obsidian files
    const content = `---
semantic_data:
  segments:
    - text: Some text
      embedding:
        - 0.123
        - 0.456
    - text: More text
      embedding:
        - 0.789
        - 0.012
---

# Real Content

This is the actual paragraph.
`;

    const result = parseMarkdown(content, "test.md");

    expect(result.sections[0].title).toBe("Real Content");
    expect(result.sections[0].paragraphs[0]).toBe("This is the actual paragraph.");
  });

  it("extracts backlinks from wiki-style links", () => {
    const content = `
# Section

This references [[another-article]] and [[some-topic|with alias]].
`.trim();

    const result = parseMarkdown(content, "test.md");

    expect(result.backlinks).toContain("another-article");
    expect(result.backlinks).toContain("some-topic");
    expect(result.backlinks).toHaveLength(2);
  });

  describe("large frontmatter handling (issue #1)", () => {
    it("strips very large YAML frontmatter with embedded markdown-like content", () => {
      // This simulates the agency-2.md file which has ~3284 lines of frontmatter
      // with embedded markdown content inside YAML text fields
      const embeddedMarkdown = `# Fake heading inside YAML
## Another fake heading
Some paragraph text that looks like markdown.`;

      // Generate a large embedding array to simulate real data
      const embedding = Array(1536).fill(0).map((_, i) => i * 0.001);

      const largeFrontmatter = `---
semantic_data:
  segments:
    - text: |
        ${embeddedMarkdown}
      embedding:
${embedding.map(v => `        - ${v}`).join("\n")}
    - text: |
        # More fake content
        ## With more headings
      embedding:
${embedding.map(v => `        - ${v * 2}`).join("\n")}
  metadata:
    last_processed: '2025-12-18T19:29:29.741Z'
---
# Real Content

First real paragraph.

## First Section

Section content here.

## Second Section

More content.
`;

      const result = parseMarkdown(largeFrontmatter, "test.md");

      // Should only see the actual content, not the YAML embedded markdown
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBe("Real Content");
      expect(result.sections[0].children).toHaveLength(2);
      expect(result.sections[0].children[0].title).toBe("First Section");
      expect(result.sections[0].children[1].title).toBe("Second Section");
    });

    it("correctly parses document structure after stripping large frontmatter", () => {
      // Reproduce the exact structure of agency-2.md
      const content = `---
semantic_data:
  lots_of_data: true
---
# Agency theory refinement

**User:** example@email.com
**Created:** 11/10/2025 14:38:01

## Prompt:

Hey, let's look at the following outline.

## Response:

Here is my response to your outline.

### 1. First point

Detail about first point.

### 2. Second point

Detail about second point.

## Prompt:

Another question here.

## Response:

Final response content.
`;

      const result = parseMarkdown(content, "agency-2.md");
      const flat = flattenSections(result.sections);

      // Verify structure matches expected hierarchy
      expect(result.sections).toHaveLength(1);
      expect(result.sections[0].title).toBe("Agency theory refinement");
      expect(result.sections[0].level).toBe(1);

      // Should have 4 h2 children
      const h2Children = result.sections[0].children;
      expect(h2Children).toHaveLength(4);
      expect(h2Children[0].title).toBe("Prompt:");
      expect(h2Children[1].title).toBe("Response:");
      expect(h2Children[2].title).toBe("Prompt:");
      expect(h2Children[3].title).toBe("Response:");

      // First Response should have 2 h3 children
      expect(h2Children[1].children).toHaveLength(2);
      expect(h2Children[1].children[0].title).toBe("1. First point");
      expect(h2Children[1].children[1].title).toBe("2. Second point");

      // Flattened should have correct count
      expect(flat).toHaveLength(7); // 1 h1 + 4 h2 + 2 h3
    });

    it("handles frontmatter with thematic breaks (---) in content after frontmatter", () => {
      // agency-2.md has --- thematic breaks after the frontmatter
      const content = `---
title: Test
---
# Heading

Paragraph before break.

---

Paragraph after break.

## Section

More content.

---

Another break.
`;

      const result = parseMarkdown(content, "test.md");

      expect(result.sections[0].title).toBe("Heading");
      expect(result.sections[0].paragraphs).toHaveLength(2);
      expect(result.sections[0].paragraphs[0]).toBe("Paragraph before break.");
      expect(result.sections[0].paragraphs[1]).toBe("Paragraph after break.");
      expect(result.sections[0].children[0].title).toBe("Section");
    });
  });
});
