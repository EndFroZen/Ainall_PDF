import { useCallback, useEffect, useState } from "react";
import PageShell, { actionPrimary, actionSecondary } from "../components/PageShell";
import { IconFile, IconPlus, IconScissors } from "../components/icons";
import PdfThumb from "../components/PdfThumb";
import { listRecentFiles, type RecentFile } from "../lib/db";
import { isImage } from "../lib/tools";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Choice,
  DropZone,
  Panel,
  errText,
  useFileDrop,
} from "../components/ToolKit";
import {
  compressPdf,
  countPages,
  exportPdf,
  fileName,
  pickFolder,
  pickPdfPath,
  splitPdf,
  PAGE_SIZES,
  type PageSize,
} from "../lib/pdf";
import { formatBytes } from "../lib/projects";
import type { Level } from "../lib/compress";

export type Tool = "split" | "compress" | "images" | "toImages" | "organize" | "stamp";

// Two-tone sketch art for the tool cards: white "paper" with a maroon outline.
const paper = "fill-white stroke-maroon/70 dark:fill-neutral-100 dark:stroke-coral/80";
const ink = "stroke-maroon dark:stroke-coral";
const Page = ({ x, y, w = 22, h = 28 }: { x: number; y: number; w?: number; h?: number }) => (
  <rect x={x} y={y} width={w} height={h} rx={2} className={paper} strokeWidth={1.5} />
);
const Photo = ({ x, y }: { x: number; y: number }) => (
  <g>
    <rect x={x} y={y} width={18} height={14} rx={2} className="fill-[#f3d9c4] stroke-maroon/70 dark:stroke-coral/80" strokeWidth={1.5} />
    <path d={`M${x + 2} ${y + 12}l5-5 4 4 3-3 3 4`} className={ink} strokeWidth={1.5} fill="none" />
  </g>
);
const ART: Record<Tool, React.JSX.Element> = {
  organize: (
    <>
      <Page x={18} y={6} /><Page x={13} y={11} /><Page x={8} y={16} />
      <path d="M15 24v12m-3-3 3 3 3-3M23 36V24m-3 3 3-3 3 3" className={ink} strokeWidth={1.5} fill="none" />
    </>
  ),
  split: (
    <>
      <Page x={6} y={10} /><Page x={36} y={10} />
      <path d="M32 6v40" className={ink} strokeWidth={1.5} strokeDasharray="3 3" />
    </>
  ),
  compress: (
    <>
      <Page x={21} y={12} />
      <path d="M4 26h11m-4-4 4 4-4 4M60 26H49m4-4-4 4 4 4M32 4v6m-3-3 3 3 3-3M32 48v-6m-3 3 3-3 3 3" className={ink} strokeWidth={1.5} fill="none" />
    </>
  ),
  images: (
    <>
      <Photo x={4} y={8} /><Photo x={10} y={22} />
      <path d="M31 26h8m-3-3 3 3-3 3" className={ink} strokeWidth={1.5} fill="none" />
      <Page x={42} y={12} w={18} h={24} />
    </>
  ),
  toImages: (
    <>
      <Page x={4} y={12} w={18} h={24} />
      <path d="M25 26h8m-3-3 3 3-3 3" className={ink} strokeWidth={1.5} fill="none" />
      <Photo x={38} y={8} /><Photo x={44} y={22} />
    </>
  ),
  stamp: (
    <>
      <Page x={18} y={6} w={28} h={38} />
      <rect x={20} y={18} width={24} height={10} rx={2} transform="rotate(-12 32 23)" className={ink} strokeWidth={1.5} fill="none" />
      <path d="M38 39h4" className={ink} strokeWidth={1.5} />
    </>
  ),
};

