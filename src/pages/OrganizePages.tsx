import { useCallback, useEffect, useRef, useState } from "react";
import PageShell, { actionPrimary, actionSecondary } from "../components/PageShell";
import { IconFile, IconTrash, IconUpload } from "../components/icons";
import { DropZone, Panel, errText, iconBtn, moveItem, useFileDrop, useReorder } from "../components/ToolKit";
import { countPages, exportPdf, fileName, pickPdfPaths } from "../lib/pdf";
import { buildPdf, renderPageImages, renderThumbs } from "../lib/tools";
import type { ToolProps } from "./Tools";

interface FileItem {
  key: number;
  path: string;
  pages?: number; // undefined while counting
}
interface PageItem {
  key: number;
  path: string;
  index: number; // 0-based page in its file
  rotate: number; // extra degrees, multiple of 90
}
let nextKey = 1;

// One color per document, shown in the sidebar and on each page card.
const DOC_COLORS = ["#87162a", "#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777"];

const pagesOf = (f: FileItem): PageItem[] =>
  Array.from({ length: f.pages ?? 0 }, (_, index) => ({ key: nextKey++, path: f.path, index, rotate: 0 }));

/**
 * Merge and organize in one tool. "files" view orders whole files (fast for big files);
 * "pages" view shows every page of every file to reorder, rotate, duplicate or delete.
 */
