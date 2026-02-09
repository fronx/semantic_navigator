const fontBufferCache = new Map<string, Promise<ArrayBuffer>>();
const FALLBACK_FONT = "/fonts/source-code-pro-regular.woff2";

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
        // Font not found - fall back to default font
        if (fontUrl !== FALLBACK_FONT) {
          console.warn(`Font not found: ${fontUrl}, using fallback`);
          fontBufferCache.delete(resolved); // Don't cache the failed attempt
          return loadThreeTextFont(FALLBACK_FONT); // Recursively load fallback
        }
        throw new Error(`Failed to fetch fallback font (${response.status} ${response.statusText})`);
      }
      return response.arrayBuffer();
    })
    .catch((error) => {
      // Only throw if fallback also fails
      if (fontUrl === FALLBACK_FONT) {
        fontBufferCache.delete(resolved);
        throw error;
      }
      // Otherwise fall back to default font
      console.warn(`Error loading font ${fontUrl}:`, error.message, "- using fallback");
      fontBufferCache.delete(resolved);
      return loadThreeTextFont(FALLBACK_FONT);
    });
  fontBufferCache.set(resolved, promise);
  return promise;
}
