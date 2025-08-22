"use client";

import React, { useMemo, useState } from "react";
import { Shield, Wand2, XCircle, Loader2 } from "lucide-react";
import type { AnalysisResult, Issue } from "../lib/schema";

// Palet: neutre kalm avek ti tint dapre severite
const SEVERITY_STYLE: Record<number, string> = {
  0: "bg-emerald-50 ring-emerald-200 text-emerald-800",
  1: "bg-amber-50 ring-amber-200 text-amber-800",
  2: "bg-orange-50 ring-orange-200 text-orange-800",
  3: "bg-rose-50 ring-rose-200 text-rose-800",
};

// Afisaz lokalize (UI) — pena okenn sanzman lor done/API
const OVERALL_LABELS: Record<AnalysisResult["overall_label"], string> = {
  safe: "An sekirite",
  risky: "Riske",
  unsafe: "Pa an sekirite",
};

const OFFENSE_LABELS: Record<Issue["offense"], string> = {
  toxicity: "Toksisite",
  harassment: "Arasman",
  hate: "Lenn",
  violence: "Vyolans",
  sexual: "Seksiel",
  "self-harm": "Blese limem (self-harm)",
  bullying: "Entimidasyon",
  spam: "Spam",
  misinformation: "Lenformasion fos",
  bias: "Biaz",
  stereotype: "Stereotip",
};

function mergeOverlaps(issues: Issue[]): Issue[] {
  const sorted = [...issues].sort((a, b) => a.start - b.start);
  const out: Issue[] = [];
  for (const cur of sorted) {
    const prev = out[out.length - 1];
    if (!prev || cur.start > prev.end) {
      out.push({ ...cur });
    } else {
      prev.end = Math.max(prev.end, cur.end);
      prev.severity = Math.max(prev.severity, cur.severity) as 0 | 1 | 2 | 3;
      if (!prev.offense.includes(cur.offense)) prev.offense += `, ${cur.offense}`;
      prev.rationale = `${prev.rationale}\n— ${cur.rationale}`;
    }
  }
  return out;
}

function Segmented({ text, issues }: { text: string; issues: Issue[] }) {
  const segments = useMemo(() => {
    const merged = mergeOverlaps(issues);
    const segs: Array<{ key: string; text: string; issue?: Issue }> = [];
    let i = 0;
    for (let k = 0; k < merged.length; k++) {
      const iss = merged[k];
      if (iss.start > i) segs.push({ key: `t-${i}`, text: text.slice(i, iss.start) });
      segs.push({ key: `h-${k}`, text: text.slice(iss.start, iss.end), issue: iss });
      i = iss.end;
    }
    if (i < text.length) segs.push({ key: `tail-${i}`, text: text.slice(i) });
    return segs;
  }, [text, issues]);

  return (
    <div className="prose prose-zinc max-w-none">
      <p className="whitespace-pre-wrap leading-8 text-zinc-900 text-[17px]">
        {segments.map((s) =>
          s.issue ? (
            <mark
              key={s.key}
              className={`rounded-xl ring-1 px-1 py-0.5 mx-0.5 ${SEVERITY_STYLE[s.issue.severity]} underline decoration-dotted`}
              title={`${OFFENSE_LABELS[s.issue.offense]} (gravite ${s.issue.severity})\n${s.issue.rationale}`}
            >
              {s.text}
            </mark>
          ) : (
            <span key={s.key}>{s.text}</span>
          )
        )}
      </p>
    </div>
  );
}

