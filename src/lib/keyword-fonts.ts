/**
 * Keyword to font family mapping
 *
 * Auto-generated from agentic font matching results.
 * DO NOT EDIT MANUALLY - regenerate with prepare-keyword-fonts.ts
 */

export const KEYWORD_FONTS: Record<string, string> = {
  "curtains": "Dancing Script",
  "spider web": "Eater",
  "inspiration": "Monoton",
  "tourists": "Mountains of Christmas",
  "movement": "Qwitcher Grypen",
  "possibility": "Eater",
  "contrasts": "Bungee",
  "expectation": "Merriweather",
  "fear": "Creepster",
  "compassion": "Fira Sans",
  "entitlement": "Parisienne",
  "facades": "Dancing Script",
  "machine": "Orbitron",
  "distrust": "Syne Mono",
  "image": "Great Vibes",
  "patchwork": "Eater",
  "illusion": "Creepster",
  "oneness": "Open Sans",
  "impulses": "Oregano",
  "hand": "Kalam",
  "benefit": "Merriweather",
  "conformity": "Oswald",
  "maze": "Architects Daughter",
  "high": "Dancing Script",
  "completion": "Merriweather",
  "discovery": "Syne Mono",
  "shapeshifting": "Rubik Glitch",
  "Absolute": "Ubuntu",
  "stories": "Great Vibes",
  "otherness": "Creepster",
  "ambition": "Merriweather",
  "smile": "Indie Flower",
  "satisfaction": "Merriweather",
  "attractor": "Eater",
  "psychedelics": "Cabin Sketch",
  "exploration": "Permanent Marker",
  "momentum": "Knewave",
  "indifference": "Rubik",
  "structure": "Teko",
  "belief": "Merriweather",
  "misogyny": "Creepster",
  "appearance": "Italianno",
  "subscription": "Merriweather",
  "potential": "Bungee Spice",
  "public": "Fira Sans",
  "feedback": "Merriweather",
  "projection": "Syne Mono",
  "social context": "Playfair Display",
  "joy": "Indie Flower",
  "destruction": "Creepster",
  "sense-making": "Readex Pro",
  "identification": "Roboto",
  "regularity": "Roboto",
  "embodiment": "Fira Sans",
  "breathe": "Open Sans",
  "familiarity": "Playfair Display",
  "gender": "Merriweather Sans",
  "autistic": "Creepster",
  "bliss": "Indie Flower",
  "experience": "Merriweather",
  "finding": "Monoton",
  "history": "Libre Baskerville",
  "types": "DM Sans",
  "connection": "Monoton",
  "intuition": "Archivo",
  "doodling": "Indie Flower",
  "demonstration": "Roboto",
  "grammatical": "Oswald",
  "alcohol": "Dancing Script",
  "constraint": "Ubuntu",
  "interaction": "Caveat",
  "belonging": "Playfair Display"
};

/**
 * Get font path for a keyword or cluster label
 * Returns path to .woff2 file in /public/fonts/google/
 */
export function getFontPath(keyword: string): string {
  const fontFamily = KEYWORD_FONTS[keyword];
  if (!fontFamily) {
    return "/fonts/source-code-pro-regular.woff2"; // fallback
  }

  // Convert font family to safe filename
  const safeFamily = fontFamily.replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
  return `/fonts/google/${safeFamily}.woff2`;
}
