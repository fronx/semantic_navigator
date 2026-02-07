import { Text } from "three-text/three";
import { woff2Decode } from "woff-lib/woff2/decode";

let initialized = false;

export function ensureThreeTextInitialized() {
  if (initialized) return;
  if (typeof window === "undefined") return;

  Text.setHarfBuzzPath("/hb/hb.wasm");
  Text.enableWoff2(woff2Decode);
  initialized = true;
}
