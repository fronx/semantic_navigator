/** Module-level registry: chunkId → CSS color string. Written by ChunksScene, read by Reader. */
const chunkColors = new Map<string, string>();

export function setChunkColor(chunkId: string, color: string): void {
  chunkColors.set(chunkId, color);
}

export function getChunkColor(chunkId: string): string | undefined {
  return chunkColors.get(chunkId);
}

export function setChunkColors(entries: [string, string][]): void {
  chunkColors.clear();
  for (const [id, color] of entries) chunkColors.set(id, color);
}
