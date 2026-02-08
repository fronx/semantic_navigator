const fontBufferCache = new Map<string, Promise<ArrayBuffer>>();

function resolveFontUrl(fontUrl: string): string {
  if (fontUrl.startsWith("http://") || fontUrl.startsWith("https://")) {
    return fontUrl;
  }
  if (typeof window === "undefined") {
    return fontUrl;
  }
  const base = window.location?.origin ?? "";
  return new URL(fontUrl, base).toString();
}

export function loadThreeTextFont(fontUrl: string): Promise<ArrayBuffer> {
  const resolved = resolveFontUrl(fontUrl);
  if (fontBufferCache.has(resolved)) {
    return fontBufferCache.get(resolved)!;
  }
  const promise = fetch(resolved)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`Failed to fetch font (${response.status} ${response.statusText})`);
      }
      return response.arrayBuffer();
    })
    .catch((error) => {
      fontBufferCache.delete(resolved);
      throw error;
    });
  fontBufferCache.set(resolved, promise);
  return promise;
}
