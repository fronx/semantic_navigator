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
});
