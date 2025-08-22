export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { GoogleGenAI, Type } from "@google/genai";
import type { AnalysisResult, Issue } from "@/app/lib/schema";

// ── Config
const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const TIMEOUT_MS = 20_000; // stop if the model takes too long
const MAX_TEXT_CHARS = 8000; // clip overly long input

// Prefer .env.local -> GEMINI_API_KEY=...
if (!process.env.GEMINI_API_KEY) {
  throw new Error("GEMINI_API_KEY is required");
}
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Response schema used by Gemini (string enums for compatibility)
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

// ── Lightweight heuristics to provide model hints (conservative)
const RX = {
  insults:
    /\b(bet|bete|kouyon|koyon|kretin|bourik|idiot|stupid|stupide|moron|perdant|loser|sal|malprop|garbag|trash|clueless)\b/gi,
  threats:
    /\b(touy|tue|kill|fer\s+dimal|hurt|bat|baté?|beat|atake|attack|brile|burn|tir|shoot|detwi|detruire|destroy|menas|menace|threaten)\b/gi,
  violence: /\b(vyolans|violence|mor|lamor|mori|die|death|lynch|linch)\b/gi,
  stereotypes:
    /(dimounn?\s*sorti\s*depi|dimounn?|fam|zom|imigran|immigrants?|minorite|relizyon|religion|ras|etnisite|ethnicit[eé]?)[^.!?]{0,60}\b(zot|bizin|bizwin|fode|faut|toultan|touzour|toujours|zame|jamais|doit|should|must)\b[^.!?]{0,60}\b(parese|paresi|lazy|bet|stupid|inferyer|inferieur|criminals?|kriminel|feb|faible|weak)\b/gi,
};

type Hint = { start: number; end: number; kind: Issue["offense"]; quote: string };

function findMatches(text: string, re: RegExp, kind: Hint["kind"], window = 24): Hint[] {
  const out: Hint[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const s = Math.max(0, m.index - window);
    const e = Math.min(text.length, m.index + (m[0]?.length || 0) + window);
    out.push({ start: s, end: e, kind, quote: text.slice(s, e) });
  }
  return out;
}

function buildHints(text: string): Hint[] {
  return [
    ...findMatches(text, RX.insults, "harassment"),
    ...findMatches(text, RX.threats, "violence"),
    ...findMatches(text, RX.violence, "violence"),
    ...findMatches(text, RX.stereotypes, "bias", 40),
  ];
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function mergeOverlaps(issues: Issue[]): Issue[] {
  const sorted = [...issues].sort((a, b) => a.start - b.start);
  const out: Issue[] = [];
  for (const cur of sorted) {
    const last = out[out.length - 1];
    if (!last || cur.start > last.end) {
      out.push({ ...cur });
    } else {
      last.end = Math.max(last.end, cur.end);
      last.severity = Math.max(last.severity, cur.severity) as 0 | 1 | 2 | 3;
      if (!last.offense.includes(cur.offense)) last.offense += `, ${cur.offense}`;
      last.rationale = `${last.rationale}\n— ${cur.rationale}`.trim();
      if (cur.quote.length > last.quote.length) last.quote = cur.quote;
    }
  }
  return out;
}

function reconcileOverall(modelLabel: AnalysisResult["overall_label"], issues: Issue[]): AnalysisResult["overall_label"] {
  const maxSev = issues.reduce((m, i) => Math.max(m, i.severity), 0);
  if (maxSev >= 3) return "unsafe";
  if (maxSev === 2 || issues.length >= 2) return modelLabel === "safe" ? "risky" : modelLabel;
  return modelLabel;
}

function toNumberSeverity(s: string | number): 0 | 1 | 2 | 3 {
  const n = typeof s === "string" ? Number(s) : s;
  const clamped = clamp(Number.isFinite(n) ? n : 0, 0, 3);
  return clamped as 0 | 1 | 2 | 3;
}

function postProcess(gemini: GeminiAnalysis, text: string): AnalysisResult {
  const fixed: Issue[] = gemini.issues.map((iss) => {
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
  });

  const merged = mergeOverlaps(fixed);
  const overall = reconcileOverall(gemini.overall_label, merged);
  return { overall_label: overall, issues: merged };
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

async function callGeminiJSON({ text, hints }: { text: string; hints: Hint[] }) {
  const system =
    `To enn evalyatris bien strik pou sekirite ek zistis (fairness) pou text ki utilizater fer. Retourne JSON avek bann spans kot ena konteni problematik pou ed enn moderater imen.\n\n` +
    `Regleman:\n` +
    `- Detekte: toxicity (insilt, azirman), haine/bias (klas proteze, stereotip), menas/violans, seksual (inklir minor), self-harm, bullying, spam, lenformasion fos (misinformation), bias, stereotip.\n` +
    `- Donn exak pozision karakte [start,end) dan TEXT ORIZINAL (0-indexed, JS slicing).\n` +
    `- Gard "quote" kourt; prefer fraz minim ki ofansan.\n` +
    `- Severity: 0=inofansif, 1=ba, 2=moyen, 3=ot (retir/escalade).\n` +
    `- Reste konservatif me pa rate bann violasion evidan.\n` +
    `- Si pena nanye problematik: retourne issues: [].`;

  const hintLines = hints
    .slice(0, 12)
    .map(
      (h, i) => `#${i + 1} ${h.kind} @ ${h.start}-${h.end}: "${h.quote.replace(/\n/g, " ").slice(0, 120)}"`
    )
    .join("\n");
  const hintBlock = hints.length ? `\n\nIndikasion eiristik (kapav inkomplé; verifye bien):\n${hintLines}` : "";

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await ai.models.generateContent({
      model: MODEL,
      contents: [{ role: "user", parts: [{ text }] }],
      config: {
        systemInstruction: system + hintBlock,
        responseMimeType: "application/json",
        responseSchema,
        temperature: 0.2,
      },
      // @ts-expect-error – some SDK versions don't type `signal`
      signal: controller.signal,
    });

    return readTextField(response);
  } finally {
    clearTimeout(t);
  }
}

async function analyzeWithRepair(text: string, hints: Hint[]): Promise<AnalysisResult> {
  const raw = await callGeminiJSON({ text, hints });
  try {
    const parsed = JSON.parse(raw) as GeminiAnalysis;
    return postProcess(parsed, text);
  } catch {
    // fall through
  }

  const stricter = `Retourne SELMAN JSON valid. Pa met okenn komanter ouswa markdown. Servi exak non-la-champs ek tip valer dan schema.`;
  const response2 = await ai.models.generateContent({
    model: MODEL,
    contents: [
      { role: "user", parts: [{ text: `Text pou analiz:\n${text}` }] },
      { role: "user", parts: [{ text: `Servi sa schema-la ek prodwir JSON selman.` }] },
    ],
    config: {
      systemInstruction: stricter,
      responseMimeType: "application/json",
      responseSchema,
      temperature: 0.1,
    },
  });

  const raw2 = readTextField(response2);
  const parsed2 = JSON.parse(raw2) as GeminiAnalysis;
  return postProcess(parsed2, text);
}

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
