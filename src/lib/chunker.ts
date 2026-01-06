import { anthropic } from "./llm";

export interface Chunk {
  content: string;
  position: number;
  headingContext: string[];
  chunkType?: string;
  keywords: string[];
}

interface ExtractedChunk {
  text: string;
  type?: string;
  keywords: string[];
}

interface ExtractionResult {
  chunks: ExtractedChunk[];
  remainder: string; // Text at end that couldn't be cleanly chunked
  summary: string; // Brief summary for context handover
}

const CHUNK_SYSTEM_PROMPT = `You help segment text into semantic chunks for a navigator that renders documents as a 2D map with zoom in/out operations along semantic connections.

A good chunk is a complete thought - an argument, example, or dialog turn. Aim for 500-1500 tokens. Headings naturally start new chunks.

Keywords are how chunks connect to each other across documents. Good keywords are:
- Specific terms defined or introduced in the text (e.g., "gradient descent", "cache invalidation")
- Named references: people, frameworks, theories (e.g., "Shannon entropy", "Kahneman")
- Domain-specific phrases that would connect to other documents

Avoid generic/meta keywords like "synthesis", "outline", "introduction" - these describe the text's structure rather than its content.

If you're unsure where a thought ends, put the uncertain portion in "remainder" for the next pass.`;

const CHUNK_USER_PROMPT = `Please segment this text into chunks. Return a JSON object:

{"chunks":[{"text":"verbatim chunk text","type":"problem statement","keywords":["specific phrase"]}],"remainder":"text at end if incomplete","summary":"brief context for next pass"}

IMPORTANT: The "text" field must be copied VERBATIM from the input - never summarize or paraphrase. If you can't fit all chunks, put the remaining text in "remainder" (also verbatim). For type, use natural phrases like "problem statement" or "worked example".

TEXT:
`;

// Estimate tokens (rough: 1 token ≈ 4 chars for English)
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// Parse headings from text to track context
function extractHeadingContext(text: string): string[] {
  const headings: string[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const title = match[2].trim();
      // Keep only headings at this level and above
      while (headings.length >= level) {
        headings.pop();
      }
      headings.push(title);
    }
  }
  return headings;
}

