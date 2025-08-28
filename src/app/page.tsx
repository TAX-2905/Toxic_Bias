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
import { Wand2, XCircle, Loader2, Volume2, Upload } from "lucide-react";
import type { AnalysisResult, Issue } from "@/app/lib/schema";



// Palet: neutre kalm avek ti tint dapre severite
const SEVERITY_STYLE: Record<number, string> = {
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

  const pill = useMemo(
    () =>
      result.overall_label === "unsafe"
        ? "bg-rose-50 border-rose-200 text-rose-800"
        : result.overall_label === "risky"
        ? "bg-amber-50 border-amber-200 text-amber-800"
        : "bg-emerald-50 border-emerald-200 text-emerald-800",
    [result.overall_label]
  );

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

  // --- Auto Read (TTS)
  const [autoRead, setAutoRead] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const canceledRef = useRef(false);
  const lastAnalyzedTextRef = useRef<string | null>(null);

  // Abort in-flight requests if user re-clicks Analyze rapidly
  const abortRef = useRef<AbortController | null>(null);

  const selectMauritianLikeVoice = useCallback(() => {
    try {
      const synth = window.speechSynthesis;
      const voices = synth.getVoices();
      if (!voices || voices.length === 0) return;
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
      // avoid useless reassignments
      if (voiceRef.current?.name !== next?.name) voiceRef.current = next;
    } catch {
      voiceRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const supported = "speechSynthesis" in window;
    setTtsSupported(supported);
    if (!supported) return;
    selectMauritianLikeVoice();
    const handleVoicesChanged = () => selectMauritianLikeVoice();
    (window.speechSynthesis as any).onvoiceschanged = handleVoicesChanged;
    return () => {
      if (window.speechSynthesis.onvoiceschanged === handleVoicesChanged) {
        (window.speechSynthesis as any).onvoiceschanged = null;
      }
    };
  }, [selectMauritianLikeVoice]);

  const stopSpeaking = useCallback(() => {
    if (!ttsSupported) return;
    try {
      canceledRef.current = true;
      if (window.speechSynthesis.speaking || (window as any).speechSynthesis.pending) {
        window.speechSynthesis.cancel();
      }
    } catch {}
    if (isSpeaking) setIsSpeaking(false);
  }, [ttsSupported, isSpeaking]);

  const speakText = useCallback(
    (t: string) => {
      if (!ttsSupported || !autoRead || !t.trim()) return;
      const synth = window.speechSynthesis;

      try {
        if (!voiceRef.current) selectMauritianLikeVoice();
        stopSpeaking();

        const u = new SpeechSynthesisUtterance("\u2060" + t);
        if (voiceRef.current) {
          u.voice = voiceRef.current;
          u.lang = voiceRef.current.lang || "fr-FR";
        } else {
          u.lang = "fr-FR";
        }
        u.rate = 1;
        u.pitch = 1;

        u.onstart = () => setIsSpeaking(true);
        u.onend = () => {
          setIsSpeaking(false);
          if (!canceledRef.current) setAutoRead(false);
        };
        u.onerror = () => {
          setIsSpeaking(false);
          setAutoRead(false);
        };

        utteranceRef.current = u;

        setTimeout(() => {
          try {
            canceledRef.current = false;
            if ((synth as any).paused) synth.resume();
            synth.speak(u);
          } catch {}
        }, 120);
      } catch {}
    },
    [ttsSupported, autoRead, selectMauritianLikeVoice, stopSpeaking]
  );

  // Toggling the checkbox: check = speak now; uncheck = stop now.
  useEffect(() => {
    if (!ttsSupported) return;
    if (autoRead) speakText(text);
    else stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRead, ttsSupported]);

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

  const postAnalyze = useCallback(
    async (payloadText: string, controller?: AbortController) => {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: payloadText }),
        signal: controller?.signal,
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`Erer API ${res.status}`);
      const data: AnalysisResult = await res.json();
      return data;
    },
    []
  );

  const analyze = useCallback(async () => {
    if (!text.trim()) return;
    // NEW: short-circuit identical re-runs to avoid flips
    //if (lastAnalyzedTextRef.current === text && result) return;

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

      // Si Auto Read on — lir text ki itilizater finn avoy
      speakText(text);
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setError(e?.message ?? "Erer inkoni");
    } finally {
      setLoading(false);
    }
  }, [text, speakText, startTransition, postAnalyze]);