function Summary({ result }: { result: AnalysisResult }) {
  const counts = result.issues.reduce(
    (acc, it) => (acc[it.severity]++, acc),
    { 0: 0, 1: 0, 2: 0, 3: 0 } as Record<0 | 1 | 2 | 3, number>
  );
  const pill =
    result.overall_label === "unsafe"
      ? "bg-rose-50 border-rose-200 text-rose-800"
      : result.overall_label === "risky"
      ? "bg-amber-50 border-amber-200 text-amber-800"
      : "bg-emerald-50 border-emerald-200 text-emerald-800";

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className={`rounded-2xl border p-4 ${pill}`}>
        <div className="text-sm">Feedback zeneral</div>
        <div className="text-2xl font-semibold mt-1">{OVERALL_LABELS[result.overall_label]}</div>
      </div>
      <div className="rounded-2xl border p-4 bg-white">
        <div className="text-sm text-zinc-600">Kont severite</div>
        <div className="mt-2 flex gap-2">
          {[0, 1, 2, 3].map((s) => (
            <div key={s} className={`rounded-xl ring-1 px-3 py-2 text-sm ${SEVERITY_STYLE[s]}`}>
              <span className="font-semibold mr-1">{s}</span>
              {counts[s as 0 | 1 | 2 | 3]}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  async function analyze() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`Erer API ${res.status}`);
      const data: AnalysisResult = await res.json();
      setResult(data);
    } catch (e: any) {
      setError(e?.message ?? "Erer inkoni");
    } finally {
      setLoading(false);
    }
  }

  function resetAll() {
    setText("");
    setResult(null);
    setError(null);
  }

  return (
    <main className="min-h-dvh bg-gradient-to-b from-zinc-50 to-white">
      <div className="mx-auto max-w-4xl px-6 py-14">
        {/* Header */}
        <header className="text-center mb-10">
          <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-zinc-900 text-white grid place-items-center shadow-sm">
            <Shield size={24} />
          </div>
          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">ToxiBias Test</h1>
        </header>

        {/* Kart Antre */}
        <section className="rounded-3xl border bg-white shadow-sm p-6 md:p-8 mb-8">
          <label htmlFor="input" className="block text-sm font-medium text-zinc-700 mb-2">
            Paragraph
          </label>
          <textarea
            id="input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Met 1 text ici pou analizer…"
            className="w-full h-56 md:h-64 rounded-2xl border border-zinc-200 focus:ring-2 focus:ring-zinc-900/10 focus:outline-none p-5 bg-zinc-50/40 text-[16px] leading-7"
          />

          {/* Aksion */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={analyze}
              disabled={loading || !text.trim()}
              className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 text-white px-5 py-3 text-base font-medium shadow hover:bg-black disabled:opacity-40"
            >
              {loading ? <Loader2 className="animate-spin" size={18} /> : <Wand2 size={18} />}
              {loading ? "Pe analiz…" : "Analize"}
            </button>
            <button
              onClick={resetAll}
              className="inline-flex items-center gap-2 rounded-2xl bg-white border px-4 py-2 text-sm hover:bg-zinc-100"
            >
              <XCircle size={16} /> Reffacer
            </button>
          </div>
        </section>

        {/* Rezilta */}
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 flex items-start gap-2 mb-8">
            <XCircle className="mt-0.5" size={18} /> {error}
          </div>
        )}

        {!result && !error && (
          <section className="rounded-3xl border bg-white p-8 text-zinc-600 text-center">
            <p className="text-lg">Lans enn analiz pou gete bann parti ki pa appropriate.</p>
          </section>
        )}

        {result && (
          <section className="space-y-8">
            <Summary result={result} />

            <div className="rounded-3xl border bg-white p-6 md:p-8 shadow-sm">
              <h2 className="text-base font-medium text-zinc-700 mb-3">Text marke</h2>
              <Segmented text={text} issues={result.issues} />
            </div>

            <div className="rounded-3xl border bg-white p-6 md:p-8 shadow-sm">
              <h3 className="text-base font-medium text-zinc-700 mb-4">Rezilta analiz</h3>
              {result.issues.length === 0 ? (
                <p className="text-zinc-600">Pena auken problem. 🎉</p>
              ) : (
                <ul className="space-y-3">
                  {result.issues.map((iss, i) => (
                    <li key={i} className="rounded-2xl border p-4">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] ring-1 ${SEVERITY_STYLE[iss.severity]}`}
                        >
                          {iss.severity}
                        </span>
                        <span className="font-medium">
                          {OFFENSE_LABELS[iss.offense]}
                        </span>
                        <span className="text-xs text-zinc-500 ml-auto">
                          {iss.start}–{iss.end}
                        </span>
                      </div>
                      <div className="text-sm text-zinc-700 italic">“{iss.quote}”</div>
                      <div className="text-xs text-zinc-500 mt-1">{iss.rationale}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="mt-14 border-t pt-6 text-center text-sm text-zinc-500">
          TAX — All Right Reserved
        </footer>
      </div>
    </main>
  );
}
