import { useCallback, useState } from "react";
import PageShell, { actionPrimary, actionSecondary } from "../components/PageShell";
import { IconFile, IconTrash, IconUpload } from "../components/icons";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  Choice,
  DropZone,
  Panel,
  errText,
  iconBtn,
  inputCls,
  moveItem,
  useFileDrop,
  useReorder,
} from "../components/ToolKit";
import {
  compressPdf,
  countPages,
  exportPdf,
  fileName,
  mergePdfs,
  pickFolder,
  pickPdfPath,
  pickPdfPaths,
  splitPdf,
} from "../lib/pdf";
import { formatBytes } from "../lib/projects";
import type { Level } from "../lib/compress";
import { parseRanges } from "../lib/ranges";

export type Tool = "merge" | "split" | "compress" | "images" | "toImages" | "organize" | "stamp";

const ACTIONS: { tool: Tool | "blank"; title: string; desc: string; icon: string }[] = [
  { tool: "merge", title: "รวม PDF", desc: "นำหลายไฟล์มาต่อกันเป็นไฟล์เดียว", icon: "⧉" },
  { tool: "split", title: "แยก PDF", desc: "แยกทุกหน้า หรือแยกตามช่วงหน้าที่กำหนด", icon: "✂" },
  { tool: "compress", title: "บีบอัด PDF", desc: "ลดขนาดไฟล์โดยย่อรูปภาพข้างใน ข้อความยังคมชัด", icon: "⇲" },
  { tool: "organize", title: "จัดหน้า", desc: "เรียงลำดับ หมุน ลบ หรือทำสำเนาหน้า", icon: "▦" },
  { tool: "images", title: "รูปภาพ → PDF", desc: "รวมรูป JPG/PNG หลายรูปเป็น PDF ไฟล์เดียว", icon: "🖼" },
  { tool: "toImages", title: "PDF → รูปภาพ", desc: "แปลงหน้า PDF เป็นไฟล์ PNG หรือ JPG", icon: "⇄" },
  { tool: "stamp", title: "เลขหน้า / ลายน้ำ", desc: "ใส่เลขหน้า และลายน้ำข้อความ เช่น “ลับ” “สำเนา”", icon: "#" },
  { tool: "blank", title: "เอกสารเปล่า", desc: "เริ่มจากหน้า A4 ว่าง 1 หน้า", icon: "＋" },
];