// Replace your current resetAll with this

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

  stopSpeaking();
}, [stopSpeaking]);



  useEffect(() => {
    // Only act if we have a “last analyzed” snapshot and the text has changed
    if (!lastAnalyzedTextRef.current) return;
    if (text === lastAnalyzedTextRef.current) return;

    // Behave like pressing "Reffacer" (but keep the current text)
    if (abortRef.current) abortRef.current.abort();
    setLoading(false);
    setResult(null);
    setError(null);
    stopSpeaking();

    // Prevent re-triggering on every keystroke
    lastAnalyzedTextRef.current = null;
  }, [text, stopSpeaking]);

  // 1) ADD near other refs/state in your Page() component
const fileInputRef = useRef<HTMLInputElement | null>(null);


  // --- CSV helpers: auto-analyze after upload and highlight per cell ---
  const analyzeCsv = useCallback(
    async (rows: string[][]) => {
      // cancel previous CSV batch if any
      if (csvAbortRef.current) csvAbortRef.current.abort();
      const batchController = new AbortController();
      csvAbortRef.current = batchController;

      setCsvResults({});
      setCsvLoading(true);

      // Prepare list of cells to scan (only non-empty)
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
          await Promise.all(
            slice.map(async ({ r, c, text }) => {
              const key = `${r}-${c}`;
              try {
                const data = await postAnalyze(text, batchController);
                setCsvResults((prev) => ({ ...prev, [key]: data }));
              } catch (e: any) {
                if (e?.name === "AbortError") return;
                setCsvResults((prev) => ({ ...prev, [key]: null }));
              }
            })
          );
        }
      } finally {
        setCsvLoading(false);
      }
    },
    [postAnalyze]
  );

  const handleCsvUpload = useCallback(
    async (file: File) => {
      try {
        const sample = await file.slice(0, 256 * 1024).text();
        const delimiter = guessDelimiter(sample);

        Papa.parse<string[]>(file, {
          delimiter,
          skipEmptyLines: "greedy",
          complete: (res: Papa.ParseResult<string[]>) => {
            const fatal = (res.errors || []).filter(
              (e) => e.code && e.code !== "UndetectableDelimiter"
            );
            if (fatal.length) {
              setError("Pa kapav lir CSV: " + (fatal[0]?.message ?? "Parse error"));
              return;
            }
            const rows = (res.data as unknown as string[][]).map((r) =>
              r.map((v) => (v == null ? "" : String(v)))
            );
            setCsvData(rows);
            analyzeCsv(rows); // auto-run, then render highlight table
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

  return (
    <main className="min-h-dvh bg-gradient-to-b from-zinc-50 to-white">
      <div className="mx-auto max-w-4xl px-6 py-14">
        {/* Header */}
      <div className="mx-auto max-w-4xl px-6 py-14">
        {/* Header */}
            <img src="/waa.png" alt="Brand logo" className="w-20 h-20 object-cover" />
          </div>

          <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">MorisGuard</h1>


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
              <input
                type="checkbox"
                className="size-4 accent-zinc-900"
                checked={autoRead}
                onChange={(e) => setAutoRead(e.target.checked)}
                aria-checked={autoRead}
                aria-label="Surprise"
              />
              <span className="inline-flex items-center gap-1">
                <Volume2 size={16} /> Surprise
                {ttsSupported ? (isSpeaking ? " • " : "") : " (pa sipporté)"}
              </span>
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
                        const cellTint = ms == null ? "" : SEVERITY_STYLE[ms].replace(/text-[^\s]+/g, ""); // keep bg & ring only
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
        <footer className="mt-14 border-t pt-6 text-center text-sm text-zinc-500">TAX — All Right Reserved</footer>
      </div>
    </main>
  );
}




