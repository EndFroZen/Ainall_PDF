import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Landing from "./pages/Landing";
import Viewer from "./pages/Viewer";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Tools, { CompressPdf, SplitPdf, type Tool, type ToolProps } from "./pages/Tools";
import OrganizePages from "./pages/OrganizePages";
import ImagesToPdf from "./pages/ImagesToPdf";
import PdfToImages from "./pages/PdfToImages";
import StampPdf from "./pages/StampPdf";
import { showMainWindow } from "./lib/window";
import {
  closePdf,
  createBlankPdf,
  describePdfError,
  fileName,
  loadPdf,
  openBytes,
  pickPdfPath,
  savePdf,
  savePdfAs,
  type OpenedPdf,
} from "./lib/pdf";
import { Modal, btnGhost, btnPrimary } from "./components/Dialogs";

type View =
  | { name: "landing" }
  | { name: "projects" }
  | { name: "project"; id: number }
  | { name: "tools" }
  | { name: "tool"; tool: Tool };

const TOOL_PAGES: Record<Tool, (p: ToolProps) => React.JSX.Element> = {
  split: SplitPdf,
  compress: CompressPdf,
  organize: OrganizePages,
  images: ImagesToPdf,
  toImages: PdfToImages,
  stamp: StampPdf,
};

interface Loading {
  name: string;
  cancel: () => void;
}