const ACTIONS: { tool: Tool; title: string; desc: string }[] = [
  { tool: "organize", title: "รวม / จัดหน้า", desc: "รวมหลายไฟล์ เรียงลำดับ หมุน ลบ หรือทำสำเนาหน้า" },
  { tool: "split", title: "แยก PDF", desc: "แยกทุกหน้า หรือแยกตามช่วงหน้าที่กำหนด" },
  { tool: "compress", title: "บีบอัด PDF", desc: "ลดขนาดไฟล์โดยย่อรูปภาพข้างใน ข้อความยังคมชัด" },
  { tool: "images", title: "รูปภาพ → PDF", desc: "รวมรูป JPG/PNG หลายรูปเป็น PDF ไฟล์เดียว" },
  { tool: "toImages", title: "PDF → รูปภาพ", desc: "แปลงหน้า PDF เป็นไฟล์ PNG หรือ JPG" },
  { tool: "stamp", title: "เลขหน้า / ลายน้ำ", desc: "ใส่เลขหน้า และลายน้ำข้อความ เช่น “ลับ” “สำเนา”" },
];

const card =
  "rounded-2xl border border-maroon/10 bg-white shadow-sm dark:border-white/10 dark:bg-ink-900";

const rtf = new Intl.RelativeTimeFormat("th", { numeric: "auto" });
/** SQLite CURRENT_TIMESTAMP (UTC, "YYYY-MM-DD HH:MM:SS") → "3 ชั่วโมงที่ผ่านมา". */
function ago(ts: string): string {
  const sec = (new Date(ts.replace(" ", "T") + "Z").getTime() - Date.now()) / 1000;
  for (const [unit, s] of [["day", 86400], ["hour", 3600], ["minute", 60]] as const)
    if (Math.abs(sec) >= s) return rtf.format(Math.round(sec / s), unit);
  return rtf.format(0, "minute");
}

