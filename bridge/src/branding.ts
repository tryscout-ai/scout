export function normalizeLegacyBranding(text: string | null | undefined) {
  if (!text) return text ?? "";

  return text
    .replace(/\bZANO\b/g, "SCOUT")
    .replace(/\bZano\b/g, "Scout")
    .replace(/\bzano\b/g, "scout");
}
