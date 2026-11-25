import { useEffect, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import PageShell, { actionPrimary, actionSecondary } from "../components/PageShell";
import PdfThumb from "../components/PdfThumb";
import { DropZone, errText } from "../components/ToolKit";
import { IconCheckAll, IconMinusSquare, IconSquare } from "../components/icons";
import { fileName, pickFolder } from "../lib/pdf";
import { pdfToImages, type ImageFormat } from "../lib/tools";
import { usePickOnePdf, type ToolProps } from "./Tools";

const PRESETS: { label: string; use: string; desc: string; format: ImageFormat; dpi: number }[] = [
  { label: "ต่ำ", use: "ไฟล์เล็ก เหมาะส่งแชท", desc: "JPG · 72 DPI", format: "jpg", dpi: 72 },
  { label: "กลาง", use: "เหมาะดูบนจอ", desc: "PNG · 150 DPI", format: "png", dpi: 150 },
  { label: "สูง", use: "คมชัด เหมาะสำหรับพิมพ์", desc: "PNG · 300 DPI", format: "png", dpi: 300 },
];

const iconChip =
  "flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-xs font-medium text-neutral-600 transition hover:bg-maroon/10 dark:text-neutral-300 dark:hover:bg-white/5";

export default function PdfToImages({ onBack, onError, onDone }: ToolProps) {
  const { file, dragOver, chooseViaDialog } = usePickOnePdf(onError);
  const [preset, setPreset] = useState(1);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const lastClicked = useRef<number | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = progress !== null;
  const [zoomed, setZoomed] = useState<number | null>(null);

  useEffect(() => {
    if (zoomed === null) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setZoomed(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  const total = file?.pages ?? 0;
  const all = Array.from({ length: total }, (_, i) => i + 1);
  const pages = all.filter((n) => selected.has(n));
  const allOn = total > 0 && pages.length === total;

  // New file → everything selected.
  useEffect(() => {
    setSelected(new Set(Array.from({ length: total }, (_, i) => i + 1)));
    lastClicked.current = null;
  }, [file?.path, total]);

  const toggle = (n: number, shift: boolean) => {
    setSelected((cur) => {
      const next = new Set(cur);
      const on = !cur.has(n);
      const from = shift && lastClicked.current !== null ? Math.min(lastClicked.current, n) : n;
      const to = shift && lastClicked.current !== null ? Math.max(lastClicked.current, n) : n;
      for (let i = from; i <= to; i++) on ? next.add(i) : next.delete(i);
      return next;
    });
    lastClicked.current = n;
  };
  const selectWhere = (keep: (n: number) => boolean) => setSelected(new Set(all.filter(keep)));

  const run = async () => {
    if (!file || !pages.length) return;
    const { format, dpi } = PRESETS[preset];
    try {
      const dir = await pickFolder("เลือกโฟลเดอร์สำหรับเก็บรูป");
      if (!dir) return;
      setProgress({ done: 0, total: pages.length });
      const written = await pdfToImages(file.path, pages, format, dpi, dir, (done, t) => setProgress({ done, total: t }));
      onDone({ notice: `บันทึกแล้ว ${written.length} รูป` });
      void revealItemInDir(written[0]).catch(() => {});
    } catch (e) {
      onError(`แปลงไม่สำเร็จ: ${errText(e)}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <PageShell
      title="PDF → รูปภาพ"
      subtitle={file ? `${fileName(file.path)} · ${file.pages == null ? "…" : `${file.pages} หน้า`}` : "1 รูปต่อ 1 หน้า"}
      onBack={onBack}
      actions={
        file && (
          <>
            <button onClick={chooseViaDialog} disabled={busy} className={actionSecondary}>
              เปลี่ยนไฟล์
            </button>
            <button onClick={run} disabled={busy || !pages.length} className={actionPrimary}>
              {busy ? `กำลังแปลง ${progress.done}/${progress.total}…` : `บันทึก ${pages.length} รูป`}
            </button>
          </>
        )
      }
    >
      {!file ? (
        <div className="flex min-h-full flex-col p-6 lg:p-10">
          <DropZone className="flex-1" onClick={chooseViaDialog} dragOver={dragOver} label="คลิกเพื่อเลือกไฟล์ PDF หรือลากไฟล์มาวางที่นี่" />
        </div>
      ) : (
        <fieldset disabled={busy} className="flex min-h-full flex-col">
          {/* Toolbar: quality presets + selection shortcuts; details live in tooltips. */}
          <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-maroon/10 bg-neutral-50/90 px-4 py-3 backdrop-blur dark:border-white/10 dark:bg-ink-950/90 lg:px-8">
            <span className="text-xs font-medium text-neutral-500">คุณภาพ</span>
            <div role="group" aria-label="คุณภาพ" className="flex overflow-hidden rounded-lg border border-maroon/15 dark:border-white/15">
              {PRESETS.map((p, i) => (
                <button
                  key={p.label}
                  onClick={() => setPreset(i)}
                  aria-pressed={preset === i}
                  title={`${p.use} · ${p.desc}`}
                  className={`px-3.5 py-1.5 text-xs font-medium transition ${i ? "border-l border-maroon/15 dark:border-white/15" : ""} ${
                    preset === i
                      ? "bg-maroon text-cream dark:bg-coral dark:text-night"
                      : "text-neutral-600 hover:bg-maroon/5 dark:text-neutral-300 dark:hover:bg-white/5"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-neutral-500">
              {PRESETS[preset].use} <span className="text-neutral-400">· {PRESETS[preset].desc}</span>
            </span>
            <div className="ml-auto flex items-center gap-1">
              <button
                className={iconChip}
                onClick={() => selectWhere(() => !allOn)}
                role="checkbox"
                aria-checked={allOn ? true : pages.length ? "mixed" : false}
                title={allOn ? "ไม่เลือก" : "เลือกทั้งหมด"}
                aria-label="เลือกทั้งหมด"
              >
                {allOn ? <IconCheckAll className="h-4 w-4" /> : pages.length ? <IconMinusSquare className="h-4 w-4" /> : <IconSquare className="h-4 w-4" />}
              </button>
              <button className={iconChip} onClick={() => selectWhere((n) => n % 2 === 1)} title="หน้าคี่">
                1·3
              </button>
              <button className={iconChip} onClick={() => selectWhere((n) => n % 2 === 0)} title="หน้าคู่">
                2·4
              </button>
              <span className="ml-2 text-xs tabular-nums text-neutral-500" title="Shift+คลิก เพื่อเลือกเป็นช่วง">
                {pages.length}/{total}
              </span>
            </div>
          </div>

          {/* Page grid; thumbnails render only when scrolled into view. */}
          <ol className="grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-4 p-4 lg:p-8">
            {all.map((n) => {
              const on = selected.has(n);
              return (
                <li key={n} className="group/page relative">
                  <button
                    onClick={() => setZoomed(n)}
                    aria-label={`ขยายหน้า ${n}`}
                    title="ขยายดู (ดับเบิลคลิกที่หน้าก็ได้)"
                    className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded bg-black/55 text-sm text-white opacity-0 transition hover:bg-black/75 focus-visible:opacity-100 group-hover/page:opacity-100"
                  >
                    ⤢
                  </button>
                  <button
                    onClick={(e) => toggle(n, e.shiftKey)}
                    onDoubleClick={() => setZoomed(n)}
                    aria-pressed={on}
                    aria-label={`หน้า ${n}`}
                    className="group block w-full select-none text-center"
                  >
                    <div
                      className={`relative rounded-lg p-1 transition ${
                        on ? "bg-maroon/10 ring-2 ring-maroon dark:bg-coral/10 dark:ring-coral" : "ring-1 ring-black/10 hover:ring-maroon/40 dark:ring-white/10"
                      }`}
                    >
                      <PdfThumb path={file.path} page={n} contain className={`aspect-[3/4] w-full rounded transition ${on ? "" : "opacity-50"}`} />
                      <span
                        className={`absolute left-2 top-2 flex h-5 w-5 items-center justify-center rounded border text-xs font-bold ${
                          on ? "border-maroon bg-maroon text-cream dark:border-coral dark:bg-coral dark:text-night" : "border-neutral-400 bg-white/90"
                        }`}
                      >
                        {on && "✓"}
                      </span>
                    </div>
                    <span className="mt-1.5 block text-xs text-neutral-500">{n}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </fieldset>
      )}
      {file && zoomed !== null && (
        <div
          role="dialog"
          aria-label={`หน้า ${zoomed}`}
          onClick={() => setZoomed(null)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-neutral-900/90 p-6 backdrop-blur-sm"
        >
          <button onClick={() => setZoomed(null)} aria-label="ปิด" title="ปิด (Esc)" className="absolute right-4 top-3 rounded-full px-3 py-1 text-lg text-white/80 hover:bg-white/15">
            ✕
          </button>
          <PdfThumb key={zoomed} path={file.path} page={zoomed} width={1600} contain className="min-h-0 w-full flex-1" />
          <span className="text-xs text-white/60">
            หน้า {zoomed} / {total}
          </span>
        </div>
      )}
    </PageShell>
  );
}
