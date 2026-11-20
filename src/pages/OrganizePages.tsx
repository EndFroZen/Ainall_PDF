import { useCallback, useEffect, useRef, useState } from "react";
import PageShell, { actionPrimary, actionSecondary } from "../components/PageShell";
import { IconFile, IconTrash, IconUpload } from "../components/icons";
import { DropZone, Panel, errText, iconBtn, moveItem, useFileDrop, useReorder } from "../components/ToolKit";
import { countPages, exportPdf, fileName, pickPdfPaths } from "../lib/pdf";
import { buildPdf, renderThumbs } from "../lib/tools";
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

const pagesOf = (f: FileItem): PageItem[] =>
  Array.from({ length: f.pages ?? 0 }, (_, index) => ({ key: nextKey++, path: f.path, index, rotate: 0 }));

/**
 * Merge and organize in one tool. "files" view orders whole files (fast for big files);
 * "pages" view shows every page of every file to reorder, rotate, duplicate or delete.
 */
export default function OrganizePages({ onBack, onError, onDone }: ToolProps) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [view, setView] = useState<"files" | "pages">("files");
  const [pages, setPages] = useState<PageItem[] | null>(null); // null = not built from `files` yet
  const [thumbs, setThumbs] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const jobs = useRef(new Map<string, () => void>());

  const addPaths = useCallback(
    (paths: string[]) => {
      const pdfs = paths.filter((p) => /\.pdf$/i.test(p));
      if (pdfs.length < paths.length) onError("ข้ามไฟล์ที่ไม่ใช่ PDF");
      const added = pdfs.map((path) => ({ key: nextKey++, path }));
      setFiles((cur) => {
        if (!cur.length && added.length === 1) setView("pages"); // one file: go straight to its pages
        return [...cur, ...added];
      });
      for (const it of added) {
        void countPages(it.path).then((n) => {
          if (n === null) {
            onError(`อ่านไฟล์ ${fileName(it.path)} ไม่ได้`);
            return setFiles((cur) => cur.filter((x) => x.key !== it.key));
          }
          const done = { ...it, pages: n };
          setFiles((cur) => cur.map((x) => (x.key === it.key ? done : x)));
          setPages((cur) => (cur ? [...cur, ...pagesOf(done)] : cur)); // added while in page view
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
  const pageDrag = useReorder((fn: (cur: PageItem[]) => PageItem[]) => setPages((cur) => cur && fn(cur)), busy);

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
      const job = renderThumbs(path, 220, (i, url) =>
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

  const update = (key: number, fn: (p: PageItem) => PageItem) =>
    setPages((cur) => cur && cur.map((p) => (p.key === key ? fn(p) : p)));
  const duplicate = (key: number) =>
    setPages((cur) => {
      if (!cur) return cur;
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

  const toFiles = () => {
    setView("files");
    setPages(null);
  };

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
      <div className={`mx-auto p-6 lg:p-10 ${view === "pages" ? "max-w-6xl" : "max-w-3xl"}`}>
        {files.length === 0 ? (
          <DropZone onClick={addViaDialog} dragOver={dragOver} label="คลิกเพื่อเลือกไฟล์ PDF หรือลากไฟล์มาวางที่นี่" />
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
          <Panel dragOver={dragOver} className="p-4">
            {!pages ? (
              <p className="py-10 text-center text-sm text-neutral-500">กำลังอ่านไฟล์…</p>
            ) : (
              <ol className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
                {pages.map((p, i) => {
                  const thumb = thumbs[p.path]?.[p.index];
                  const label = `${files.length > 1 ? `${fileName(p.path)} ` : ""}หน้า ${p.index + 1}`;
                  return (
                    <li
                      key={p.key}
                      data-key={p.key}
                      className={`overflow-hidden rounded-xl border bg-white dark:bg-ink-950 ${
                        pageDrag.dragKey === p.key ? "border-maroon ring-2 ring-maroon/30 dark:border-coral" : "border-maroon/10 dark:border-white/10"
                      }`}
                    >
                      <div {...pageDrag.handle(p.key)} className={`${pageDrag.handle(p.key).className} flex aspect-square items-center justify-center p-2`}>
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={label}
                            draggable={false}
                            style={{ transform: `rotate(${p.rotate}deg)` }}
                            className="max-h-full max-w-full shadow-sm transition-transform"
                          />
                        ) : (
                          <IconFile className="h-8 w-8 animate-pulse text-neutral-300" />
                        )}
                      </div>
                      <div className="flex items-center gap-0.5 border-t border-maroon/10 px-1.5 py-1 text-xs dark:border-white/10">
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
                        <button onClick={() => duplicate(p.key)} disabled={busy} aria-label="ทำสำเนา" title="ทำสำเนา" className={iconBtn}>
                          ⧉
                        </button>
                        <button
                          onClick={() => setPages((cur) => cur && cur.filter((x) => x.key !== p.key))}
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
        )}
      </div>
    </PageShell>
  );
}
