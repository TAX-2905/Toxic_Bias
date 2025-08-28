export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import type { AnalysisResult, Issue } from "@/app/lib/schema";

// NEW imports (normalizer + lexicon)
import { normalizeForMatch, toOriginalSpan } from "@/app/lib/normalize";
import { LEXICON, OFFENSE_FOR_BUCKET, type Bucket } from "@/app/lib/kmu-lexicon";

// ── Config
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const TIMEOUT_MS = 20_000; // stop if the model takes too long
const MAX_TEXT_CHARS = 8_000; // clip overly long input

// Response schema used by Gemini (string enums for compatibility)  <-- moved up
const responseSchema = {
  type: Type.OBJECT,
  properties: {
    overall_label: { type: Type.STRING, enum: ["safe", "risky", "unsafe"] },
    issues: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          start: { type: Type.INTEGER },
          end: { type: Type.INTEGER },
          quote: { type: Type.STRING },
          offense: {
            type: Type.STRING,
            enum: [
              "toxicity",
              "harassment",
              "hate",
              "violence",
              "sexual",
              "self-harm",
              "bullying",
              "spam",
              "misinformation",
              "bias",
              "stereotype",
            ],
          },
          severity: { type: Type.STRING, enum: ["0", "1", "2", "3"] },
          rationale: { type: Type.STRING },
        },
        required: ["start", "end", "quote", "offense", "severity", "rationale"],
      },
    },
  },
  required: ["overall_label", "issues"],
} as const;

// Deterministic generation config  <-- now safely references responseSchema
const GEN_CFG = {
  responseMimeType: "application/json",
  responseSchema,
  temperature: 0,
  topP: 0,
  topK: 1,
  randomSeed: 0,
} as const;

// Prefer .env.local -> GEMINI_API_KEY=...
if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required");
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// ── Types for parsing Gemini JSON before converting to local schema

type GeminiIssue = {
  start: number;
  end: number;
  quote: string;
  offense: Issue["offense"];
  severity: "0" | "1" | "2" | "3";
  rationale: string;
};

type GeminiAnalysis = {
  overall_label: AnalysisResult["overall_label"];
  issues: GeminiIssue[];
};

// ─────────────────────────────────────────────────────────────────────────────
// NORMALIZATION-AWARE HINTS (dictionary + abbreviations + stereotype pattern)
// ─────────────────────────────────────────────────────────────────────────────

const WORD_BOUNDARY_L = String.raw`(?<!\p{L})`; // left non-letter (Unicode)
const WORD_BOUNDARY_R = String.raw`(?!\p{L})`;  // right non-letter (Unicode)

// Abbreviation helpers (work on already-lowercased strings)
const LETTER_RX = /\p{L}/u;
const VOWEL_RX = /[aeiouy]/u;

function basicNorm(s: string) {
  // fold accents, strip combining marks, lowercase, collapse repeats
  const folded = s.normalize("NFKD").replace(/\p{M}+/gu, "").toLowerCase();
  return folded.replace(/(\p{L})\1+/gu, "$1");
}

function isLetter(ch: string) { return LETTER_RX.test(ch); }
function isVowel(ch: string) { return VOWEL_RX.test(ch); }
function isConsonant(ch: string) { return isLetter(ch) && !isVowel(ch); }

/**
 * e.g. "falourmama" -> keep consonants immediately before vowels + first consonant
 * "falourmama" => f(a) l(o) r(m) m(a) m(a) => "flmm"
 */
function consonantBeforeVowelInitials(w: string) {
  if (!w) return "";
  let out = "";
  for (let i = 0; i < w.length; i++) {
    const c = w[i], n = w[i + 1] ?? "";
    if (i === 0 && isConsonant(c)) out += c;
    else if (isConsonant(c) && isVowel(n)) out += c;
  }
  return out; // ← no collapsing here
}

function noVowels(w: string) {
  return w.replace(VOWEL_RX, ""); // ← no collapsing here (so "gogot" → "ggt")
}

function tokenInitials(w: string) {
  const parts = w.split(/\s+/).filter(Boolean);
  return parts.map(p => basicNorm(p)[0]).filter(Boolean).join(""); // ← no collapsing
}

