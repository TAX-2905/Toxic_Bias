"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect, // <-- keep
  useMemo,
  useRef,
  useState,
  useTransition,
  useDeferredValue,
  memo,
} from "react";
import * as Papa from "papaparse";
import { Wand2, XCircle, Loader2, Upload } from "lucide-react";
import type { AnalysisResult, Issue } from "@/app/lib/schema";

// Palet: neutre kalm avek ti tint dapre severite
const SEVERITY_STYLE: Record<0 | 1 | 2 | 3, string> = {
  0: "bg-emerald-50 ring-emerald-200 text-emerald-800",
  1: "bg-amber-50 ring-amber-200 text-amber-800",
  2: "bg-orange-50 ring-orange-200 text-orange-800",
  3: "bg-rose-50 ring-rose-200 text-rose-800",
} as const;

// Afisaz lokalize (UI)
const OVERALL_LABELS: Record<AnalysisResult["overall_label"], string> = {
  safe: "An sekirite",
  risky: "Riske",
  unsafe: "Pa an sekirite",
} as const;

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
} as const;

// UPDATED: keep offense singular when merging (deterministic)
function mergeOverlaps(issues: Issue[]): Issue[] {
  if (issues.length <= 1) return issues.slice();
  const sorted = [...issues].sort((a, b) => a.start - b.start);
  const out: Issue[] = [];
  for (let idx = 0; idx < sorted.length; idx++) {
    const cur = sorted[idx];
    const prev = out[out.length - 1];
    if (!prev || cur.start > prev.end) out.push({ ...cur });
    else {
      prev.end = Math.max(prev.end, cur.end);
      if (cur.severity > prev.severity) prev.offense = cur.offense;
      prev.severity = Math.max(prev.severity, cur.severity) as 0 | 1 | 2 | 3;
      prev.rationale = `${prev.rationale}\n— ${cur.rationale}`;
      if ((cur.quote?.length ?? 0) > (prev.quote?.length ?? 0)) prev.quote = cur.quote;
    }
  }
  return out;
}

// Derive overall label from issues: 0 -> safe, 1 -> risky, >=2 -> unsafe
function deriveOverallLabel(issues: Issue[]): AnalysisResult["overall_label"] {
  if (!issues || issues.length === 0) return "safe";
  const m = maxSeverity(issues);
  if (m === null || m === 0) return "safe";
  if (m === 1) return "risky";
  return "unsafe";
}


// ADD (top-level, near other helpers)
function mergeSignals(...signals: (AbortSignal | null | undefined)[]) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signals.filter(Boolean).forEach((s) => s!.addEventListener("abort", onAbort, { once: true }));
  return {
    signal: ctrl.signal,
    cleanup() {
      signals.filter(Boolean).forEach((s) => s!.removeEventListener("abort", onAbort));
    },
  };
}

const ANALYZE_TIMEOUT_MS = 20000000; // 20s per cell request

// Helper pou style selil dapre max severite dan li
function maxSeverity(issues: Issue[]): 0 | 1 | 2 | 3 | null {
  if (!issues || issues.length === 0) return null;
  return issues.reduce((acc, i) => (i.severity > acc ? i.severity : acc), 0 as 0 | 1 | 2 | 3);
}