// Try to repair common JSON issues (invalid escapes like \.)
function tryRepairJson(jsonText: string): string {
  // Fix invalid escape sequences like \. or \: (Haiku sometimes escapes markdown)
  // Valid JSON escapes are: \" \\ \/ \b \f \n \r \t \uXXXX
  // Replace \X (where X is not a valid escape char) with just X
  return jsonText.replace(/\\([^"\\\/bfnrtu])/g, "$1");
}

// Parse JSON from Haiku's response, extracting from code blocks if needed
function parseJsonResponse(text: string): {
  chunks: Array<{ text: string; type?: string; keywords?: string[] }>;
  remainder: string;
  summary: string;
} {
  let jsonText = text.trim();

  // Try markdown code block first
  const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    jsonText = codeBlockMatch[1].trim();
  } else {
    // Try to find JSON object in the response
    const jsonStart = jsonText.indexOf("{");
    const jsonEnd = jsonText.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd > jsonStart) {
      jsonText = jsonText.slice(jsonStart, jsonEnd + 1);
    }
  }

  // Always try repair first (handles invalid escapes, newlines, etc.)
  const repaired = tryRepairJson(jsonText);
  return JSON.parse(repaired);
}

// Call Haiku to extract semantic chunks
async function extractChunks(
  text: string,
  windowIndex: number,
  priorContext?: string // Summary from previous window for continuity
): Promise<ExtractionResult> {
  console.log(`  [Haiku] Window ${windowIndex}: ${text.length} chars (~${estimateTokens(text)} tokens)${priorContext ? " (with context)" : ""}`);

  const contextPrefix = priorContext
    ? `CONTEXT FROM PREVIOUS TEXT:\n${priorContext}\n\n---\n\nNow continue chunking the following text:\n\n`
    : "";

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [
    {
      role: "user",
      content: CHUNK_USER_PROMPT + contextPrefix + text,
    },
  ];

  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await anthropic.messages.create({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 8192,
      system: CHUNK_SYSTEM_PROMPT,
      messages,
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type from Haiku");
    }

    try {
      const result = parseJsonResponse(content.text);

      return {
        chunks: result.chunks.map((c) => ({
          text: c.text,
          type: c.type,
          keywords: c.keywords || [],
        })),
        remainder: result.remainder || "",
        summary: result.summary || "",
      };
    } catch (parseError) {
      if (attempt < maxRetries) {
        const errorMsg = parseError instanceof Error ? parseError.message : String(parseError);
        console.log(`  [Retry ${attempt + 1}] JSON parse error: ${errorMsg}`);

        // Show context around the error position
        const posMatch = errorMsg.match(/position (\d+)/);
        if (posMatch) {
          const pos = parseInt(posMatch[1], 10);
          const start = Math.max(0, pos - 100);
          const end = Math.min(content.text.length, pos + 100);
          const context = content.text.slice(start, end);
          const marker = " ".repeat(Math.min(100, pos - start)) + "^";
          console.log(`  [Context around error position ${pos}]:`);
          console.log(`  ${JSON.stringify(context)}`);
          console.log(`  ${marker}`);
        }

        // Add the failed response and error to conversation for retry
        messages.push({ role: "assistant", content: content.text });
        messages.push({
          role: "user",
          content: `JSON parse error: ${errorMsg}

This usually means there's an unescaped quote (") or newline in one of the text fields. In JSON strings, quotes must be \\" and newlines must be \\n.

Please try again, making sure to properly escape special characters in the text fields.`,
        });
      } else {
        throw parseError;
      }
    }
  }

  throw new Error("Failed to get valid JSON after retries");
}

// Main chunking function - processes text and yields chunks
export async function* chunkText(
  text: string,
  options?: { windowSize?: number }
): AsyncGenerator<Chunk> {
  const windowSize = options?.windowSize ?? 8000; // ~2000 tokens per window
  let position = 0;
  let chunkIndex = 0;
  let windowIndex = 0;
  let currentHeadings: string[] = [];

  // State carried between windows
  let remainder = "";
  let priorContext: string | undefined;

  while (position < text.length || remainder.length > 0) {
    // Build window: remainder from previous + fresh text
    const freshEnd = Math.min(position + windowSize - remainder.length, text.length);
    const freshText = text.slice(position, freshEnd);
    const window = remainder + freshText;

    const isLastWindow = freshEnd >= text.length;

    // Get chunks from Haiku
    windowIndex++;
    const result = await extractChunks(window, windowIndex, priorContext);

    if (result.chunks.length === 0 && isLastWindow) {
      // Final window with no chunks - emit remainder as one chunk
      if (window.trim().length > 0) {
        const headings = extractHeadingContext(window);
        yield {
          content: window,
          position: chunkIndex++,
          headingContext: [...currentHeadings, ...headings],
          keywords: [],
        };
      }
      break;
    }

    // Yield each extracted chunk
    for (const extracted of result.chunks) {
      if (extracted.text.trim().length > 0) {
        const headings = extractHeadingContext(extracted.text);
        yield {
          content: extracted.text,
          position: chunkIndex++,
          headingContext: [...currentHeadings, ...headings],
          chunkType: extracted.type,
          keywords: extracted.keywords,
        };
        if (headings.length > 0) {
          currentHeadings = headings;
        }
      }
    }

    // Carry forward state for next window
    remainder = result.remainder;
    priorContext = result.summary;
    position = freshEnd;

    // Log handover state for debugging
    if (result.summary) {
      console.log(`  [Handover] Summary: ${result.summary}`);
    }
    if (result.remainder) {
      console.log(`  [Handover] Remainder: ${result.remainder.length} chars`)
    }

    // If this was the last window and there's still remainder, flush it
    if (isLastWindow && remainder.trim().length > 0) {
      const headings = extractHeadingContext(remainder);
      yield {
        content: remainder,
        position: chunkIndex++,
        headingContext: [...currentHeadings, ...headings],
        chunkType: "remainder",
        keywords: [],
      };
      break;
    }
  }
}

// Convenience function to collect all chunks
export async function chunkTextToArray(
  text: string,
  options?: { windowSize?: number }
): Promise<Chunk[]> {
  const chunks: Chunk[] = [];
  for await (const chunk of chunkText(text, options)) {
    chunks.push(chunk);
  }
  return chunks;
}
