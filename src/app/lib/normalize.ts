// app/lib/normalize.ts
/**
 * Normalize text for robust matching while keeping a map back to original indices.
 * - folds diacritics (NFKD, strips \p{M})
 * - lowercases
 * - collapses repeated letters (e.g., "baaaat" -> "bat" if repeatMax = 1)
 *
 * Returned map[i] = index in original string for the i-th char of `norm`.
 */
export type NormMap = { norm: string; map: number[] };

export function normalizeForMatch(
  input: string,
  opts: { foldDiacritics?: boolean; lowercase?: boolean; repeatMax?: number } = {}
): NormMap {
  const fold = opts.foldDiacritics !== false;
  const lower = opts.lowercase !== false;
  const repeatMax = Math.max(1, opts.repeatMax ?? 1);

  const out: string[] = [];
  const map: number[] = [];

  let prev = "";
  let runLen = 0;

  for (let i = 0; i < input.length; i++) {
    let ch = input[i];

    // Fold diacritics (may expand to multiple chars)
    if (fold) {
      const nkfd = ch.normalize("NFKD");
      const stripped = nkfd.replace(/\p{M}+/gu, ""); // remove combining marks
      for (let k = 0; k < stripped.length; k++) {
        const c = lower ? stripped[k].toLowerCase() : stripped[k];
        if (c === prev) {
          if (runLen < repeatMax) {
            out.push(c);
            map.push(i);
            runLen++;
          }
        } else {
          prev = c;
          runLen = 1;
          out.push(c);
          map.push(i);
        }
      }
      continue;
    }

    // No diacritic folding
    const c = lower ? ch.toLowerCase() : ch;
    if (c === prev) {
      if (runLen < repeatMax) {
        out.push(c);
        map.push(i);
        runLen++;
      }
    } else {
      prev = c;
      runLen = 1;
      out.push(c);
      map.push(i);
    }
  }

  return { norm: out.join(""), map };
}

export function toOriginalSpan(normStart: number, normEnd: number, map: number[]) {
  if (map.length === 0) return { start: 0, end: 0 };
  if (normStart >= normEnd) {
    const idx = Math.max(0, Math.min(normStart, map.length - 1));
    const orig = map[idx];
    return { start: orig, end: orig };
  }
  const start = map[Math.max(0, Math.min(normStart, map.length - 1))];
  const endIdx = map[Math.max(0, Math.min(normEnd - 1, map.length - 1))];
  return { start, end: endIdx + 1 };
}
