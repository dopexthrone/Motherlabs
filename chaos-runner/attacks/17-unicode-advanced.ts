// ATTACK 17: Advanced Unicode Evasion
// Goal: Use Unicode tricks that bypass detection

// Variation selectors (invisible modifiers)
// Normal 'a' followed by variation selector
const disguised = 'a\uFE00ssert'  // Looks like 'assert' but has hidden char

// Combining characters to disguise keywords
const eͤvͮaͣlͥ = 'hidden'  // e + combining chars

// Confusable characters from multiple scripts
// Using characters that LOOK like Latin but aren't in our blocklist
// Mathematical script letters
const 𝚎𝚟𝚊𝚕 = 'math script eval'  // U+1D68E etc

// Fullwidth characters (different from regular)
const ｅｖａｌ = 'fullwidth'  // U+FF45 etc

// Non-breaking space instead of regular space
const exec = 'child\u00A0process'  // NBSP in middle

// Right-to-left isolate to confuse code reading
// The next line contains RLI (U+2067)
const code = '\u2067console.log("safe")\u2069// execSync'

// Tag characters (invisible)
const tagged = 'safe\u{E0065}\u{E0076}\u{E0061}\u{E006C}'  // Hidden 'eval' in tags

// Interleaved zero-width joiners
const hidden = 'e\u200Dv\u200Da\u200Dl'  // eval with ZWJ

export function innocentHelper(x: string): string {
  return x.toLowerCase()
}

// Normal looking export
export const utils = {
  process: innocentHelper,
  disguised,
  hidden,
  code
}