// --- delimiter guesser (top-level, outside the component) ---
const guessDelimiter = (sample: string) => {
  const candidates = [",", ";", "\t", "|"] as const;
  const lines = sample
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .slice(0, 50);

  let best: string = ",";
  let bestScore = -Infinity;

  for (const d of candidates) {
    const counts = lines.map((l) => l.split(d).length);
    if (counts.length === 0) continue;
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance = counts.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / counts.length;
    const score = mean - variance; // prefer more columns + consistency
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
};

const Segmented = memo(function Segmented({
  text,
  issues,
  compact = false,
}: {
  text: string;
  issues: Issue[];
  compact?: boolean;
}) {
  const deferredText = useDeferredValue(text);

  const segments = useMemo(() => {
    const merged = mergeOverlaps(issues);
    if (!deferredText) return [] as Array<{ key: string; text: string; issue?: Issue }>;
    const segs: Array<{ key: string; text: string; issue?: Issue }> = [];
    let i = 0;
    for (let k = 0; k < merged.length; k++) {
      const iss = merged[k];
      if (iss.start > i) segs.push({ key: `t-${i}`, text: deferredText.slice(i, iss.start) });
      segs.push({ key: `h-${k}-${iss.start}-${iss.end}`, text: deferredText.slice(iss.start, iss.end), issue: iss });
      i = iss.end;
    }
    if (i < deferredText.length) segs.push({ key: `tail-${i}`, text: deferredText.slice(i) });
    return segs;
  }, [deferredText, issues]);

  return (
    <div className={compact ? "max-w-none" : "prose prose-zinc max-w-none"}>
      <p
        className={
          compact
            ? "m-0 whitespace-pre-wrap leading-6 text-zinc-900 text-[14px]"
            : "whitespace-pre-wrap leading-8 text-zinc-900 text-[17px]"
        }
      >
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
});

const Summary = memo(function Summary({ result }: { result: AnalysisResult }) {
  const counts = useMemo(() => {
    const acc: Record<0 | 1 | 2 | 3, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };
    for (let i = 0; i < result.issues.length; i++) acc[result.issues[i].severity]++;
    return acc;
  }, [result.issues]);

  // NEW: compute overall based on severities
  const overall = useMemo(() => deriveOverallLabel(result.issues), [result.issues]);

  // CHANGED: pill color now uses derived "overall"
  const pill = useMemo(
    () =>
      overall === "unsafe"
        ? "bg-rose-50 border-rose-200 text-rose-800"
        : overall === "risky"
        ? "bg-amber-50 border-amber-200 text-amber-800"
        : "bg-emerald-50 border-emerald-200 text-emerald-800",
    [overall]
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className={`rounded-2xl border p-4 ${pill}`}>
        <div className="text-sm">Feedback zeneral</div>
        {/* CHANGED: show derived label text */}
        <div className="text-2xl font-semibold mt-1">{OVERALL_LABELS[overall]}</div>
      </div>
      <div className="rounded-2xl border p-4 bg-white">
        <div className="text-sm text-zinc-600">Kont severite</div>
        <div className="mt-2 flex gap-2">
          {[0, 1, 2, 3].map((s) => (
            <div key={s} className={`rounded-xl ring-1 px-3 py-2 text-sm ${SEVERITY_STYLE[s as 0 | 1 | 2 | 3]}`}>
              <span className="font-semibold mr-1">{s}</span>
              {counts[s as 0 | 1 | 2 | 3]}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});


export default function Page() {
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [, startTransition] = useTransition();

  // --- CSV state (auto analyze + highlight per cell) ---
  const [csvData, setCsvData] = useState<string[][] | null>(null);
  const [csvResults, setCsvResults] = useState<Record<string, AnalysisResult | null>>({});
  const [csvLoading, setCsvLoading] = useState(false);
  const csvAbortRef = useRef<AbortController | null>(null);

  const lastAnalyzedTextRef = useRef<string | null>(null);

  // Abort in-flight requests if user re-clicks Analyze rapidly
  const abortRef = useRef<AbortController | null>(null);

  // Voice helper (completed and kept)
  const selectMauritianLikeVoice = useCallback(() => {
    try {
      const synth = window.speechSynthesis;
      const voices = synth.getVoices?.() ?? [];
      if (!voices || voices.length === 0) return null;
      const preferredNames = [
        "Google français",
        "Google Français",
        "Microsoft Hortense - French (France)",
        "Microsoft Hortense Desktop - French",
        "Thomas",
        "Amelie",
        "Audrey",
      ].map((v) => v.toLowerCase());
      const frenchVoices = voices.filter((v) => v.lang?.toLowerCase().startsWith("fr"));
      const byName = frenchVoices.find((v) => preferredNames.includes(v.name.toLowerCase()));
      const next = byName || frenchVoices[0] || null;
      return next ?? null;
    } catch {
      return null;
    }
  }, []);

  // --- Textarea autosize
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const autoSize = useCallback((el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, Math.floor(window.innerHeight * 0.85)) + "px";
  }, []);

  useLayoutEffect(() => {
    autoSize(taRef.current);
  }, [autoSize, text]);

  // REPLACE your current postAnalyze with this version (adds timeout + merged AbortSignals)
  const postAnalyze = useCallback(
    async (payloadText: string, externalController?: AbortController) => {
      const timeoutCtrl = new AbortController();
      const timer = setTimeout(() => timeoutCtrl.abort(), ANALYZE_TIMEOUT_MS);
      const { signal, cleanup } = mergeSignals(externalController?.signal, timeoutCtrl.signal);

      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: payloadText }),
          signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`Erer API ${res.status}`);
        const data: AnalysisResult = await res.json();
        return data;
      } finally {
        clearTimeout(timer);
        cleanup();
      }
    },
    []
  );

  const analyze = useCallback(async () => {
    if (!text.trim()) return;
    // NEW: short-circuit identical re-runs to avoid flips
    // if (lastAnalyzedTextRef.current === text && result) return;

    setLoading(true);
    setError(null);
    // don't clear result immediately; keep UI stable while loading

    // cancel previous request if any
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const data = await postAnalyze(text, controller);
      startTransition(() => {
        setResult(data);
        lastAnalyzedTextRef.current = text;
      });
    } catch (e: any) {
      if (e?.name === "AbortError") {
        // aborted: keep UI calm; no error toast
      } else {
        setError(e?.message ? String(e.message) : "Erer inatandu pandan analiz");
      }
    } finally {
      setLoading(false);
    }
  }, [postAnalyze, startTransition, text]);

  // 1) ADD near other refs/state in your Page() component
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 3) REPLACE resetAll with this (also clears the file input so you can re-upload)
  const resetAll = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    if (csvAbortRef.current) csvAbortRef.current.abort();

    setText("");
    setResult(null);
    setError(null);
    lastAnalyzedTextRef.current = null;

    setCsvData(null);
    setCsvResults({});
    setCsvLoading(false);

    // clear chosen file so the same CSV can be picked again
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  useEffect(() => {
    // Only act if we have a “last analyzed” snapshot and the text has changed
    if (!lastAnalyzedTextRef.current) return;
    if (text === lastAnalyzedTextRef.current) return;

    // Behave like pressing "Reffacer" (but keep the current text)
    if (abortRef.current) abortRef.current.abort();
    setLoading(false);
    setResult(null);
    setError(null);

    // Prevent re-triggering on every keystroke
    lastAnalyzedTextRef.current = null;
  }, [text]);

  // --- CSV helpers: auto-analyze after upload and highlight per cell ---
  // REPLACE your analyzeCsv with this version
  const analyzeCsv = useCallback(
    async (rows: string[][]) => {
      if (csvAbortRef.current) csvAbortRef.current.abort();
      const batchController = new AbortController();
      csvAbortRef.current = batchController;

      setCsvResults({});
      setCsvLoading(true);

      // Prepare list of non-empty cells to scan
      const jobs: { r: number; c: number; text: string }[] = [];
      for (let r = 0; r < rows.length; r++) {
        for (let c = 0; c < rows[r].length; c++) {
          const cellText = (rows[r][c] ?? "").toString();
          if (cellText.trim().length > 0) jobs.push({ r, c, text: cellText });
        }
      }

      const BATCH = 6;

      try {
        for (let i = 0; i < jobs.length; i += BATCH) {
          const slice = jobs.slice(i, i + BATCH);
          // Use allSettled so one failure/hang (which we also timeout) doesn't block
          const settled = await Promise.allSettled(slice.map((job) => postAnalyze(job.text, batchController)));

          settled.forEach((res, idx) => {
            const { r, c } = slice[idx];
            const key = `${r}-${c}`;
            if (res.status === "fulfilled") {
              setCsvResults((prev) => ({ ...prev, [key]: res.value }));
            } else {
              // Mark failed cells as null so the UI can still render the text
              setCsvResults((prev) => ({ ...prev, [key]: null }));
            }
          });

          // Yield to the UI so the spinner updates smoothly
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 0));
        }
      } finally {
        setCsvLoading(false);
      }
    },
    [postAnalyze]
  );

  // REPLACE your handleCsvUpload with this version
  const handleCsvUpload = useCallback(
    async (file: File) => {
      try {
        const sample = await file.slice(0, 256 * 1024).text();
        const delimiter = guessDelimiter(sample);

        Papa.parse<string[]>(file, {
          delimiter,
          worker: true, // parse off the main thread
          dynamicTyping: false,
          skipEmptyLines: false, // <-- keep empty rows
          complete: (res: Papa.ParseResult<string[]>) => {
            const fatal = (res.errors || []).filter((e) => e.code && e.code !== "UndetectableDelimiter");
            if (fatal.length) {
              setError("Pa kapav lir CSV: " + (fatal[0]?.message ?? "Parse error"));
              return;
            }

            // Normalize: strings only + pad all rows to same width
            const raw = (res.data as unknown as string[][]).map((r) => r.map((v) => (v == null ? "" : String(v))));
            const maxCols = raw.reduce((m, r) => Math.max(m, r.length), 0);
            const rows = raw.map((r) => (r.length < maxCols ? [...r, ...Array(maxCols - r.length).fill("")] : r));

            setCsvData(rows);
            analyzeCsv(rows); // auto-run, then render
          },
          error: (err: Error) => {
            setError("Pa kapav lir CSV: " + (err?.message ?? String(err)));
          },
        });
      } catch (err: any) {
        setError("Pa kapav lir CSV: " + (err?.message ?? String(err)));
      }
    },
    [analyzeCsv]
  );

  // Optional local state for the (present but previously empty) toggle
  const [autoRead, setAutoRead] = useState(false);

  return (
    <main className="min-h-dvh bg-gradient-to-b from-white via-red-200 to-red-400">
      {/* was: <div className="mx-auto max-w-4xl px-6 py-14 text-center"> */}
      <div className="mx-auto max-w-4xl px-6 py-14">
        {/* Header (center only the brand area) */}
        <header className="text-center mb-8">
          <img
  src="/waa.png"
  alt="Brand logo"
  className="h-25 w-auto mx-auto object-contain"  // <- no cropping
/>
          <h1 className="mt-2 text-3xl md:text-4xl font-semibold tracking-tight">MorisGuard</h1>
        </header>

        {/* Kart Antre (TEXT) */}
        <section className="rounded-3xl border bg-white shadow-sm p-6 md:p-8 mb-8">
          <label htmlFor="input" className="block text-sm font-medium text-zinc-700 mb-2">
            Paragraph
          </label>
<textarea
    id="input"
    ref={taRef}
    value={text}
    onInput={useCallback(
        (e: React.ChangeEvent<HTMLTextAreaElement>) => {
            setText(e.target.value);
            autoSize(e.currentTarget);
        },
        [autoSize]
    )}
    // ADD THIS NEW HANDLER
    onKeyDown={(e) => {
        // Only trigger on Enter key press
        if (e.key === 'Enter') {
            if (e.shiftKey) {
                // If Shift + Enter, do nothing (allow default newline)
                // You can optionally add logic here if you need to manually manage the newline,
                // but usually just letting the default behavior happen is best.
                return;
            } else {
                // If just Enter, prevent the default newline
                e.preventDefault();
                // Check if the text is not empty and not currently loading before analyzing
                if (text.trim() && !loading) {
                    analyze();
                }
            }
        }
    }}
    placeholder="Met 1 text ici pou analizer…"
    className="w-full h-auto min-h-[10vh] md:min-h-[10vh] rounded-2xl border border-zinc-200 focus:ring-2 focus:ring-zinc-900/10 focus:outline-none p-5 bg-zinc-50/40 text-[16px] leading-7 overflow-hidden resize-none"
/>

          {/* Aksion */}
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button
              onClick={analyze}
              disabled={loading || !text.trim()}
              className="inline-flex items-center gap-2 rounded-2xl bg-zinc-900 text-white px-5 py-3 text-base font-medium shadow hover:bg-black disabled:opacity-40"
              {...(loading ? { "aria-busy": true } : {})}
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

            {/* Attach CSV (next to Reffacer) */}
            <label className="inline-flex items-center gap-2 rounded-2xl bg-white border px-4 py-2 text-sm cursor-pointer hover:bg-zinc-100">
              <Upload size={16} />
              <span>Attach CSV</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onClick={(e) => {
                  // ensure selecting the same file triggers onChange again
                  (e.currentTarget as HTMLInputElement).value = "";
                }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleCsvUpload(f);
                }}
              />
            </label>

            {/* Auto Read toggle */}
            <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
            </label>
          </div>
        </section>

        {/* CSV highlight table */}
        {csvData && (
          <section className="rounded-3xl border bg-white shadow-sm p-6 md:p-8 mb-8">
            <div className="flex items-center gap-3 mb-3">
              {csvLoading && (
                <span className="inline-flex items-center gap-2 text-sm text-zinc-600">
                  <Loader2 className="animate-spin" size={16} /> Pe analiz CSV…
                </span>
              )}
            </div>
            <div className="mt-2 overflow-auto">
              <table className="w-full table-auto border-collapse text-left">
                <tbody>
                  {csvData.map((row, r) => (
                    <tr key={r} className="border-b last:border-b-0">
                      {row.map((cell, c) => {
                        const key = `${r}-${c}`;
                        const res = csvResults[key] || null;
                        const ms = res ? maxSeverity(res.issues) : null;
                        const cellTint =
                          ms == null
                            ? ""
                            : SEVERITY_STYLE[ms as 0 | 1 | 2 | 3].replace(/text-[^\s]+/g, ""); // keep bg & ring only
                        return (
                          <td key={key} className="align-top p-2 border-b-0">
                            <div className={`rounded-xl px-2 py-1 ${cellTint}`}>
                              {res ? (
                                res.issues.length > 0 ? (
                                  <Segmented text={cell} issues={res.issues} compact />
                                ) : (
                                  <span className="text-zinc-700 text-sm whitespace-pre-wrap">{cell}</span>
                                )
                              ) : (
                                <span className="text-zinc-700 text-sm whitespace-pre-wrap">{cell}</span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {/* Rezilta (TEXT) */}
        {error && (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800 flex items-start gap-2 mb-8">
            <XCircle className="mt-0.5" size={18} /> {error}
          </div>
        )}

        {!result && !error && !csvData && (
          <section className="rounded-3xl border bg-white p-8 text-zinc-600 text-center">
            <p className="text-lg">Lans enn analiz pou gete ban parti ki pa appropriate.</p>
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
                    <li key={`${iss.start}-${iss.end}-${i}`} className="rounded-2xl border p-4">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span
                          className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-[11px] ring-1 ${SEVERITY_STYLE[iss.severity]}`}
                        >
                          {iss.severity}
                        </span>
                        <span className="font-medium">{OFFENSE_LABELS[iss.offense]}</span>
                        <span className="text-xs text-zinc-500 ml-auto">
                          {iss.start}–{iss.end}
                        </span>
                      </div>
                      {iss.quote && <div className="text-sm text-zinc-700 italic">“{iss.quote}”</div>}
                      <div className="text-xs text-zinc-500 mt-1">{iss.rationale}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {/* Footer */}
<footer className="mt-14 border-t pt-6 text-center text-sm text-black">
  LOMESH — All Right Reserved
</footer>
      </div>
    </main>
  );
}
