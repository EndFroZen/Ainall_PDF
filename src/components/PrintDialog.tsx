import { useEffect, useRef, useState } from "react";
import type { PDFDocument } from "../lib/pdf";
import { parsePageRange, printPages, PrintCancelled } from "../lib/print";

type Mode = "all" | "current" | "range";
const LARGE_JOB = 300;

export default function PrintDialog({
  doc,
  currentPage,
  onClose,
}: {
  doc: PDFDocument;
  currentPage: number;
  onClose: () => void;
}) {
  const n = doc.numPages;
  const [mode, setMode] = useState<Mode>(n > LARGE_JOB ? "current" : "all");
  const [range, setRange] = useState(`${currentPage}`);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const pages =
    mode === "all" ? null : mode === "current" ? [currentPage] : parsePageRange(range, n);
  const count = mode === "all" ? n : pages?.length ?? 0;
  const invalid = mode === "range" && !pages;
  const busy = progress !== null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (abortRef.current) abortRef.current.abort();
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const start = async () => {
    const list = mode === "all" ? Array.from({ length: n }, (_, i) => i + 1) : pages;
    if (!list || list.length === 0) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    setProgress({ done: 0, total: list.length });
    try {
      await printPages(doc, list, (done, total) => setProgress({ done, total }), ac.signal);
      onClose();
    } catch (e) {
      if (!(e instanceof PrintCancelled)) setError(e instanceof Error ? e.message : String(e));
    } finally {
      abortRef.current = null;
      setProgress(null);
    }
  };

  const option = (value: Mode, label: string, extra?: React.ReactNode) => (
    <label
      className={`flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition ${
        mode === value
          ? "border-maroon bg-maroon/5 dark:border-coral dark:bg-coral/10"
          : "border-maroon/15 hover:border-maroon/40 dark:border-white/10 dark:hover:border-white/30"
      }`}
    >
      <input
        type="radio"
        name="print-mode"
        checked={mode === value}
        onChange={() => setMode(value)}
        disabled={busy}
        className="accent-maroon dark:accent-coral"
      />
      <span className="text-sm">{label}</span>
      {extra}
    </label>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm"
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="print-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-cream text-neutral-900 shadow-2xl animate-rise dark:bg-ink-900 dark:text-neutral-100 dark:ring-1 dark:ring-white/10"
      >
        <div className="border-b border-maroon/10 px-6 py-4 dark:border-white/10">
          <h2 id="print-title" className="text-lg font-semibold text-maroon dark:text-coral">
            พิมพ์เอกสาร
          </h2>
        </div>

        <div className="space-y-2 px-6 py-5">
          {option("all", `ทุกหน้า (${n} หน้า)`)}
          {option("current", `หน้าปัจจุบัน (หน้า ${currentPage})`)}
          {option(
            "range",
            "ช่วงหน้า",
            <input
              value={range}
              onChange={(e) => setRange(e.target.value)}
              onFocus={() => setMode("range")}
              disabled={busy}
              placeholder="เช่น 1-5, 8, 11-13"
              aria-label="ช่วงหน้า"
              aria-invalid={invalid}
              className={`ml-auto w-40 rounded-md border bg-white px-2 py-1 text-sm outline-none dark:bg-ink-800 ${
                invalid
                  ? "border-brand-500"
                  : "border-neutral-200 focus:border-maroon dark:border-white/15 dark:focus:border-coral"
              }`}
            />,
          )}

          {count > LARGE_JOB && !busy && (
            <p className="pt-1 text-xs text-amber-700 dark:text-amber-400">
              {count} หน้าเป็นงานใหญ่ อาจใช้เวลาเตรียมนานและใช้หน่วยความจำมาก
            </p>
          )}
          {error && <p className="pt-1 text-xs text-brand-700 dark:text-brand-400">พิมพ์ไม่สำเร็จ: {error}</p>}

          {busy && (
            <div className="pt-2">
              <div className="mb-1.5 flex justify-between text-xs text-neutral-500 dark:text-neutral-400">
                <span>กำลังเตรียมหน้า…</span>
                <span className="tabular-nums">
                  {progress.done} / {progress.total}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-maroon/10 dark:bg-white/10">
                <div
                  className="h-full rounded-full bg-maroon transition-[width] dark:bg-coral"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-maroon/10 px-6 py-4 dark:border-white/10">
          <button
            onClick={() => (busy ? abortRef.current?.abort() : onClose())}
            className="rounded-full px-5 py-2 text-sm font-medium text-neutral-600 transition hover:bg-maroon/10 dark:text-neutral-300 dark:hover:bg-white/10"
          >
            ยกเลิก
          </button>
          <button
            onClick={start}
            disabled={busy || invalid || count === 0}
            className="rounded-full bg-maroon px-5 py-2 text-sm font-semibold text-cream transition hover:bg-maroon-dark disabled:opacity-50 dark:bg-coral dark:text-night dark:hover:bg-[#ea8676]"
          >
            {busy ? "กำลังเตรียม…" : `พิมพ์ ${count} หน้า`}
          </button>
        </div>
      </div>
    </div>
  );
}
