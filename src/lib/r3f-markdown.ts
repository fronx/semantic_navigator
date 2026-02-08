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
const CODE_FONT = "JetBrains Mono";

export interface ContentTextColors {
  text: string;
  heading: string;
  strong: string;
  emphasis: string;
  code: string;
  inlineCode: string;
  link: string;
  blockquote: string;
  list: string;
}

const LIGHT_COLORS: ContentTextColors = {
  text: "#f4f4f5",
  heading: "#fde68a",
  strong: "#fefce8",
  emphasis: "#c4b5fd",
  code: "#93c5fd",
  inlineCode: "#fbbf24",
  link: "#93c5fd",
  blockquote: "#a5b4fc",
  list: "#e4e4e7",
};

const DARK_COLORS: ContentTextColors = {
  text: "#000000",
  heading: "#000000",
  strong: "#000000",
  emphasis: "#000000",
  code: "#000000",
  inlineCode: "#000000",
  link: "#000000",
  blockquote: "#000000",
  list: "#000000",
};

export function readContentTextColors(): ContentTextColors {
  if (typeof document === "undefined") return LIGHT_COLORS;
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  return isDark ? DARK_COLORS : LIGHT_COLORS;
}

export function renderMarkdownToSegments(markdown: string, colors?: ContentTextColors): MarkdownSegment[] {
  const c = colors ?? readContentTextColors();
  const tree: Root = fromMarkdown(markdown ?? "");
  const segments: MarkdownSegment[] = [];

  for (const node of tree.children) {
    renderBlock(node as Content, segments, c);
    segments.push({ text: "\n", blockBoundary: true });
  }

  return segments;
}

function renderBlock(node: Content, segments: MarkdownSegment[], colors: ContentTextColors) {
  switch (node.type) {
    case "heading":
      pushSegments(
        segments,
        renderInlineSegments(node, {
          fontSize: headingSize(node as Heading),
          fontWeight: "700",
          color: (node as Heading).depth && (node as Heading).depth! <= 2 ? colors.heading : undefined,
        }, colors)
      );
      break;
    case "paragraph":
      pushSegments(
        segments,
        renderInlineSegments(node as Paragraph, {
          fontSize: PARAGRAPH_FONT_SIZE,
          lineHeight: 1.4,
          color: colors.text,
        }, colors)
      );
      break;
    case "blockquote":
      pushSegments(
        segments,
        renderInlineSegments(node as Blockquote, {
          fontSize: PARAGRAPH_FONT_SIZE,
          fontStyle: "italic",
          color: colors.blockquote,
        }, colors)
      );
      break;
    case "list": {
      const list = node as List;
      list.children?.forEach((item, index) => {
        const listItem = item as ListItem;
        const prefix = list.ordered ? `${index + 1}. ` : "• ";
        segments.push({ text: prefix, fontSize: PARAGRAPH_FONT_SIZE, color: colors.list });
        pushSegments(
          segments,
          renderInlineSegments(listItem, {
            fontSize: PARAGRAPH_FONT_SIZE,
            color: colors.list,
          }, colors)
        );
        segments.push({ text: "\n" });
      });
      break;
    }
    case "code": {
      const block = node as Code;
      const text = (block.value ?? "").replace(/\n+$/u, "");
      segments.push({ text, fontSize: 24, fontFamily: CODE_FONT, color: colors.code });
      break;
    }
    default:
      if ("children" in node && Array.isArray((node as any).children)) {
        pushSegments(segments, renderInlineSegments(node as unknown as Paragraph, {}, colors));
      }
      break;
  }
}

type InlineStyle = Omit<MarkdownSegment, "text">;

function renderInlineSegments(
  node: Paragraph | Heading | ListItem | Blockquote,
  baseStyle: InlineStyle,
  colors: ContentTextColors
): MarkdownSegment[] {
  const segs: MarkdownSegment[] = [];
  const children = (node.children ?? []) as Content[];
  children.forEach((child) => {
    segs.push(...renderInline(child, baseStyle, colors));
  });
  return segs;
}

function renderInline(node: Content, inherited: InlineStyle, colors: ContentTextColors): MarkdownSegment[] {
  switch (node.type) {
    case "text": {
      const textNode = node as Text;
      return [{ ...inherited, text: textNode.value ?? "" }];
    }
    case "strong":
      return flattenChildren(node, {
        ...inherited,
        fontWeight: "700",
        color: colors.strong,
      }, colors);
    case "emphasis":
      return flattenChildren(node, {
        ...inherited,
        fontStyle: "italic",
        color: colors.emphasis,
      }, colors);
    case "inlineCode":
      return [
        {
          ...inherited,
          text: (node as InlineCode).value ?? "",
          fontFamily: CODE_FONT,
          color: colors.inlineCode,
        },
      ];
    case "break":
      return [{ ...inherited, text: "\n" }];
    case "link":
      return flattenChildren(node, { ...inherited, color: colors.link }, colors);
    case "delete":
      return flattenChildren(node, { ...inherited }, colors);
    default:
      if ("children" in node && Array.isArray((node as any).children)) {
        return flattenChildren(node, inherited, colors);
      }
      return [];
  }
}

function flattenChildren(node: any, style: InlineStyle, colors: ContentTextColors): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  const children = node.children ?? [];
  for (const child of children) {
    segments.push(...renderInline(child as Content, style, colors));
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