/** Action menu shown by "สร้างเอกสารใหม่". */
export default function Tools({
  onBack,
  onOpen,
  onBlank,
}: {
  onBack: () => void;
  onOpen: (tool: Tool) => void;
  onBlank: () => void;
}) {
  return (
    <PageShell title="สร้างเอกสารใหม่" subtitle="เลือกสิ่งที่ต้องการทำ" onBack={onBack} backLabel="กลับหน้าแรก">
      <div className="mx-auto grid max-w-4xl gap-4 p-6 sm:grid-cols-2 lg:p-10">
        {ACTIONS.map((a) => (
          <button
            key={a.title}
            onClick={() => (a.tool === "blank" ? onBlank() : onOpen(a.tool))}
            className="flex items-start gap-4 rounded-2xl border border-maroon/10 bg-cream p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-maroon/30 hover:shadow-md dark:border-white/10 dark:bg-ink-900 dark:hover:border-coral/40"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-maroon/10 text-xl text-maroon dark:bg-coral/15 dark:text-coral">
              {a.icon}
            </span>
            <span>
              <span className="block font-semibold">{a.title}</span>
              <span className="mt-1 block text-sm text-neutral-500 dark:text-neutral-400">{a.desc}</span>
            </span>
          </button>
        ))}
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
}: {
  path: string;
  pages?: number | null;
  dragOver: boolean;
  busy: boolean;
  onChange: () => void;
}) {
  return (
    <Panel dragOver={dragOver} className="flex items-center gap-3 px-4 py-3">
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

interface Item {
  key: number;
  path: string;
  pages: number | null | undefined; // undefined = still counting, null = unreadable
}
let nextKey = 1;

export function MergePdf({ onBack, onError, onDone }: ToolProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);

  const addPaths = useCallback(
    (paths: string[]) => {
      const pdfs = paths.filter((p) => /\.pdf$/i.test(p));
      if (pdfs.length < paths.length) onError("ข้ามไฟล์ที่ไม่ใช่ PDF");
      const added = pdfs.map((path) => ({ key: nextKey++, path, pages: undefined }));
      setItems((cur) => [...cur, ...added]);
      for (const it of added) {
        void countPages(it.path).then((pages) =>
          setItems((cur) => cur.map((x) => (x.key === it.key ? { ...x, pages } : x))),
        );
      }
    },
    [onError],
  );

  const addViaDialog = async () => {
    try {
      addPaths(await pickPdfPaths());
    } catch (e) {
      onError(errText(e));
    }
  };

  const dragOver = useFileDrop(addPaths);
  const { dragKey, handle } = useReorder(setItems, busy);

  const doExport = async () => {
    setBusy(true);
    try {
      const bytes = await mergePdfs(items.map((it) => it.path));
      const dest = await exportPdf(bytes, "รวมไฟล์.pdf");
      if (dest) onDone({ open: dest });
    } catch (e) {
      onError(`รวมไฟล์ไม่สำเร็จ: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const totalPages = items.reduce((n, it) => n + (it.pages ?? 0), 0);

  return (
    <PageShell
      title="รวม PDF"
      subtitle={items.length ? `${items.length} ไฟล์ · ${totalPages.toLocaleString()} หน้า` : "เพิ่มไฟล์ที่ต้องการรวม เรียงลำดับ แล้วกดส่งออก"}
      onBack={onBack}
      actions={
        <>
          <button onClick={addViaDialog} disabled={busy} className={actionSecondary}>
            <IconUpload className="h-4 w-4" />
            เพิ่มไฟล์
          </button>
          <button onClick={doExport} disabled={busy || items.length < 2} className={actionPrimary} title={items.length < 2 ? "เพิ่มอย่างน้อย 2 ไฟล์" : undefined}>
            {busy ? "กำลังรวม…" : "ส่งออก PDF"}
          </button>
        </>
      }
    >
      <div className="mx-auto max-w-3xl p-6 lg:p-10">
        {items.length === 0 ? (
          <DropZone onClick={addViaDialog} dragOver={dragOver} label="คลิกเพื่อเลือกไฟล์ PDF หรือลากไฟล์มาวางที่นี่" />
        ) : (
          <Panel dragOver={dragOver} className="overflow-hidden">
            <ol className="divide-y divide-maroon/10 dark:divide-white/10">
              {items.map((it, i) => (
                <li
                  key={it.key}
                  data-key={it.key}
                  className={`flex items-center gap-3 px-4 py-3 transition-colors ${dragKey === it.key ? "bg-maroon/10 dark:bg-coral/15" : ""}`}
                >
                  <span {...handle(it.key)} className={`${handle(it.key).className} shrink-0 px-1 text-neutral-400`}>
                    ⠿
                  </span>
                  <span className="w-6 shrink-0 text-right text-sm text-neutral-400">{i + 1}</span>
                  <IconFile className="h-5 w-5 shrink-0 text-maroon dark:text-coral" />
                  <span className="min-w-0 flex-1 truncate text-sm" title={it.path}>
                    {fileName(it.path)}
                  </span>
                  <span className="shrink-0 text-xs text-neutral-500">
                    {it.pages === undefined ? "…" : it.pages === null ? "อ่านไม่ได้" : `${it.pages} หน้า`}
                  </span>
                  <button onClick={() => setItems((c) => moveItem(c, i, -1))} disabled={busy || i === 0} aria-label="เลื่อนขึ้น" title="เลื่อนขึ้น" className={iconBtn}>
                    ↑
                  </button>
                  <button onClick={() => setItems((c) => moveItem(c, i, 1))} disabled={busy || i === items.length - 1} aria-label="เลื่อนลง" title="เลื่อนลง" className={iconBtn}>
                    ↓
                  </button>
                  <button
                    onClick={() => setItems((cur) => cur.filter((x) => x.key !== it.key))}
                    disabled={busy}
                    aria-label="นำออก"
                    title="นำออก"
                    className={`${iconBtn} hover:text-brand-700`}
                  >
                    <IconTrash className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ol>
          </Panel>
        )}
      </div>
    </PageShell>
  );
}

export function SplitPdf({ onBack, onError, onDone }: ToolProps) {
  const { file, dragOver, chooseViaDialog } = usePickOnePdf(onError);
  const [mode, setMode] = useState<"each" | "ranges">("each");
  const [rangeText, setRangeText] = useState("");
  const [busy, setBusy] = useState(false);

  const total = file?.pages ?? 0;
  const ranges: [number, number][] | string =
    mode === "each"
      ? Array.from({ length: total }, (_, i): [number, number] => [i + 1, i + 1])
      : parseRanges(rangeText, total);
  const rangeError = mode === "ranges" && rangeText.trim() && typeof ranges === "string" ? ranges : null;
  const ready = !!file && total > 0 && typeof ranges !== "string" && !busy;

  const doSplit = async () => {
    if (!file || typeof ranges === "string") return;
    try {
      const dir = await pickFolder("เลือกโฟลเดอร์สำหรับเก็บไฟล์ที่แยก");
      if (!dir) return;
      setBusy(true);
      const written = await splitPdf(file.path, ranges, dir);
      onDone({ notice: `แยกแล้ว ${written.length} ไฟล์` });
      void revealItemInDir(written[0]).catch(() => {});
    } catch (e) {
      onError(`แยกไฟล์ไม่สำเร็จ: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell
      title="แยก PDF"
      subtitle="เลือกไฟล์ เลือกวิธีแยก แล้วกดแยกไฟล์"
      onBack={onBack}
      actions={
        <button onClick={doSplit} disabled={!ready} className={actionPrimary}>
          {busy ? "กำลังแยก…" : typeof ranges === "string" || !file ? "แยกไฟล์" : `แยกเป็น ${ranges.length} ไฟล์`}
        </button>
      }
    >
      <div className="mx-auto max-w-3xl space-y-6 p-6 lg:p-10">
        {file ? (
          <ChosenFile path={file.path} pages={file.pages} dragOver={dragOver} busy={busy} onChange={chooseViaDialog} />
        ) : (
          <DropZone onClick={chooseViaDialog} dragOver={dragOver} label="คลิกเพื่อเลือกไฟล์ PDF หรือลากไฟล์มาวางที่นี่" />
        )}

        {file && (
          <fieldset disabled={busy} className="space-y-3">
            <Choice name="mode" checked={mode === "each"} onChange={() => setMode("each")} title="แยกทุกหน้า" desc="ได้ 1 ไฟล์ต่อ 1 หน้า" />
            <Choice
              name="mode"
              checked={mode === "ranges"}
              onChange={() => setMode("ranges")}
              title="กำหนดช่วงหน้า"
              desc={
                <>
                  คั่นแต่ละไฟล์ด้วยจุลภาค เช่น <code>1-3, 5, 8-</code> (8- คือหน้า 8 ถึงหน้าสุดท้าย)
                </>
              }
            >
              {mode === "ranges" && (
                <input
                  autoFocus
                  value={rangeText}
                  onChange={(e) => setRangeText(e.target.value)}
                  placeholder="1-3, 5, 8-"
                  aria-invalid={!!rangeError}
                  className={`${inputCls} mt-3`}
                />
              )}
              {rangeError && <span className="mt-2 block text-sm text-brand-700 dark:text-brand-400">{rangeError}</span>}
            </Choice>
          </fieldset>
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
      <div className="mx-auto max-w-3xl space-y-6 p-6 lg:p-10">
        {file ? (
          <ChosenFile path={file.path} dragOver={dragOver} busy={busy} onChange={chooseViaDialog} />
        ) : (
          <DropZone onClick={chooseViaDialog} dragOver={dragOver} label="คลิกเพื่อเลือกไฟล์ PDF หรือลากไฟล์มาวางที่นี่" />
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