export default function OrganizePages({ onBack, onError, onDone }: ToolProps) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [view, setView] = useState<"files" | "pages">("pages");
  const [pages, setPages] = useState<PageItem[] | null>(null); // null = not built from `files` yet
  const [thumbs, setThumbs] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const jobs = useRef(new Map<string, () => void>());
  // Undo/redo of page-view edits: snapshots of `pages`.
  const [past, setPast] = useState<PageItem[][]>([]);
  const [future, setFuture] = useState<PageItem[][]>([]);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const [preview, setPreview] = useState<number | null>(null); // index into `pages`
  // Sidebar file under the pointer / clicked: other files' pages are dimmed.
  const [hoverPath, setHoverPath] = useState<string | null>(null);
  const [pinPath, setPinPath] = useState<string | null>(null);
  const focusPath = files.length > 1 ? (hoverPath ?? pinPath) : null;
  // Pages per row in the page grid, 3–10; Ctrl + wheel over the grid changes it.
  const [gridCols, setGridCols] = useState(6);
  const zoomGrid = (d: number) => setGridCols((c) => Math.min(10, Math.max(3, c + d)));
  const gridScroller = useRef<HTMLDivElement>(null);
  const hasGrid = view === "pages" && files.length > 0;
  useEffect(() => {
    const el = gridScroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault(); // non-passive, so the whole window doesn't zoom instead
      setGridCols((c) => Math.min(10, Math.max(3, c + (e.deltaY < 0 ? -1 : 1))));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [hasGrid]);

  const addPaths = useCallback(
    (paths: string[]) => {
      const pdfs = paths.filter((p) => /\.pdf$/i.test(p));
      if (pdfs.length < paths.length) onError("ข้ามไฟล์ที่ไม่ใช่ PDF");
      const added = pdfs.map((path) => ({ key: nextKey++, path }));
      setFiles((cur) => [...cur, ...added]);
      for (const it of added) {
        void countPages(it.path).then((n) => {
          if (n === null) {
            onError(`อ่านไฟล์ ${fileName(it.path)} ไม่ได้`);
            return setFiles((cur) => cur.filter((x) => x.key !== it.key));
          }
          const done = { ...it, pages: n };
          setFiles((cur) => cur.map((x) => (x.key === it.key ? done : x)));
          // Added while in page view: append its pages, also to undo/redo snapshots so undo doesn't drop them.
          const extra = pagesOf(done);
          const add = (cur: PageItem[]) => [...cur, ...extra];
          setPages((cur) => cur && add(cur));
          setPast((h) => h.map(add));
          setFuture((h) => h.map(add));
        });
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
  const fileDrag = useReorder(setFiles, busy);
  /** Applies a user edit to the pages and records it for undo. */
  const edit = (fn: (cur: PageItem[]) => PageItem[]) => {
    const cur = pagesRef.current;
    if (!cur) return;
    const next = fn(cur);
    if (next === cur) return;
    setPast((h) => [...h.slice(-99), cur]); // ponytail: last 100 steps
    setFuture([]);
    setPages(next);
  };
  const undo = () => {
    if (!past.length || !pages) return;
    setFuture((f) => [pages, ...f]);
    setPages(past[past.length - 1]);
    setPast((h) => h.slice(0, -1));
  };
  const redo = () => {
    if (!future.length || !pages) return;
    setPast((h) => [...h, pages]);
    setPages(future[0]);
    setFuture((f) => f.slice(1));
  };
  const pageDrag = useReorder(edit, busy);

  const counting = files.some((f) => f.pages === undefined);

  // Entering page view: lay out every page of every file, in file order.
  useEffect(() => {
    if (view === "pages" && pages === null && !counting && files.length) setPages(files.flatMap(pagesOf));
  }, [view, pages, counting, files]);

  // Thumbnails, rendered once per file and kept.
  useEffect(() => {
    if (view !== "pages") return;
    for (const { path } of files) {
      if (jobs.current.has(path)) continue;
      // As wide as a card at the biggest zoom (3 per row beside the sidebar), in device pixels, so it stays sharp.
      // ponytail: sized for the window when the file is added; re-render on resize if that matters
      const thumbW = Math.min(1400, Math.round(((window.innerWidth - 256 - 100) / 3) * window.devicePixelRatio));
      const job = renderThumbs(path, Math.max(300, thumbW), (i, url) =>
        setThumbs((cur) => {
          const list = [...(cur[path] ?? [])];
          list[i] = url;
          return { ...cur, [path]: list };
        }),
      );
      job.pages.catch(() => {});
      jobs.current.set(path, job.cancel);
    }
  }, [view, files]);
  useEffect(() => () => jobs.current.forEach((cancel) => cancel()), []);

  const update = (key: number, fn: (p: PageItem) => PageItem) => edit((cur) => cur.map((p) => (p.key === key ? fn(p) : p)));
  const duplicate = (key: number) =>
    edit((cur) => {
      const i = cur.findIndex((p) => p.key === key);
      return [...cur.slice(0, i + 1), { ...cur[i], key: nextKey++ }, ...cur.slice(i + 1)];
    });

  const totalPages = files.reduce((n, f) => n + (f.pages ?? 0), 0);
  const pageChanged =
    !!pages && (pages.length !== totalPages || pages.some((p, i) => p.rotate % 360 !== 0 || p.index !== i || p.path !== files[0]?.path));
  const canSave = !busy && !counting && (view === "files" ? files.length > 1 : !!pages?.length && (files.length > 1 || pageChanged));

  const save = async () => {
    setBusy(true);
    try {
      const bytes = await buildPdf(view === "pages" && pages ? pages : files.flatMap(pagesOf));
      const name = files.length === 1 ? fileName(files[0].path).replace(/\.pdf$/i, "_จัดหน้า.pdf") : "รวมไฟล์.pdf";
      const dest = await exportPdf(bytes, name);
      if (dest) onDone({ open: dest });
    } catch (e) {
      onError(`บันทึกไม่สำเร็จ: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const colorOf = (path: string) => DOC_COLORS[Math.max(0, files.findIndex((f) => f.path === path)) % DOC_COLORS.length];
  const removeFile = (key: number) => {
    const rest = files.filter((x) => x.key !== key);
    const gone = files.find((x) => x.key === key)?.path;
    setFiles(rest);
    if (gone && !rest.some((x) => x.path === gone)) {
      const drop = (cur: PageItem[]) => cur.filter((p) => p.path !== gone);
      setPages((cur) => cur && drop(cur));
      setPast((h) => h.map(drop));
      setFuture((h) => h.map(drop));
      if (pinPath === gone) setPinPath(null);
      setHoverPath(null);
    }
  };
  const jumpTo = (path: string) => {
    const first = pages?.find((p) => p.path === path);
    if (first) document.getElementById(`page-${first.key}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const toFiles = () => {
    setView("files");
    setPages(null);
    setPast([]);
    setFuture([]);
  };

  // Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z) in page view; Esc closes the preview.
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e) => {
    if (preview !== null) {
      if (e.key === "Escape") setPreview(null);
      return;
    }
    if (view !== "pages" || busy || !(e.ctrlKey || e.metaKey)) return;
    const k = e.key.toLowerCase();
    if (k === "z" && !e.shiftKey) undo();
    else if (k === "y" || (k === "z" && e.shiftKey)) redo();
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    const on = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  return (
    <PageShell
      title="รวม / จัดหน้า"
      subtitle={
        files.length
          ? `${files.length} ไฟล์ · ${(view === "pages" && pages ? pages.length : totalPages).toLocaleString()} หน้า · ลากเพื่อเรียงลำดับ`
          : "เพิ่มไฟล์ PDF แล้วเรียงไฟล์ หรือเรียง หมุน ลบ ทำสำเนาทีละหน้า"
      }
      onBack={onBack}
      actions={
        <>
          {files.length > 0 && (
            <div role="group" aria-label="มุมมอง" className="flex overflow-hidden rounded-lg border border-maroon/15 text-sm dark:border-white/15">
              <button
                onClick={toFiles}
                disabled={busy || view === "files"}
                aria-pressed={view === "files"}
                title={pageChanged ? "การแก้ไขรายหน้าจะถูกล้าง" : undefined}
                className={`px-3 py-1.5 ${view === "files" ? "bg-maroon/10 font-medium dark:bg-coral/15" : "hover:bg-maroon/5"}`}
              >
                ทีละไฟล์
              </button>
              <button
                onClick={() => setView("pages")}
                disabled={busy || view === "pages"}
                aria-pressed={view === "pages"}
                className={`px-3 py-1.5 ${view === "pages" ? "bg-maroon/10 font-medium dark:bg-coral/15" : "hover:bg-maroon/5"}`}
              >
                ทีละหน้า
              </button>
            </div>
          )}
          {view === "pages" && pages && (
            <>
              <div className="flex overflow-hidden rounded-lg border border-maroon/15 text-sm dark:border-white/15">
                <button onClick={undo} disabled={busy || !past.length} title="ย้อนกลับ (Ctrl+Z)" aria-label="ย้อนกลับ" className="px-3 py-1.5 hover:bg-maroon/5 disabled:opacity-40 dark:hover:bg-white/5">
                  ↶
                </button>
                <button onClick={redo} disabled={busy || !future.length} title="ไปข้างหน้า (Ctrl+Y)" aria-label="ไปข้างหน้า" className="border-l border-maroon/15 px-3 py-1.5 hover:bg-maroon/5 disabled:opacity-40 dark:border-white/15 dark:hover:bg-white/5">
                  ↷
                </button>
              </div>
              <button onClick={() => setPreview(0)} disabled={!pages.length} className={actionSecondary}>
                ดูตัวอย่าง
              </button>
            </>
          )}
          <button onClick={addViaDialog} disabled={busy} className={actionSecondary}>
            <IconUpload className="h-4 w-4" />
            เพิ่มไฟล์
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            className={actionPrimary}
            title={view === "files" && files.length < 2 ? "เพิ่มอย่างน้อย 2 ไฟล์ หรือสลับไปทีละหน้า" : undefined}
          >
            {busy ? "กำลังบันทึก…" : "บันทึกเป็น…"}
          </button>
        </>
      }
    >
      <div className={`flex w-full flex-col ${files.length && view === "pages" ? "h-full" : "min-h-full p-6 lg:p-10"}`}>
        {files.length === 0 ? (
          <DropZone className="flex-1" onClick={addViaDialog} dragOver={dragOver} label="คลิกเพื่อเลือกไฟล์ PDF หรือลากไฟล์มาวางที่นี่" />
        ) : view === "files" ? (
          <Panel dragOver={dragOver} className="overflow-hidden">
            <ol className="divide-y divide-maroon/10 dark:divide-white/10">
              {files.map((it, i) => (
                <li
                  key={it.key}
                  data-key={it.key}
                  className={`flex items-center gap-3 px-4 py-3 transition-colors ${fileDrag.dragKey === it.key ? "bg-maroon/10 dark:bg-coral/15" : ""}`}
                >
                  <span {...fileDrag.handle(it.key)} className={`${fileDrag.handle(it.key).className} shrink-0 px-1 text-neutral-400`}>
                    ⠿
                  </span>
                  <span className="w-6 shrink-0 text-right text-sm text-neutral-400">{i + 1}</span>
                  <IconFile className="h-5 w-5 shrink-0 text-maroon dark:text-coral" />
                  <span className="min-w-0 flex-1 truncate text-sm" title={it.path}>
                    {fileName(it.path)}
                  </span>
                  <span className="shrink-0 text-xs text-neutral-500">{it.pages === undefined ? "…" : `${it.pages} หน้า`}</span>
                  <button onClick={() => setFiles((c) => moveItem(c, i, -1))} disabled={busy || i === 0} aria-label="เลื่อนขึ้น" title="เลื่อนขึ้น" className={iconBtn}>
                    ↑
                  </button>
                  <button onClick={() => setFiles((c) => moveItem(c, i, 1))} disabled={busy || i === files.length - 1} aria-label="เลื่อนลง" title="เลื่อนลง" className={iconBtn}>
                    ↓
                  </button>
                  <button
                    onClick={() => setFiles((cur) => cur.filter((x) => x.key !== it.key))}
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
        ) : (
          <div className="flex h-full min-h-0">
          {/* Full-height sidebar flush with the window edge; it and the page grid scroll separately. */}
          <aside className="flex w-64 shrink-0 flex-col border-r border-maroon/10 bg-white dark:border-white/10 dark:bg-ink-900">
              <h2 className="shrink-0 border-b border-maroon/10 px-4 py-3 text-sm font-semibold dark:border-white/10">
                เอกสาร ({files.length})
              </h2>
              <ul className="flex-1 divide-y divide-maroon/10 overflow-auto dark:divide-white/10">
                {files.map((f) => {
                  const used = pages?.filter((p) => p.path === f.path).length;
                  return (
                    <li
                      key={f.key}
                      onMouseEnter={() => setHoverPath(f.path)}
                      onMouseLeave={() => setHoverPath(null)}
                      className={`group flex items-center gap-2 pr-2 transition ${pinPath === f.path ? "bg-maroon/10 dark:bg-coral/15" : ""} ${
                        focusPath && focusPath !== f.path ? "opacity-50" : ""
                      }`}
                    >
                      <button
                        onClick={() => {
                          const pin = pinPath === f.path ? null : f.path; // click again to clear
                          setPinPath(pin);
                          if (pin) jumpTo(pin);
                        }}
                        title={pinPath === f.path ? "คลิกอีกครั้งเพื่อเลิกเน้น" : f.path}
                        aria-pressed={pinPath === f.path}
                        className="flex min-w-0 flex-1 items-center gap-2.5 px-4 py-3 text-left transition hover:bg-maroon/5 dark:hover:bg-white/5"
                      >
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf(f.path) }} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm">{fileName(f.path)}</span>
                          <span className="block text-xs text-neutral-500">
                            {f.pages === undefined ? "…" : used !== undefined && used !== f.pages ? `ใช้ ${used} จาก ${f.pages} หน้า` : `${f.pages} หน้า`}
                          </span>
                        </span>
                      </button>
                      <button
                        onClick={() => removeFile(f.key)}
                        disabled={busy || files.length === 1}
                        aria-label={`นำ ${fileName(f.path)} ออก`}
                        title={files.length === 1 ? "ต้องมีอย่างน้อย 1 ไฟล์" : "นำออก"}
                        className={`${iconBtn} shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-brand-700`}
                      >
                        <IconTrash className="h-4 w-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                onClick={addViaDialog}
                disabled={busy}
                className="flex w-full shrink-0 items-center gap-2 border-t border-maroon/10 px-4 py-3 text-sm text-maroon transition hover:bg-maroon/5 dark:border-white/10 dark:text-coral dark:hover:bg-white/5"
              >
                <IconUpload className="h-4 w-4" />
                เพิ่มไฟล์
              </button>
          </aside>
          <div ref={gridScroller} className="min-w-0 flex-1 overflow-auto p-6">
          <div className="mb-3 flex justify-end">
            <div role="group" aria-label="หน้าต่อแถว" title="Ctrl + ล้อเมาส์ เพื่อซูม" className="flex items-center overflow-hidden rounded-lg border border-maroon/15 text-sm dark:border-white/15">
              <button onClick={() => zoomGrid(1)} disabled={gridCols >= 10} aria-label="ซูมออก" className="px-3 py-1 hover:bg-maroon/5 disabled:opacity-30 dark:hover:bg-white/5">
                −
              </button>
              <button onClick={() => setGridCols(6)} title="กลับค่าเริ่มต้น" className="min-w-24 whitespace-nowrap px-2 py-1 text-center hover:bg-maroon/5 dark:hover:bg-white/5">
                {gridCols} หน้า/แถว
              </button>
              <button onClick={() => zoomGrid(-1)} disabled={gridCols <= 3} aria-label="ซูมเข้า" className="px-3 py-1 hover:bg-maroon/5 disabled:opacity-30 dark:hover:bg-white/5">
                +
              </button>
            </div>
          </div>
          <Panel dragOver={dragOver} className="p-4">
            {!pages ? (
              <p className="py-10 text-center text-sm text-neutral-500">กำลังอ่านไฟล์…</p>
            ) : (
              <ol className="grid gap-4" style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}>
                {pages.map((p, i) => {
                  const thumb = thumbs[p.path]?.[p.index];
                  const label = `${files.length > 1 ? `${fileName(p.path)} ` : ""}หน้า ${p.index + 1}`;
                  return (
                    <li
                      key={p.key}
                      id={`page-${p.key}`}
                      data-key={p.key}
                      className={`group/card rounded-lg transition duration-200 ${
                        pageDrag.dragKey === p.key ? "ring-2 ring-maroon/40 dark:ring-coral/50" : ""
                      } ${
                        focusPath && focusPath !== p.path ? "opacity-40 blur-[1.5px] brightness-50 hover:opacity-100 hover:blur-0 hover:brightness-100" : ""
                      }`}
                    >
                      <div
                        {...pageDrag.handle(p.key)}
                        onDoubleClick={() => setPreview(i)}
                        className={`${pageDrag.handle(p.key).className} flex aspect-square items-center justify-center rounded-lg bg-neutral-100 p-3 transition group-hover/card:bg-neutral-200/70 dark:bg-white/5 dark:group-hover/card:bg-white/10`}
                      >
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={label}
                            draggable={false}
                            style={{ transform: `rotate(${p.rotate}deg)` }}
                            className="h-full w-full object-contain drop-shadow-md transition-transform"
                          />
                        ) : (
                          <IconFile className="h-8 w-8 animate-pulse text-neutral-300" />
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 px-0.5 pt-1.5 text-xs">
                        {files.length > 1 && <span className="ml-1 h-2 w-2 shrink-0 rounded-full" style={{ background: colorOf(p.path) }} />}
                        <span className="flex-1 truncate pl-1 text-neutral-500" title={label}>
                          {i + 1}
                          {(files.length > 1 || p.index !== i) && (
                            <span className="text-neutral-400">
                              {" "}
                              ({files.length > 1 ? `${fileName(p.path).replace(/\.pdf$/i, "")} ` : "เดิม "}
                              {p.index + 1})
                            </span>
                          )}
                        </span>
                        <button onClick={() => update(p.key, (x) => ({ ...x, rotate: x.rotate - 90 }))} disabled={busy} aria-label="หมุนทวนเข็ม" title="หมุนทวนเข็ม" className={iconBtn}>
                          ↺
                        </button>
                        <button onClick={() => update(p.key, (x) => ({ ...x, rotate: x.rotate + 90 }))} disabled={busy} aria-label="หมุนตามเข็ม" title="หมุนตามเข็ม" className={iconBtn}>
                          ↻
                        </button>
                        <button onClick={() => setPreview(i)} aria-label="ดูตัวอย่าง" title="ดูตัวอย่าง (ดับเบิลคลิกที่หน้าก็ได้)" className={iconBtn}>
                          ⤢
                        </button>
                        <button onClick={() => duplicate(p.key)} disabled={busy} aria-label="ทำสำเนา" title="ทำสำเนา" className={iconBtn}>
                          ⧉
                        </button>
                        <button
                          onClick={() => edit((cur) => cur.filter((x) => x.key !== p.key))}
                          disabled={busy || pages.length === 1}
                          aria-label="ลบหน้า"
                          title={pages.length === 1 ? "ต้องเหลืออย่างน้อย 1 หน้า" : "ลบหน้า"}
                          className={`${iconBtn} hover:text-brand-700`}
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>
          </div>
          </div>
        )}
      </div>
      {preview !== null && pages && <PagePreview pages={pages} startAt={preview} onClose={() => setPreview(null)} />}
    </PageShell>
  );
}

/**
 * The result in its current order as one scrolling document. Every page is rendered first
 * (with progress), then shown, scrolled to `startAt`.
 */
export function PagePreview({ pages, startAt = 0, onClose }: { pages: { path: string; index: number; rotate: number }[]; startAt?: number; onClose: () => void }) {
  const [urls, setUrls] = useState<string[] | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [failed, setFailed] = useState(false);
  const [cols, setCols] = useState(1); // 1 = one page per row (default); 2–5 = grid
  const [zoom, setZoom] = useState(1); // one-per-row page width, × 768px
  const scroller = useRef<HTMLDivElement>(null);
  // Zoom in/out: one-per-row → page size; grid → fewer/more pages per row.
  const zoomBy = (dir: 1 | -1) => {
    if (cols === 1) setZoom((z) => Math.min(2, Math.max(0.5, Math.round((z + dir * 0.25) * 100) / 100)));
    else setCols((c) => Math.min(5, Math.max(2, c - dir)));
  };
  const zoomRef = useRef(zoomBy);
  zoomRef.current = zoomBy;
  // Ctrl + mouse wheel zooms (non-passive so the whole window doesn't zoom instead).
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoomRef.current(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [urls]);
  // Esc closes (whoever opened it).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const seg = (on: boolean) => `px-3 py-1 transition ${on ? "bg-white/20 text-white" : "hover:bg-white/10"}`;

  useEffect(() => {
    // Rendered once for the pages as they were when opened; the editor is covered meanwhile.
    const job = renderPageImages(pages, 1500,(done, total) => setProgress({ done, total }));
    job.promise.then(setUrls, () => setFailed(true));
    return job.cancel;
  }, []);

  useEffect(() => {
    if (urls) scroller.current?.querySelector(`[data-n="${startAt}"]`)?.scrollIntoView({ block: "start" });
  }, [urls, startAt]);

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-neutral-800/95 backdrop-blur-sm animate-rise">
      <div className="flex shrink-0 items-center gap-3 px-5 py-3 text-sm text-white/80">
        <span className="mr-auto">ตัวอย่าง · {pages.length} หน้า</span>
        {urls && (
          <>
            <div role="group" aria-label="มุมมอง" className="flex overflow-hidden rounded-lg border border-white/20">
              <button onClick={() => setCols(1)} aria-pressed={cols === 1} className={seg(cols === 1)}>
                เรียงลง
              </button>
              <button onClick={() => cols === 1 && setCols(3)} aria-pressed={cols > 1} className={`border-l border-white/20 ${seg(cols > 1)}`}>
                กริด
              </button>
            </div>
            <div role="group" aria-label="ซูม" className="flex items-center overflow-hidden rounded-lg border border-white/20" title="Ctrl + ล้อเมาส์ เพื่อซูม">
              <button onClick={() => zoomBy(-1)} disabled={cols === 1 ? zoom <= 0.5 : cols >= 5} aria-label="ซูมออก" className={`${seg(false)} disabled:opacity-30`}>
                −
              </button>
              <button onClick={() => (cols === 1 ? setZoom(1) : setCols(3))} title="กลับค่าเริ่มต้น" className={`min-w-16 whitespace-nowrap text-center ${seg(false)}`}>
                {cols === 1 ? `${Math.round(zoom * 100)}%` : `${cols} หน้า/แถว`}
              </button>
              <button onClick={() => zoomBy(1)} disabled={cols === 1 ? zoom >= 2 : cols <= 2} aria-label="ซูมเข้า" className={`${seg(false)} disabled:opacity-30`}>
                +
              </button>
            </div>
            {cols > 1 && (
              <div role="group" aria-label="จำนวนหน้าต่อแถว" className="flex items-center gap-1">
                <span className="mr-1 text-xs text-white/50">ต่อแถว</span>
                {[2, 3, 4, 5].map((c) => (
                  <button key={c} onClick={() => setCols(c)} aria-pressed={cols === c} className={`rounded-md ${seg(cols === c)}`}>
                    {c}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        <button onClick={onClose} aria-label="ปิด" title="ปิด (Esc)" className="rounded-full px-3 py-1 text-lg hover:bg-white/15">
          ✕
        </button>
      </div>
      {urls ? (
        <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-6 pb-10">
          <ol
            className={`mx-auto grid items-start gap-6 ${cols === 1 ? "" : "max-w-7xl"}`}
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, width: cols === 1 ? `${768 * zoom}px` : undefined }}
          >
            {urls.map((url, n) => (
              <li key={n} data-n={n} className="flex w-full flex-col items-center gap-2">
                <img src={url} alt={`หน้า ${n + 1}`} className="w-full bg-white shadow-2xl" />
                <span className="text-xs text-white/50">
                  {n + 1} / {urls.length}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 text-white/80">
          {failed ? (
            <p className="text-sm">เตรียมตัวอย่างไม่สำเร็จ</p>
          ) : (
            <>
              <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/20 border-t-white" />
              <p className="text-sm">
                กำลังเตรียมตัวอย่าง… {progress.total ? `${progress.done} / ${progress.total} หน้า` : ""}
              </p>
              <div className="h-1.5 w-64 overflow-hidden rounded-full bg-white/15">
                <div className="h-full bg-white transition-[width]" style={{ width: `${pct}%` }} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
