import { KEYWORD_FONTS } from "@/lib/keyword-fonts";
import fs from "fs";

const uniqueFonts = new Set(Object.values(KEYWORD_FONTS));
const missing: string[] = [];

for (const fontFamily of uniqueFonts) {
  const safeFamily = fontFamily.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
  const path = `./public/fonts/google/${safeFamily}.woff2`;

  if (!fs.existsSync(path)) {
    missing.push(`${fontFamily} -> ${safeFamily}.woff2`);
  }
}

console.log(`Total unique fonts: ${uniqueFonts.size}`);
console.log(`Missing fonts: ${missing.length}`);
if (missing.length > 0) {
  console.log("\nMissing:");
  missing.forEach(f => console.log(`  ${f}`));
}