function makeAbbrevForms(raw: string): string[] {
  const w = basicNorm(raw);
  const variants = new Set<string>();
  const a = consonantBeforeVowelInitials(w);
  const b = noVowels(w);
  if (a.length >= 3 && a !== w) variants.add(a);
  if (b.length >= 3 && b !== w) variants.add(b);
  if (raw.includes(" ")) {
    const c = tokenInitials(raw);
    if (c.length >= 2 && c !== w) variants.add(c);
  }
  return [...variants];
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Compile one regex per bucket using base words + abbreviation variants (all normalized)
const BUCKET_REGEX: Record<Bucket, RegExp> = Object.fromEntries(
  (Object.keys(LEXICON) as Bucket[]).map((bucket) => {
    const altsSet = new Set<string>();

    for (const raw of LEXICON[bucket]) {
      const base = basicNorm(raw);
      if (base.length) altsSet.add(base);
      for (const abbr of makeAbbrevForms(raw)) altsSet.add(abbr);
    }

    const altsEscaped = [...altsSet].map(escapeRe).join("|");
    const pat = altsEscaped
      ? `${WORD_BOUNDARY_L}(?:${altsEscaped})${WORD_BOUNDARY_R}`
      : `a^`; // never matches if empty
    return [bucket, new RegExp(pat, "gu")];
  })
) as Record<Bucket, RegExp>;

// Stereotype window pattern over normalized text
const STEREOTYPE_NORM_RX = new RegExp(
  [
    String.raw`(dimounn?n?|fam|zom|immigran(?:t)?s?|minorite|relizyon|religion|ras|etnisite|ethnicite)`,
    String.raw`[^.!?\n]{0,60}`,
    String.raw`(zot|bizin|doit|should|must|toultan|toujours|jamais|zame)`,
    String.raw`[^.!?\n]{0,60}`,
    String.raw`(parese|lazy|bet|stupid|inferyer|inferieur|kriminel|criminals?|feb|faible|weak)`
  ].join(""),
  "gu"
);

// Hint type (what we send to Gemini in the system instruction)
type Hint = { start: number; end: number; kind: Issue["offense"]; quote: string };

// Build hints on ORIGINAL text, detect on NORMALIZED text, map spans back.
function buildHints(text: string): Hint[] {
  const { norm, map } = normalizeForMatch(text, {
    foldDiacritics: true,
    lowercase: true,
    repeatMax: 2, // ← was 1
  });

  const hints: Hint[] = [];

  // 1) Dictionary pass (per-bucket)
  (Object.keys(BUCKET_REGEX) as Bucket[]).forEach((bucket) => {
    const rx = BUCKET_REGEX[bucket];
    rx.lastIndex = 0;

    let m: RegExpExecArray | null;
    while ((m = rx.exec(norm))) {
      const ns = m.index;
      const ne = m.index + m[0].length;
      const { start, end } = toOriginalSpan(ns, ne, map);
      hints.push({
        start,
        end,
        quote: text.slice(start, end),
        kind: OFFENSE_FOR_BUCKET[bucket],
      });
    }
  });

  // 2) Stereotype pattern
  STEREOTYPE_NORM_RX.lastIndex = 0;
  let sm: RegExpExecArray | null;
  while ((sm = STEREOTYPE_NORM_RX.exec(norm))) {
    const ns = sm.index;
    const ne = ns + sm[0].length;
    const { start, end } = toOriginalSpan(ns, ne, map);
    hints.push({
      start,
      end,
      quote: text.slice(start, end),
      kind: "bias",
    });
  }

  return hints;
}

// ─────────────────────────────────────────────────────────────────────────────
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

// UPDATED: server-side merge keeps single offense (strongest) deterministically
function mergeOverlaps(issues: Issue[]): Issue[] {
  const sorted = [...issues].sort((a, b) => a.start - b.start);
  const out: Issue[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (!last || cur.start > last.end) {
      out.push({ ...cur });
    } else {
      last.end = Math.max(last.end, cur.end);
      if (cur.severity > last.severity) {
        last.offense = cur.offense;
      }
      last.severity = Math.max(last.severity, cur.severity) as 0 | 1 | 2 | 3;
      if (!String(last.offense).includes(String(cur.offense))) {
        // keep comma-joined labels if overlapping categories occur
        // @ts-expect-error allow join for compatibility with existing UI
        last.offense = `${last.offense}, ${cur.offense}`;
      }
      last.rationale = `${last.rationale}\n— ${cur.rationale}`.trim();
      if (cur.quote.length > last.quote.length) last.quote = cur.quote;
    }
  }
  return out;
}

// UPDATED: make overall purely a function of issues (deterministic)
function reconcileOverall(
  _modelLabel: AnalysisResult["overall_label"],
  issues: Issue[]
): AnalysisResult["overall_label"] {
  if (issues.length === 0) return "safe";
  const maxSev = issues.reduce((m, i) => Math.max(m, i.severity), 0);
  if (maxSev >= 3) return "unsafe";
  if (maxSev >= 2 || issues.length >= 2) return "risky";
  return "safe";
}

function toNumberSeverity(s: string | number): 0 | 1 | 2 | 3 {
  const n = typeof s === "string" ? Number(s) : s;
  const clamped = clamp(Number.isFinite(n) ? n : 0, 0, 3);
  return clamped as 0 | 1 | 2 | 3;
}

// UPDATED: accept hints and add heuristic floor + drop invalid spans
function postProcess(gemini: GeminiAnalysis, text: string, hints: Hint[]): AnalysisResult {
  const fixed: Issue[] = gemini.issues
    .map((iss) => {
      let start = clamp(iss.start ?? 0, 0, text.length);
      let end = clamp(iss.end ?? 0, 0, text.length);
      if (end < start) [start, end] = [end, start];

      let quote = text.slice(start, end);
      if (iss.quote && !quote.includes(iss.quote)) {
        const idx = text.indexOf(iss.quote);
        if (idx >= 0) {
          start = idx;
          end = idx + iss.quote.length;
          quote = iss.quote;
        }
      }

      return {
        start,
        end,
        quote: quote.trim(),
        offense: iss.offense,
        severity: toNumberSeverity(iss.severity),
        rationale: (iss.rationale || "").trim(),
      };
    })
    .filter((i) => i.end > i.start && i.quote.length > 0);

  const merged = mergeOverlaps(fixed);

  // Heuristic fallback if model returns nothing but hints exist
  const withFallback =
    merged.length > 0
      ? merged
      : hints.length > 0
      ? hints.slice(0, 3).map((h) => ({
          start: clamp(h.start, 0, text.length),
          end: clamp(h.end, 0, text.length),
          quote: text.slice(h.start, h.end).trim(),
          offense: h.kind,
          severity: 1 as 0 | 1 | 2 | 3,
          rationale: "Heuristic lexicon/stereotype flag",
        }))
      : [];

  const overall = reconcileOverall(gemini.overall_label, withFallback);
  return { overall_label: overall, issues: withFallback };
}

function readTextField(response: unknown): string {
  if (response && typeof response === "object" && "text" in response) {
    const t = (response as { text: unknown }).text;
    if (typeof t === "function") {
      try {
        return (t as () => string)();
      } catch {
        return "";
      }
    }
    if (typeof t === "string") return t;
  }
  return "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Gemini calls (deterministic config + structured hints)
// ─────────────────────────────────────────────────────────────────────────────

async function callGeminiJSON({ text, hints }: { text: string; hints: Hint[] }) {
  const system =
    `Ou pou fer enn klasifikasion sekirite/justis. Retourne JSON VALID ki swiv schema (AUCUN lot text). ` +
    `Donne spans [start,end) 0-indexed lor TEXT ORIZINAL. Severity: 0..3. Si pena problem: issues: [].`;

  // NOTE: no `as const` — keep these arrays mutable to satisfy PartUnion[] typing
  const contents = [
    { role: "user" as const, parts: [{ text: `TEXT:\n${text}` }] },
    { role: "user" as const, parts: [{ text: `HINTS_JSON:\n${JSON.stringify(hints.slice(0, 24))}` }] },
  ];

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents, // mutable arrays
      config: { systemInstruction: system, ...GEN_CFG },
      // @ts-expect-error – some SDK versions don't type `signal`
      signal: controller.signal,
    });

    return readTextField(response);
  } finally {
    clearTimeout(t);
  }
}