export default function App() {
  // The page shown when no PDF is open; closing the viewer returns here.
  const [view, setView] = useState<View>({ name: "landing" });
  const [pdf, setPdf] = useState<OpenedPdf | null>(null);
  const [loading, setLoading] = useState<Loading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadingRef = useRef<Loading | null>(null);
  const pdfRef = useRef<OpenedPdf | null>(null);

  useEffect(() => {
    // Wait one frame so the first paint is ready before the window appears.
    const id = requestAnimationFrame(() => void showMainWindow());
    return () => cancelAnimationFrame(id);
  }, []);

  // App owns the open document: destroy the previous one only when it is replaced or closed
  // (saving produces a new OpenedPdf object around the same pdf.js document).
  const replacePdf = useCallback((next: OpenedPdf | null) => {
    const prev = pdfRef.current;
    pdfRef.current = next;
    setPdf(next);
    if (prev && prev.doc !== next?.doc) closePdf(prev);
  }, []);

  // ---- Unsaved-changes guard -------------------------------------------------
  const [unsavedPrompt, setUnsavedPrompt] = useState<((choice: "save" | "discard" | "cancel") => void) | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // The viewer puts its "flatten annotations into the PDF" function here.
  const bakeRef = useRef<(() => Promise<Uint8Array | null>) | null>(null);

  const doSave = useCallback(async (asNew: boolean): Promise<boolean> => {
    let cur = pdfRef.current;
    if (!cur) return true;
    setSaving(true);
    try {
      const baked = await bakeRef.current?.();
      if (baked) cur = { ...cur, bytes: baked, dirty: true };
      let next = asNew ? await savePdfAs(cur) : await savePdf(cur);
      if (!next) return false; // cancelled the Save dialog
      // Show the saved content (annotations now part of the page) instead of the old document.
      if (baked) next = { ...next, doc: await openBytes(baked) };
      if (pdfRef.current?.id === cur.id) replacePdf(next);
      else if (baked) closePdf(next);
      setToast(`บันทึกแล้ว: ${next.name}`);
      return true;
    } catch (e) {
      setError(`บันทึกไม่สำเร็จ: ${describePdfError(e)}`);
      return false;
    } finally {
      setSaving(false);
    }
  }, [replacePdf]);

  const markDirty = useCallback(() => {
    const cur = pdfRef.current;
    if (cur && !cur.dirty) replacePdf({ ...cur, dirty: true });
  }, [replacePdf]);

  /** Replaces the open document's content with edited bytes. */
  const applyEdit = useCallback(
    async (make: () => Promise<Uint8Array>) => {
      const cur = pdfRef.current;
      if (!cur) return;
      try {
        const bytes = await make();
        const doc = await openBytes(bytes);
        const now = pdfRef.current;
        if (now?.id !== cur.id) return void doc.loadingTask.destroy();
        replacePdf({ ...now, bytes, doc, dirty: true });
      } catch (e) {
        setError(`แก้ไขไม่สำเร็จ: ${describePdfError(e)}`);
      }
    },
    [replacePdf],
  );

  /** Runs `action` only after unsaved changes are saved or explicitly discarded. */
  const guard = useCallback(
    async (action: () => void | Promise<void>) => {
      if (!pdfRef.current?.dirty) return void (await action());
      const choice = await new Promise<"save" | "discard" | "cancel">((resolve) =>
        setUnsavedPrompt(() => resolve),
      );
      setUnsavedPrompt(null);
      if (choice === "cancel") return;
      if (choice === "save" && !(await doSave(false))) return;
      await action();
    },
    [doSave],
  );

  const cancelLoading = useCallback(() => {
    loadingRef.current?.cancel();
    loadingRef.current = null;
    setLoading(null);
  }, []);

  const openPath = useCallback(
    async (path: string, opts?: { recordRecent?: boolean }) => {
      cancelLoading(); // a new request supersedes one still in flight
      setError(null);
      const { promise, cancel } = loadPdf(path, opts);
      const me: Loading = { name: fileName(path), cancel };
      loadingRef.current = me;
      setLoading(me);
      try {
        const opened = await promise;
        if (loadingRef.current !== me) return closePdf(opened); // superseded
        replacePdf(opened);
      } catch (e) {
        if (loadingRef.current === me) setError(describePdfError(e));
      } finally {
        if (loadingRef.current === me) {
          loadingRef.current = null;
          setLoading(null);
        }
      }
    },
    [cancelLoading, replacePdf],
  );

  const openFile = useCallback(
    () =>
      guard(async () => {
        try {
          const path = await pickPdfPath();
          if (path) await openPath(path);
        } catch (e) {
          setError(describePdfError(e));
        }
      }),
    [guard, openPath],
  );

  const newDocument = useCallback(
    () =>
      guard(async () => {
        try {
          replacePdf(await createBlankPdf());
        } catch (e) {
          setError(`สร้างเอกสารไม่ได้: ${describePdfError(e)}`);
        }
      }),
    [guard, replacePdf],
  );

  const closeDocument = useCallback(() => guard(() => replacePdf(null)), [guard, replacePdf]);

  // "Open with" from Explorer: the file the app was launched with, and files sent by later
  // launches while it's running (single-instance plugin → "open-file" event).
  useEffect(() => {
    const openExternal = (path: string) => void guard(() => openPath(path));
    void invoke<string | null>("launch_file").then((p) => p && openExternal(p)).catch(() => {});
    const unlisten = listen<string>("open-file", (e) => openExternal(e.payload));
    return () => void unlisten.then((fn) => fn());
  }, [guard, openPath]);

  // Ctrl+O anywhere, Esc cancels loading
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void openFile();
      } else if (e.key === "Escape" && loadingRef.current) {
        cancelLoading();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openFile, cancelLoading]);

  // Auto-dismiss errors / notices
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const showError = useCallback((msg: string) => setError(msg), []);
  const toLanding = useCallback(() => setView({ name: "landing" }), []);
  const toProjects = useCallback(() => setView({ name: "projects" }), []);
  const toTools = useCallback(() => setView({ name: "tools" }), []);
  const toolDone = useCallback<ToolProps["onDone"]>(
    (r) => ("open" in r ? void openPath(r.open) : setToast(r.notice)),
    [openPath],
  );
  const openProjectFile =useCallback((path: string) => openPath(path, { recordRecent: false }), [openPath]);

  return (
    <>
      {pdf ? (
        <Viewer
          key={pdf.id}
          pdf={pdf}
          onClose={closeDocument}
          onOpenAnother={openFile}
          onSave={() => void doSave(false)}
          onSaveAs={() => void doSave(true)}
          saving={saving}
          onDirty={markDirty}
          onEdit={applyEdit}
          bakeRef={bakeRef}
        />
      ) : view.name === "projects" ? (
        <Projects
          onBack={toLanding}
          onOpenProject={(id) => setView({ name: "project", id })}
          onError={showError}
        />
      ) : view.name === "tools" ? (
        <Tools onBack={toLanding} onOpen={(tool) => setView({ name: "tool", tool })} onBlank={newDocument} />
      ) : view.name === "tool" ? (
        (() => {
          const Page = TOOL_PAGES[view.tool];
          return <Page onBack={toTools} onError={showError} onDone={toolDone} />;
        })()
      ) : view.name === "project" ? (
        <ProjectDetail
          key={view.id}
          projectId={view.id}
          onBack={toProjects}
          onOpenFile={openProjectFile}
          onError={showError}
        />
      ) : (
        <Landing
          onOpenFile={openFile}
          onOpenPath={openPath}
          onNewDocument={() => setView({ name: "tools" })}
          onOpenProjects={toProjects}
          busy={!!loading}
        />
      )}

      {unsavedPrompt && (
        <Modal title="ยังไม่ได้บันทึก" onClose={() => unsavedPrompt("cancel")}>
          <p className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">
            <b className="font-semibold">{pdf?.name}</b> มีการเปลี่ยนแปลงที่ยังไม่ได้บันทึก ต้องการบันทึกก่อนไหม?
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button onClick={() => unsavedPrompt("cancel")} className={btnGhost}>
              ยกเลิก
            </button>
            <button onClick={() => unsavedPrompt("discard")} className={btnGhost}>
              ไม่บันทึก
            </button>
            <button onClick={() => unsavedPrompt("save")} className={btnPrimary} autoFocus>
              บันทึก
            </button>
          </div>
        </Modal>
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-6 left-1/2 z-50 flex max-w-lg -translate-x-1/2 items-center gap-3 rounded-xl bg-neutral-900 px-4 py-3 text-sm text-white shadow-2xl dark:bg-ink-800 dark:ring-1 dark:ring-white/10 animate-rise"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
          <span className="min-w-0 truncate">{toast}</span>
        </div>
      )}

      {loading && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
          <div
            role="status"
            className="flex w-[min(26rem,calc(100%-2rem))] items-center gap-4 rounded-2xl bg-cream px-5 py-4 text-neutral-900 shadow-2xl dark:bg-ink-900 dark:text-neutral-100 dark:ring-1 dark:ring-white/10 animate-rise"
          >
            <span className="h-6 w-6 shrink-0 animate-spin rounded-full border-[3px] border-maroon/20 border-t-maroon dark:border-coral/20 dark:border-t-coral" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">กำลังเปิดเอกสาร…</p>
              <p className="truncate text-xs text-neutral-500 dark:text-neutral-400" title={loading.name}>
                {loading.name}
              </p>
            </div>
            <button
              onClick={cancelLoading}
              className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-maroon transition hover:bg-maroon/10 dark:text-coral dark:hover:bg-coral/10"
            >
              ยกเลิก
            </button>
          </div>
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="fixed bottom-6 left-1/2 z-50 flex max-w-lg -translate-x-1/2 items-center gap-3 rounded-xl bg-neutral-900 px-4 py-3 text-sm text-white shadow-2xl dark:bg-ink-800 dark:ring-1 dark:ring-white/10 animate-rise"
        >
          <span className="h-2 w-2 shrink-0 rounded-full bg-brand-500" />
          <span className="min-w-0">{error}</span>
          <button onClick={() => setError(null)} className="ml-2 shrink-0 text-white/60 hover:text-white" aria-label="ปิด">
            ✕
          </button>
        </div>
      )}
    </>
  );
}
