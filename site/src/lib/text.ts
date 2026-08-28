// Strapi richtext fields come back as plain/markdown-ish text, not HTML.
// Split on blank lines so multi-paragraph copy still reads as paragraphs
// rather than one run-on block.
export function paragraphs(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}
