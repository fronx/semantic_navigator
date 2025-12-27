import { fromMarkdown } from "mdast-util-from-markdown";
import type { Heading, Paragraph, PhrasingContent } from "mdast";
import { ParsedArticle, ParsedSection } from "./types";

// Strip YAML frontmatter from markdown
function stripFrontmatter(content: string): string {
  const frontmatterRegex = /^---\n[\s\S]*?\n---\n?/;
  return content.replace(frontmatterRegex, "").trim();
}

// Fix malformed multi-line linked images (common in Substack exports)
// Converts: [\n\n![](image)\n\n](url) -> [![](image)](url)
function fixMultilineLinkedImages(content: string): string {
  // Match: [ + whitespace + ![alt](image) + whitespace + ](url)
  const pattern = /\[\s*(!\[[^\]]*\]\([^)]*\))\s*\]\(([^)]*)\)/g;
  return content.replace(pattern, "[$1]($2)");
}

// Extract [[wiki-links]] from content
function extractBacklinks(content: string): string[] {
  const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const links: string[] = [];
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    links.push(match[1]);
  }
  return [...new Set(links)];
}

// Extract text content from phrasing content, skipping images
function extractText(nodes: PhrasingContent[]): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      parts.push(node.value);
    } else if (node.type === "image") {
      // Skip images entirely
    } else if ("children" in node) {
      // Recurse into emphasis, strong, link, etc.
      parts.push(extractText(node.children as PhrasingContent[]));
    }
  }
  // Collapse multiple spaces into one (from removed images)
  return parts.join("").replace(/  +/g, " ");
}

// Check if a paragraph has meaningful text content (not just images/whitespace)
function hasMeaningfulText(paragraph: Paragraph): boolean {
  const text = extractText(paragraph.children).trim();
  return text.length > 0;
}

// Parse markdown into hierarchical sections using AST
export function parseMarkdown(
  content: string,
  filename: string
): ParsedArticle {
  const withoutFrontmatter = stripFrontmatter(content);
  const cleanContent = fixMultilineLinkedImages(withoutFrontmatter);
  const backlinks = extractBacklinks(cleanContent);
  const title = filename.replace(/\.md$/, "");

  const tree = fromMarkdown(cleanContent);
  const sections: ParsedSection[] = [];
  const stack: { section: ParsedSection; level: number }[] = [];

  // Collect paragraphs for the current section
  let currentParagraphs: string[] = [];

  function flushParagraphs() {
    if (stack.length > 0 && currentParagraphs.length > 0) {
      const current = stack[stack.length - 1].section;
      current.paragraphs = currentParagraphs;
      current.content = currentParagraphs.join("\n\n");
    }
    currentParagraphs = [];
  }

  for (const node of tree.children) {
    if (node.type === "heading") {
      flushParagraphs();

      const heading = node as Heading;
      const level = heading.depth;
      const sectionTitle = extractText(heading.children as PhrasingContent[]);

      const newSection: ParsedSection = {
        title: sectionTitle,
        level,
        content: "",
        children: [],
        paragraphs: [],
      };

      // Pop stack until we find a parent with lower level
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      if (stack.length === 0) {
        sections.push(newSection);
      } else {
        stack[stack.length - 1].section.children.push(newSection);
      }

      stack.push({ section: newSection, level });
    } else if (node.type === "paragraph") {
      const paragraph = node as Paragraph;
      if (hasMeaningfulText(paragraph)) {
        const text = extractText(paragraph.children).trim();
        if (text) {
          currentParagraphs.push(text);
        }
      }
    }
    // Skip other node types (images, thematic breaks, etc.)
  }

  // Flush any remaining paragraphs
  flushParagraphs();

  return {
    title,
    content: cleanContent,
    sections,
    backlinks,
  };
}

// Flatten sections for easier processing
export interface FlatSection {
  title: string;
  level: number;
  content: string;
  paragraphs: string[];
  path: string[];
}

export function flattenSections(
  sections: ParsedSection[],
  parentPath: string[] = []
): FlatSection[] {
  const result: FlatSection[] = [];

  for (const section of sections) {
    const path = [...parentPath, section.title];
    result.push({
      title: section.title,
      level: section.level,
      content: section.content,
      paragraphs: section.paragraphs,
      path,
    });
    result.push(...flattenSections(section.children, path));
  }

  return result;
}