/** "สร้างเอกสารใหม่" hub: drop/open a file, start a blank document, pick a tool, or reopen a recent file. */
export default function Tools({
  onBack,
  onOpen,
  onBlank,
  onOpenFile,
  onOpenPath,
  onOpenImages,
  onError,
}: {
  onBack: () => void;
  onOpen: (tool: Tool) => void;
  onBlank: (size: PageSize) => void;
  onOpenFile: () => void;
  onOpenPath: (path: string) => void;
  onOpenImages: (paths: string[]) => void;
  onError: (msg: string) => void;
}) {
  const [size, setSize] = useState<PageSize>("A4");
  const [recent, setRecent] = useState<RecentFile[]>([]);
  useEffect(() => {
    listRecentFiles(3).then(setRecent).catch(() => setRecent([]));
  }, []);

  const dragOver = useFileDrop(
    useCallback(
      (paths: string[]) => {
        const pdf = paths.find((p) => /\.pdf$/i.test(p));
        const images = paths.filter(isImage);
        if (pdf) onOpenPath(pdf);
        else if (images.length) onOpenImages(images);
        else if (paths.length) onError("รองรับเฉพาะไฟล์ PDF, JPG และ PNG");
      },
      [onOpenPath, onOpenImages, onError],
    ),
  );

  const [w, h] = PAGE_SIZES[size];

  return (
    <PageShell title="สร้างเอกสารใหม่" subtitle="เลือกสิ่งที่ต้องการทำ" onBack={onBack} backLabel="กลับหน้าแรก">
      <div className="mx-auto grid max-w-6xl gap-4 p-6 lg:grid-cols-[17rem_1fr] lg:p-10">
        {/* Left column: drop zone + blank document */}
        <div className="flex flex-col gap-4">
          <div
            className={`flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition ${
              dragOver ? "border-maroon bg-maroon/5 dark:border-coral" : "border-maroon/30 dark:border-white/15"
            }`}
          >
            <svg viewBox="0 0 64 52" className="h-16 w-20" strokeLinejoin="round" strokeLinecap="round">
              <rect x={22} y={4} width={22} height={28} rx={2} transform="rotate(-12 33 18)" className={paper} strokeWidth={1.5} />
              <path d="M6 30h14l3 6h18l3-6h14v16H6z" className={`${ink} fill-white dark:fill-ink-900`} strokeWidth={1.5} />
            </svg>
            <p className="text-sm text-neutral-600 dark:text-neutral-300">ลากไฟล์ PDF หรือรูปภาพมาวางที่นี่</p>
            <button onClick={onOpenFile} className={actionPrimary}>
              เลือกไฟล์จากเครื่อง
            </button>
          </div>

          <div className={`${card} p-5`}>
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-maroon/10 text-maroon dark:bg-coral/15 dark:text-coral">
                <IconPlus />
              </span>
              <div>
                <p className="font-semibold">เอกสารเปล่า</p>
                <p className="text-sm text-neutral-500 dark:text-neutral-400">เริ่มจากหน้า {size} ว่าง 1 หน้า</p>
              </div>
            </div>
            <div className="mt-4 flex items-end gap-4">
              <div className="flex h-28 w-24 shrink-0 items-end justify-center">
                {/* Height scales with the paper so A5 looks smaller than A4. */}
                <div
                  className="rounded-sm bg-white shadow-md ring-1 ring-black/5 transition-all"
                  style={{ aspectRatio: `${w} / ${h}`, height: `${(h / PAGE_SIZES.A4[1]) * 100}%` }}
                />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <p className="mb-1.5 text-xs text-neutral-500 dark:text-neutral-400">ขนาด</p>
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="ขนาดหน้า">
                    {(Object.keys(PAGE_SIZES) as PageSize[]).map((s) => (
                      <button
                        key={s}
                        role="radio"
                        aria-checked={size === s}
                        onClick={() => setSize(s)}
                        className={`rounded-full border px-2.5 py-1 text-xs font-medium transition ${
                          size === s
                            ? "border-maroon bg-maroon/10 text-maroon dark:border-coral dark:bg-coral/15 dark:text-coral"
                            : "border-maroon/20 text-neutral-600 hover:border-maroon/40 dark:border-white/15 dark:text-neutral-300"
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <button onClick={() => onBlank(size)} className={actionPrimary}>
                  สร้างหน้าว่าง
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Right column: tools + recent files */}
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {ACTIONS.map((a) => (
              <button
                key={a.tool}
                onClick={() => onOpen(a.tool)}
                className={`${card} flex items-center gap-4 p-5 text-left transition hover:-translate-y-0.5 hover:border-maroon/30 hover:shadow-md dark:hover:border-coral/40`}
              >
                <svg viewBox="0 0 64 52" className="h-14 w-16 shrink-0" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  {ART[a.tool]}
                </svg>
                <span>
                  <span className="block font-semibold">{a.title}</span>
                  <span className="mt-1 block text-sm text-neutral-500 dark:text-neutral-400">{a.desc}</span>
                </span>
              </button>
            ))}
          </div>

          {recent.length > 0 && (
            <section>
              <h2 className="mb-3 font-semibold">เอกสารล่าสุด</h2>
              <div className="grid gap-4 sm:grid-cols-3">
                {recent.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => onOpenPath(f.path)}
                    title={f.path}
                    className={`${card} flex items-center gap-3 p-3 text-left transition hover:border-maroon/30 hover:shadow-md dark:hover:border-coral/40`}
                  >
                    <PdfThumb path={f.path} className="h-14 w-11 shrink-0 rounded ring-1 ring-black/10" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{f.name}</span>
                      <span className="block text-xs text-neutral-500 dark:text-neutral-400">{ago(f.opened_at)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </PageShell>
  );
}

/** Props every tool page takes. `onDone` gets the saved PDF's path (to open it) or a notice. */
export interface ToolProps {
  onBack: () => void;
  onError: (msg: string) => void;
  onDone: (result: { open: string } | { notice: string }) => void;
}

/** The chosen file, with a "change file" button. */
export function ChosenFile({
  path,
  pages,
  dragOver,
  busy,
  onChange,
  showPages = true,
}: {
  path: string;
  pages?: number | null;
  dragOver: boolean;
  busy: boolean;
  onChange: () => void;
  showPages?: boolean;
}) {
  return (
    <Panel dragOver={dragOver}>
      <div className="flex items-center gap-3 px-4 py-3">
        <IconFile className="h-5 w-5 shrink-0 text-maroon dark:text-coral" />
        <span className="min-w-0 flex-1 truncate text-sm" title={path}>
          {fileName(path)}
        </span>
        {pages !== undefined && (
          <span className="shrink-0 text-xs text-neutral-500">{pages === null ? "อ่านไม่ได้" : `${pages} หน้า`}</span>
        )}
        <button onClick={onChange} disabled={busy} className={actionSecondary}>
          เปลี่ยนไฟล์
        </button>
      </div>
      {/* Page previews; each renders only when scrolled into view. */}
      {showPages && !!pages && (
        <ol className="flex gap-3 overflow-x-auto border-t border-maroon/10 bg-neutral-50 px-4 py-4 dark:border-white/10 dark:bg-ink-950">
          {Array.from({ length: pages }, (_, i) => (
            <li key={i} className="shrink-0 text-center">
              <PdfThumb path={path} page={i + 1} className="h-40 w-[7.5rem] rounded shadow-sm ring-1 ring-black/10" />
              <span className="mt-1.5 block text-xs text-neutral-500">{i + 1}</span>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}

/** One PDF picked by dialog or drop, with its page count (undefined while counting). */
export function usePickOnePdf(onError: (msg: string) => void, onPicked?: () => void) {
  const [file, setFile] = useState<{ path: string; pages: number | null | undefined } | null>(null);
  const choose = useCallback(
    (paths: string[]) => {
      const path = paths.find((p) => /\.pdf$/i.test(p));
      if (!path) return void (paths.length && onError("รองรับเฉพาะไฟล์ .pdf"));
      setFile({ path, pages: undefined });
      onPicked?.();
      void countPages(path).then((pages) => setFile((cur) => (cur?.path === path ? { path, pages } : cur)));
    },
    [onError, onPicked],
  );
  const dragOver = useFileDrop(choose);
  const chooseViaDialog = async () => {
    try {
      const path = await pickPdfPath();
      if (path) choose([path]);
    } catch (e) {
      onError(errText(e));
    }
  };
  return { file, dragOver, chooseViaDialog };
}

export function SplitPdf({ onBack, onError, onDone }: ToolProps) {
  const { file, dragOver, chooseViaDialog } = usePickOnePdf(onError);
  // Page numbers a file ends after (1-based, never the last page).
  const [cuts, setCuts] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);

  const total = file?.pages ?? 0;
  const everyPage = () => setCuts(new Set(Array.from({ length: Math.max(0, total - 1) }, (_, i) => i + 1)));
  useEffect(() => setCuts(new Set()), [file?.path]);
  const toggle = (p: number) =>
    setCuts((cur) => {
      const next = new Set(cur);
      if (!next.delete(p)) next.add(p);
      return next;
    });

  const groups: [number, number][] = [];
  for (let p = 1, from = 1; p <= total; p++) {
    if (p === total || cuts.has(p)) {
      groups.push([from, p]);
      from = p + 1;
    }
  }
  const ready = !!file && groups.length > 1 && !busy;

  const doSplit = async () => {
    if (!file) return;
    try {
      const dir = await pickFolder("เลือกโฟลเดอร์สำหรับเก็บไฟล์ที่แยก");
      if (!dir) return;
      setBusy(true);
      const written = await splitPdf(file.path, groups, dir);
      onDone({ notice: `แยกแล้ว ${written.length} ไฟล์` });
      void revealItemInDir(written[0]).catch(() => {});
    } catch (e) {
      onError(`แยกไฟล์ไม่สำเร็จ: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const cutBtn = (after: number, on: boolean) => (
    <button
      key={`cut${after}`}
      onClick={() => toggle(after)}
      disabled={busy}
      title={on ? `รวมหน้า ${after} กับ ${after + 1} เป็นไฟล์เดียวกัน` : `ตัดแยกไฟล์หลังหน้า ${after}`}
      aria-label={on ? `รวมหน้า ${after} กับ ${after + 1}` : `ตัดหลังหน้า ${after}`}
      aria-pressed={on}
      className={`flex w-8 shrink-0 items-center justify-center self-stretch rounded-lg transition ${
        on
          ? "text-maroon hover:bg-maroon/10 dark:text-coral"
          : "text-maroon/20 hover:bg-maroon/10 hover:text-maroon dark:text-white/15 dark:hover:text-coral"
      }`}
    >
      <IconScissors className="h-4 w-4" />
    </button>
  );

  return (
    <PageShell
      title="แยก PDF"
      subtitle="คลิกกรรไกรระหว่างหน้าเพื่อตัดเป็นไฟล์ใหม่"
      onBack={onBack}
      actions={
        <button onClick={doSplit} disabled={!ready} className={actionPrimary}>
          {busy ? "กำลังแยก…" : groups.length > 1 ? `แยกเป็น ${groups.length} ไฟล์` : "แยกไฟล์"}
        </button>
      }
    >
      <div className={`space-y-6 p-6 lg:p-10 ${file ? "mx-auto max-w-6xl" : "flex min-h-full flex-col"}`}>
        {file ? (
          <ChosenFile path={file.path} pages={file.pages} dragOver={dragOver} busy={busy} onChange={chooseViaDialog} showPages={false} />
        ) : (
          <DropZone className="flex-1" onClick={chooseViaDialog} dragOver={dragOver} label="คลิกเพื่อเลือกไฟล์ PDF หรือลากไฟล์มาวางที่นี่" />
        )}

        {file && total > 1 && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={everyPage} disabled={busy} className={actionSecondary}>
                แยกทุกหน้า
              </button>
              <button onClick={() => setCuts(new Set())} disabled={busy} className={actionSecondary}>
                ล้างจุดตัดทั้งหมด
              </button>
              <span className="text-sm text-neutral-500 dark:text-neutral-400">
                คลิก <IconScissors className="inline h-4 w-4 align-text-bottom text-maroon dark:text-coral" /> ระหว่างหน้าเพื่อตัดหรือรวม
              </span>
            </div>

            <div className="flex flex-wrap items-stretch gap-y-4">
              {groups.map(([from, to], gi) => [
                gi > 0 && cutBtn(from - 1, true),
                <div key={from} className="rounded-xl border border-maroon/15 bg-white p-3 dark:border-white/10 dark:bg-ink-900">
                  <p className="mb-2 text-xs font-semibold text-maroon dark:text-coral">
                    ไฟล์ {gi + 1} · {from === to ? `หน้า ${from}` : `หน้า ${from}–${to}`}
                  </p>
                  <div className="flex flex-wrap items-start">
                    {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((p) => [
                      p > from && cutBtn(p - 1, false),
                      <div key={p} className="text-center">
                        <PdfThumb path={file.path} page={p} className="h-32 w-24 rounded shadow-sm ring-1 ring-black/10" />
                        <span className="mt-1 block text-xs text-neutral-500">{p}</span>
                      </div>,
                    ])}
                  </div>
                </div>,
              ])}
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}

const LEVEL_INFO: { level: Level; title: string; desc: string }[] = [
  { level: "low", title: "น้อย", desc: "คุณภาพรูปใกล้เคียงเดิม ลดขนาดได้ไม่มาก" },
  { level: "medium", title: "ปานกลาง", desc: "สมดุลระหว่างขนาดกับคุณภาพ (แนะนำ)" },
  { level: "high", title: "มาก", desc: "ไฟล์เล็กที่สุด รูปอาจไม่คมชัด" },
];

export function CompressPdf({ onBack, onError, onDone }: ToolProps) {
  const [result, setResult] = useState<{ before: number; bytes: Uint8Array } | null>(null);
  const clearResult = useCallback(() => setResult(null), []);
  const { file, dragOver, chooseViaDialog } = usePickOnePdf(onError, clearResult);
  const [level, setLevel] = useState<Level>("medium");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = progress !== null;

  const run = async () => {
    if (!file) return;
    setResult(null);
    setProgress({ done: 0, total: 0 });
    try {
      setResult(await compressPdf(file.path, level, (done, total) => setProgress({ done, total })));
    } catch (e) {
      onError(`บีบอัดไม่สำเร็จ: ${errText(e)}`);
    } finally {
      setProgress(null);
    }
  };

  const save = async () => {
    if (!file || !result) return;
    try {
      const dest = await exportPdf(result.bytes, fileName(file.path).replace(/\.pdf$/i, "_บีบอัด.pdf"));
      if (dest) onDone({ open: dest });
    } catch (e) {
      onError(`บันทึกไม่สำเร็จ: ${errText(e)}`);
    }
  };

  const saved = result ? 1 - result.bytes.length / result.before : 0;

  return (
    <PageShell
      title="บีบอัด PDF"
      subtitle="ย่อรูปภาพในไฟล์ให้เล็กลง ข้อความและเส้นต่างๆ ไม่เปลี่ยน"
      onBack={onBack}
      actions={
        <button onClick={run} disabled={!file || busy} className={actionPrimary}>
          {busy ? (progress.total ? `กำลังบีบอัด ${progress.done}/${progress.total}…` : "กำลังอ่านไฟล์…") : "บีบอัด"}
        </button>
      }
    >
      <div className={`space-y-6 p-6 lg:p-10 ${file ? "mx-auto max-w-3xl" : "flex min-h-full flex-col"}`}>
        {file ? (
          <ChosenFile path={file.path} pages={file.pages} dragOver={dragOver} busy={busy} onChange={chooseViaDialog} />
        ) : (
          <DropZone className="flex-1" onClick={chooseViaDialog} dragOver={dragOver} label="คลิกเพื่อเลือกไฟล์ PDF หรือลากไฟล์มาวางที่นี่" />
        )}

        {file && (
          <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-3">
            {LEVEL_INFO.map((l) => (
              <Choice
                key={l.level}
                name="level"
                checked={level === l.level}
                onChange={() => {
                  setLevel(l.level);
                  setResult(null);
                }}
                title={l.title}
                desc={l.desc}
              />
            ))}
          </fieldset>
        )}

        {result && (
          <Panel className="flex flex-wrap items-center gap-4 px-5 py-4">
            <div role="status" className="contents">
              {saved > 0.01 ? (
                <>
                  <span className="text-sm">
                    {formatBytes(result.before)} → <b className="font-semibold">{formatBytes(result.bytes.length)}</b>
                    <span className="ml-2 text-emerald-700 dark:text-emerald-400">เล็กลง {Math.round(saved * 100)}%</span>
                  </span>
                  <button onClick={save} className={`${actionPrimary} ml-auto`}>
                    บันทึกเป็น…
                  </button>
                </>
              ) : (
                <span className="text-sm text-neutral-600 dark:text-neutral-300">
                  ไฟล์นี้เล็กลงไม่ได้แล้ว อาจไม่มีรูปภาพ หรือรูปถูกบีบอัดไว้แล้ว ลองระดับ "มาก" หรือใช้ไฟล์เดิมต่อได้เลย
                </span>
              )}
            </div>
          </Panel>
        )}
      </div>
    </PageShell>
  );
}
