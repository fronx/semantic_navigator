# Reader Book Design Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the Reader panel into a comfortable reading surface by rendering markdown, removing chunk_type badges, widening the panel, and applying book-like typography.

**Architecture:** Two changes — a new `.reader-markdown` CSS class in `globals.css` for typography, and updates to `Reader.tsx` to use `ReactMarkdown`, widen the panel, and simplify the active chunk indicator.

**Tech Stack:** React, `react-markdown` (already installed), Tailwind CSS, CSS nesting

---

### Task 1: Add `.reader-markdown` CSS class

**Files:**
- Modify: `src/app/globals.css`

No tests needed for CSS.

**Step 1: Add the class after the `.content-markdown` dark mode block (around line 234)**

Insert this block:

```css
/* Book-like typography for the Reader panel */
.reader-markdown {
  font-size: 15px;
  line-height: 1.7;
  color: inherit;

  p {
    margin: 0.85em 0;
  }

  p:first-child {
    margin-top: 0;
  }

  p:last-child {
    margin-bottom: 0;
  }

  h1, h2, h3, h4, h5, h6 {
    font-weight: 600;
    margin-top: 1.4em;
    margin-bottom: 0.4em;
    line-height: 1.3;
  }

  h1 { font-size: 1.3em; }
  h2 { font-size: 1.15em; }
  h3, h4, h5, h6 { font-size: 1em; }

  strong { font-weight: 600; }
  em { font-style: italic; }

  code {
    background: rgba(0, 0, 0, 0.06);
    padding: 0.15em 0.3em;
    border-radius: 3px;
    font-size: 0.875em;
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
  }

  pre {
    background: rgba(0, 0, 0, 0.06);
    padding: 0.75em 1em;
    border-radius: 4px;
    overflow-x: auto;
    margin: 1em 0;
  }

  pre code {
    background: none;
    padding: 0;
  }

  ul, ol {
    margin: 0.85em 0;
    padding-left: 1.5em;
  }

  li { margin: 0.3em 0; }

  blockquote {
    margin: 0.85em 0;
    padding-left: 0.75em;
    border-left: 3px solid rgba(0, 0, 0, 0.15);
    opacity: 0.85;
  }

  a {
    color: inherit;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  hr {
    border: none;
    border-top: 1px solid rgba(0, 0, 0, 0.1);
    margin: 1.5em 0;
  }
}

@media (prefers-color-scheme: dark) {
  .reader-markdown code {
    background: rgba(255, 255, 255, 0.08);
  }

  .reader-markdown pre {
    background: rgba(255, 255, 255, 0.06);
  }

  .reader-markdown blockquote {
    border-left-color: rgba(255, 255, 255, 0.2);
  }

  .reader-markdown hr {
    border-top-color: rgba(255, 255, 255, 0.1);
  }
}
```

**Step 2: Commit**

```bash
git add src/app/globals.css
git commit -m "style: add reader-markdown book typography class"
```

---

### Task 2: Update Reader.tsx

**Files:**
- Modify: `src/components/Reader.tsx`

No unit tests — this is pure UI. Verify visually in the browser.

**Step 1: Add the ReactMarkdown import at the top**

After the existing imports, add:
```tsx
import ReactMarkdown from "react-markdown";
```

**Step 2: Widen the panel**

In the outer container `className`, change `w-80` to `w-96`:
```
${isOpen ? "w-96" : "w-0"}
```

**Step 3: Update the chunk container**

Replace the chunk `div` className and remove the `chunk_type` badge and the `whitespace-pre-wrap` text div.

Current:
```tsx
<div
  key={chunk.id}
  ref={(el) => { ... }}
  className={`px-3 py-2.5 border-b border-zinc-100 dark:border-zinc-800 ${
    isActiveChunk
      ? "bg-blue-50 dark:bg-blue-950/30 border-l-2 border-l-blue-500"
      : ""
  }`}
>
  {chunk.chunk_type && (
    <span className="inline-block text-xs px-1 py-0.5 mb-1 bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 rounded">
      {chunk.chunk_type}
    </span>
  )}
  <div className="text-sm text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap">
    {chunk.content ?? ""}
  </div>
</div>
```

Replace with:
```tsx
<div
  key={chunk.id}
  ref={(el) => {
    if (el) chunkRefs.current.set(chunk.id, el);
    else chunkRefs.current.delete(chunk.id);
  }}
  className={`px-6 py-6 ${
    isActiveChunk
      ? "border-l-2 border-l-zinc-300 dark:border-l-zinc-600"
      : ""
  }`}
>
  <ReactMarkdown className="reader-markdown">
    {chunk.content ?? ""}
  </ReactMarkdown>
</div>
```

**Step 4: Run type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

**Step 5: Commit**

```bash
git add src/components/Reader.tsx
git commit -m "feat: reader book design - markdown rendering, wider panel, clean chunk layout"
```
