import { fromMarkdown } from "mdast-util-from-markdown";
import type {
  Root,
  Content,
  List,
  ListItem,
  Paragraph,
  Heading,
  Blockquote,
  Code,
  Text,
  InlineCode,
} from "mdast";

export interface MarkdownSegment {
  text: string;
  fontSize?: number;
  fontWeight?: string;
  fontStyle?: string;
  fontFamily?: string;
  color?: string;
  lineHeight?: number;
  blockBoundary?: boolean;
}

const BASE_FONT_SIZE = 32;
const PARAGRAPH_FONT_SIZE = 28;
const INLINE_CODE_COLOR = "#fbbf24";
const STRONG_COLOR = "#fefce8";
const EMPHASIS_COLOR = "#c4b5fd";
const CODE_FONT = "JetBrains Mono";

export function renderMarkdownToSegments(markdown: string): MarkdownSegment[] {
  const tree: Root = fromMarkdown(markdown ?? "");
  const segments: MarkdownSegment[] = [];

  for (const node of tree.children) {
    renderBlock(node as Content, segments);
    segments.push({ text: "\n", blockBoundary: true });
  }

  return segments;
}

function renderBlock(node: Content, segments: MarkdownSegment[]) {
  switch (node.type) {
    case "heading":
      pushSegments(
        segments,
        renderInlineSegments(node, {
          fontSize: headingSize(node as Heading),
          fontWeight: "700",
          color: (node as Heading).depth && (node as Heading).depth! <= 2 ? "#fde68a" : undefined,
        })
      );
      break;
    case "paragraph":
      pushSegments(
        segments,
        renderInlineSegments(node as Paragraph, {
          fontSize: PARAGRAPH_FONT_SIZE,
          lineHeight: 1.4,
          color: "#f4f4f5",
        })
      );
      break;
    case "blockquote":
      pushSegments(
        segments,
        renderInlineSegments(node as Blockquote, {
          fontSize: PARAGRAPH_FONT_SIZE,
          fontStyle: "italic",
          color: "#a5b4fc",
        })
      );
      break;
    case "list": {
      const list = node as List;
      list.children?.forEach((item, index) => {
        const listItem = item as ListItem;
        const prefix = list.ordered ? `${index + 1}. ` : "• ";
        segments.push({ text: prefix, fontSize: PARAGRAPH_FONT_SIZE, color: "#e4e4e7" });
        pushSegments(
          segments,
          renderInlineSegments(listItem, {
            fontSize: PARAGRAPH_FONT_SIZE,
            color: "#e4e4e7",
          })
        );
        segments.push({ text: "\n" });
      });
      break;
    }
    case "code": {
      const block = node as Code;
      const text = (block.value ?? "").replace(/\n+$/u, "");
      segments.push({ text, fontSize: 24, fontFamily: CODE_FONT, color: "#93c5fd" });
      break;
    }
    default:
      if ("children" in node && Array.isArray((node as any).children)) {
        pushSegments(segments, renderInlineSegments(node as Paragraph, {}));
      }
      break;
  }
}

interface InlineStyle extends MarkdownSegment {}

function renderInlineSegments(
  node: Paragraph | Heading | ListItem | Blockquote,
  baseStyle: InlineStyle
): MarkdownSegment[] {
  const segs: MarkdownSegment[] = [];
  const children = (node.children ?? []) as Content[];
  children.forEach((child) => {
    segs.push(...renderInline(child, baseStyle));
  });
  return segs;
}

function renderInline(node: Content, inherited: InlineStyle): MarkdownSegment[] {
  switch (node.type) {
    case "text": {
      const textNode = node as Text;
      return [{ ...inherited, text: textNode.value ?? "" }];
    }
    case "strong":
      return flattenChildren(node, {
        ...inherited,
        fontWeight: "700",
        color: STRONG_COLOR,
      });
    case "emphasis":
      return flattenChildren(node, {
        ...inherited,
        fontStyle: "italic",
        color: EMPHASIS_COLOR,
      });
    case "inlineCode":
      return [
        {
          ...inherited,
          text: (node as InlineCode).value ?? "",
          fontFamily: CODE_FONT,
          color: INLINE_CODE_COLOR,
        },
      ];
    case "break":
      return [{ ...inherited, text: "\n" }];
    case "link":
      return flattenChildren(node, { ...inherited, color: "#93c5fd" });
    case "delete":
      return flattenChildren(node, { ...inherited });
    default:
      if ("children" in node && Array.isArray((node as any).children)) {
        return flattenChildren(node, inherited);
      }
      return [];
  }
}

function flattenChildren(node: any, style: InlineStyle): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const children = node.children ?? [];
  for (const child of children) {
    segments.push(...renderInline(child as Content, style));
  }
  return segments;
}

function headingSize(heading: Heading): number {
  const depth = Math.min(6, Math.max(1, heading.depth ?? 1));
  const sizes = [0, 64, 48, 40, 34, 30, 28];
  return sizes[depth] ?? BASE_FONT_SIZE;
}

function pushSegments(target: MarkdownSegment[], newSegments: MarkdownSegment[]) {
  for (const seg of newSegments) {
    if (!seg.text || seg.text.length === 0) continue;
    target.push(seg);
  }
}
