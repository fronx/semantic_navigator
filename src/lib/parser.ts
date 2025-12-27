import { ParsedArticle, ParsedSection } from "./types";

// Strip YAML frontmatter from markdown
function stripFrontmatter(content: string): string {
  const frontmatterRegex = /^---\n[\s\S]*?\n---\n?/;
  return content.replace(frontmatterRegex, "").trim();
}

// Extract [[wiki-links]] from content
function extractBacklinks(content: string): string[] {
  const linkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  const links: string[] = [];
  let match;
  while ((match = linkRegex.exec(content)) !== null) {
    links.push(match[1]);
  }
  return [...new Set(links)]; // dedupe
}

// Split content into paragraphs by \n\n
function splitParagraphs(content: string): string[] {
  return content
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

// Parse markdown into hierarchical sections
export function parseMarkdown(
  content: string,
  filename: string
): ParsedArticle {
  const cleanContent = stripFrontmatter(content);
  const backlinks = extractBacklinks(cleanContent);

  // Get title from filename (without .md)
  const title = filename.replace(/\.md$/, "");

  // Split by headers
  const headerRegex = /^(#{1,6})\s+(.+)$/gm;
  const sections: ParsedSection[] = [];
  const stack: { section: ParsedSection; level: number }[] = [];

  let lastIndex = 0;
  let preamble = "";
  let match;

  // Reset regex
  headerRegex.lastIndex = 0;

  while ((match = headerRegex.exec(cleanContent)) !== null) {
    const beforeHeader = cleanContent.slice(lastIndex, match.index).trim();
    if (lastIndex === 0 && beforeHeader) {
      preamble = beforeHeader;
    } else if (stack.length > 0 && beforeHeader) {
      const current = stack[stack.length - 1].section;
      current.paragraphs = splitParagraphs(beforeHeader);
      current.content = beforeHeader;
    }

    const level = match[1].length;
    const sectionTitle = match[2];

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
    lastIndex = match.index + match[0].length;
  }

  // Handle remaining content after last header
  const remaining = cleanContent.slice(lastIndex).trim();
  if (remaining && stack.length > 0) {
    const current = stack[stack.length - 1].section;
    current.paragraphs = splitParagraphs(remaining);
    current.content = remaining;
  }

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
  path: string[]; // ancestor titles
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