// UPDATED: retry uses identical request/config for determinism
async function analyzeWithRepair(text: string, hints: Hint[]): Promise<AnalysisResult> {
  const raw = await callGeminiJSON({ text, hints });
  try {
    const parsed = JSON.parse(raw) as GeminiAnalysis;
    return postProcess(parsed, text, hints);
  } catch {
    // Re-issue the SAME deterministic request (handles transient parse issues)
    const raw2 = await callGeminiJSON({ text, hints });
    const parsed2 = JSON.parse(raw2) as GeminiAnalysis;
    return postProcess(parsed2, text, hints);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  try {
    const { text = "" } = (await req.json().catch(() => ({}))) as { text?: string };

    if (!text.trim()) {
      return NextResponse.json({ error: "Text manke" }, { status: 400 });
    }

    const clipped = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
    const hints = buildHints(clipped);

    const result = await analyzeWithRepair(clipped, hints);
    return NextResponse.json(result);
  } catch (err: unknown) {
    let msg = "Erer servis";
    if (err && typeof err === "object") {
      const e = err as { name?: unknown; message?: unknown };
      const name = typeof e.name === "string" ? e.name : "";
      if (name === "AbortError") msg = `Demann finn depas delai apre ${TIMEOUT_MS}ms`;
      else if (typeof e.message === "string") msg = e.message;
    }
    console.error("/api/analyze error", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
