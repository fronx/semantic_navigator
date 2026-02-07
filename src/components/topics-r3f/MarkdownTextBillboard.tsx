/**
 * Minimal Markdown → Text prototype rendered fully inside R3F.
 * Extracts the first Markdown text node and displays it using drei/Text.
 */

import { useMemo } from "react";
import { Billboard } from "@react-three/drei";
import { fromMarkdown } from "mdast-util-from-markdown";
import { visit } from "unist-util-visit";
import type { Root } from "mdast";
import { GraphTextLabel } from "./GraphTextLabel";

const DEFAULT_SAMPLE = [
  "**Semantic Navigator** shows up here to prove the pipeline works.",
  "",
  "Rendering Markdown in **R3F** — no HTML involved.",
  "",
  "_This block lives in 3D space so we can experiment with styling,_",
  "selection, and other interactions later.",
].join("\n");

function collectNodeText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  if ("value" in (node as Record<string, unknown>) && typeof (node as { value?: unknown }).value === "string") {
    return (node as { value: string }).value;
  }
  if ("children" in (node as Record<string, unknown>) && Array.isArray((node as { children?: unknown[] }).children)) {
    return ((node as { children?: unknown[] }).children ?? []).map(child => collectNodeText(child)).join("");
  }
  return "";
}

function extractMarkdownText(markdown: string): string {
  const tree: Root = fromMarkdown(markdown);
  const blocks: string[] = [];

  for (const child of tree.children) {
    const text = collectNodeText(child).trim();
    if (text.length > 0) {
      blocks.push(text);
    }
  }

  if (blocks.length > 0) {
    return blocks.join("\n\n");
  }

  let inlineValue = "";
  visit(tree, (node) => {
    if (
      (node.type === "text" || node.type === "inlineCode") &&
      typeof node.value === "string" &&
      node.value.trim().length > 0
    ) {
      inlineValue = node.value.trim();
      return visit.EXIT;
    }
    return undefined;
  });

  return inlineValue || markdown;
}

export interface MarkdownTextBillboardProps {
  markdown?: string | null;
  /** World-space Z plane for placement (keywords live near z ≈ 0) */
  targetZ?: number;
  /** Optional explicit position override (x, y, z) */
  position?: [number, number, number];
  /** Override default max width for the rendered text */
  maxWidth?: number;
  /** Override default font size for the rendered text */
  fontSize?: number;
  /** Text color */
  color?: string;
  /** Whether to show the prototype block */
  visible?: boolean;
}

export function MarkdownTextBillboard({
  markdown,
  targetZ = 0,
  position,
  maxWidth = 400,
  fontSize = 42,
  color = "#fefce8",
  visible = true,
}: MarkdownTextBillboardProps) {
  const textValue = useMemo(() => {
    const source = markdown && markdown.trim().length > 0 ? markdown : DEFAULT_SAMPLE;
    return extractMarkdownText(source);
  }, [markdown]);

  return visible ? (
    <Billboard position={position ?? [0, 0, targetZ]} follow={false} lockZ>
      <GraphTextLabel
        text={textValue}
        maxWidth={maxWidth}
        fontSize={fontSize}
        color={color}
        lineHeight={1.25}
        outlineWidth={0.05}
      />
    </Billboard>
  ) : null;
}
