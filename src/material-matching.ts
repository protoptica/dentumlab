import type { Material } from "./domain";
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .match(/[\p{L}\p{N}]+/gu)
    ?.filter(
      (w) =>
        w.length > 1 &&
        !["для", "шт", "мм", "mm", "ml", "мл", "the", "and"].includes(w),
    ) || [];
export function matchingMaterials(
  materials: Material[],
  name: string,
  selected: string | null,
) {
  const query = new Set(words(name));
  return materials
    .map((m) => {
      const tokens = new Set(words(m.name));
      const overlap = [...query].filter((w) => tokens.has(w)).length;
      const score = overlap / Math.max(1, Math.min(query.size, tokens.size));
      return { m, score, overlap };
    })
    .filter(
      (x) =>
        x.m.id === selected ||
        (x.overlap >= 2 && x.score >= 0.5) ||
        (query.size === 1 && x.overlap === 1),
    )
    .sort((a, b) => b.score - a.score || a.m.name.localeCompare(b.m.name, "ru"))
    .map((x) => x.m);
}
