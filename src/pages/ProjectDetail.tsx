import { useCallback, useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { openPath } from "@tauri-apps/plugin-opener";
import PageShell, { actionPrimary, actionSecondary } from "../components/PageShell";
import Menu from "../components/Menu";
import PdfThumb, { forgetThumb } from "../components/PdfThumb";
import { ConfirmDialog, PromptDialog } from "../components/Dialogs";
import { IconFolderOpen, IconPencil, IconTrash, IconUpload } from "../components/icons";
import { pickPdfPaths } from "../lib/pdf";
import {
  deleteFile,
  deleteProject,
  formatBytes,
  formatDate,
  getProject,
  importFiles,
  listFiles,
  projectDir,
  renameFile,
  renameProject,
  type Project,
  type ProjectFile,
} from "../lib/projects";

type DialogState =
  | { kind: "renameProject" }
  | { kind: "deleteProject" }
  | { kind: "renameFile"; file: ProjectFile }
  | { kind: "deleteFile"; file: ProjectFile }
  | null;

export default function ProjectDetail({
  projectId,
  onBack,
  onOpenFile,
  onError,
}: {
  projectId: number;
  onBack: () => void;
  onOpenFile: (path: string) => void;
  onError: (msg: string) => void;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [files, setFiles] = useState<ProjectFile[] | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [importing, setImporting] = useState<{ done: number; total: number } | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [p, f] = await Promise.all([getProject(projectId), listFiles(projectId)]);
      if (!p) return onBack(); // project no longer exists
      setProject(p);
      setFiles(f);
    } catch (e) {
      onError(String(e));
    }
  }, [projectId, onBack, onError]);

  useEffect(() => void refresh(), [refresh]);

  const addPaths = useCallback(
    async (paths: string[]) => {
      const pdfs = paths.filter((p) => /\.pdf$/i.test(p));
      if (pdfs.length < paths.length) onError("ข้ามไฟล์ที่ไม่ใช่ PDF");
      if (pdfs.length === 0) return;
      setImporting({ done: 0, total: pdfs.length });
      try {
        const { failed } = await importFiles(projectId, pdfs, (done, total) => setImporting({ done, total }));
        if (failed.length) onError(`เพิ่มไม่สำเร็จ ${failed.length} ไฟล์: ${failed.map((f) => f.name).join(", ")}`);
      } finally {
        setImporting(null);
        void refresh();
      }
    },
    [projectId, onError, refresh],
  );

  const addViaDialog = async () => {
    try {
      const paths = await pickPdfPaths();
      if (paths.length) await addPaths(paths);
    } catch (e) {
      onError(String(e));
    }
  };

  // Drag PDFs from Explorer onto the window
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;
    getCurrentWebview()
      .onDragDropEvent((e) => {
        const p = e.payload;
        if (p.type === "enter" || p.type === "over") setDragOver(true);
        else if (p.type === "leave") setDragOver(false);
        else if (p.type === "drop") {
          setDragOver(false);
          void addPaths(p.paths);
        }
      })
      .then((fn) => (disposed ? fn() : (unlisten = fn)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [addPaths]);

  const openFolder = async () => {
    try {
      await openPath(await projectDir(projectId));
    } catch (e) {
      onError(`เปิดโฟลเดอร์ไม่ได้: ${e}`);
    }
  };

  const busy = importing !== null;

  return (
    <PageShell
      title={
        project ? (
          <button
            onClick={() => setDialog({ kind: "renameProject" })}
            className="group flex max-w-full items-center gap-2 text-left"
            title="เปลี่ยนชื่อโปรเจกต์"
          >
            <span className="truncate">{project.name}</span>
            <IconPencil className="h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover:opacity-50" />
          </button>
        ) : (
          " "
        )
      }
      subtitle={
        project &&
        `${project.file_count} ไฟล์${project.page_total ? ` · ${project.page_total.toLocaleString()} หน้า` : ""}`
      }
      onBack={onBack}
      backLabel="กลับไปหน้าโปรเจกต์"
      actions={
        <>
          <button onClick={openFolder} className={actionSecondary} title="เปิดโฟลเดอร์ใน File Explorer">
            <IconFolderOpen className="h-4 w-4" />
            <span className="hidden sm:inline">เปิดโฟลเดอร์</span>
          </button>
          <button onClick={addViaDialog} disabled={busy} className={actionPrimary}>
            <IconUpload className="h-4 w-4" />
            เพิ่ม PDF
          </button>
          <Menu
            items={[
              { label: "เปลี่ยนชื่อโปรเจกต์", icon: <IconPencil />, onSelect: () => setDialog({ kind: "renameProject" }) },
              { label: "ลบโปรเจกต์", icon: <IconTrash />, danger: true, onSelect: () => setDialog({ kind: "deleteProject" }) },
            ]}
          />
        </>
      }
    >
      <div className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
        {importing && (
          <div className="mb-6 rounded-xl border border-maroon/15 bg-white px-4 py-3 dark:border-white/10 dark:bg-ink-900">
            <div className="mb-1.5 flex justify-between text-sm">
              <span>กำลังเพิ่มไฟล์…</span>
              <span className="tabular-nums text-neutral-500">
                {importing.done} / {importing.total}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-maroon/10 dark:bg-white/10">
              <div
                className="h-full rounded-full bg-maroon transition-[width] dark:bg-coral"
                style={{ width: `${(importing.done / importing.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {files === null ? null : files.length === 0 ? (
          <button
            onClick={addViaDialog}
            disabled={busy}
            className="flex w-full flex-col items-center rounded-3xl border-2 border-dashed border-maroon/20 px-6 py-20 text-center transition hover:border-maroon/40 hover:bg-maroon/[0.03] dark:border-white/15 dark:hover:border-coral/50 dark:hover:bg-coral/5"
          >
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-maroon/10 text-maroon dark:bg-coral/15 dark:text-coral">
              <IconUpload className="h-8 w-8" />
            </span>
            <span className="mt-5 text-lg font-semibold">เพิ่มไฟล์ PDF เข้าโปรเจกต์</span>
            <span className="mt-1.5 text-sm text-neutral-500 dark:text-neutral-400">
              คลิกเพื่อเลือกไฟล์ หรือลากไฟล์มาวางที่นี่ — ระบบจะคัดลอกไฟล์เข้าโฟลเดอร์ของโปรเจกต์
            </span>
          </button>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-5">
            {files.map((f) => (
              <li key={f.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenFile(f.path)}
                  onKeyDown={(e) => e.key === "Enter" && onOpenFile(f.path)}
                  title={f.name}
                  className="group cursor-pointer rounded-2xl border border-maroon/10 bg-white p-2.5 shadow-sm transition hover:-translate-y-0.5 hover:border-maroon/30 hover:shadow-md focus-visible:outline-2 focus-visible:outline-maroon dark:border-white/10 dark:bg-ink-900 dark:hover:border-coral/40"
                >
                  <PdfThumb path={f.path} className="aspect-[3/4] w-full rounded-lg ring-1 ring-black/5" />
                  <div className="mt-2.5 flex items-start gap-1 px-0.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{f.name.replace(/\.pdf$/i, "")}</p>
                      <p className="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">
                        {f.page_count != null && `${f.page_count.toLocaleString()} หน้า · `}
                        {formatBytes(f.size_bytes)}
                      </p>
                    </div>
                    <Menu
                      items={[
                        { label: "เปลี่ยนชื่อ", icon: <IconPencil />, onSelect: () => setDialog({ kind: "renameFile", file: f }) },
                        { label: "ลบออกจากโปรเจกต์", icon: <IconTrash />, danger: true, onSelect: () => setDialog({ kind: "deleteFile", file: f }) },
                      ]}
                    />
                  </div>
                  <p className="mt-1 px-0.5 text-[11px] text-neutral-400 dark:text-neutral-500">
                    เพิ่มเมื่อ {formatDate(f.added_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Drag & drop overlay */}
      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center bg-maroon/15 p-8 backdrop-blur-[2px] dark:bg-black/50">
          <div className="flex h-full w-full flex-col items-center justify-center rounded-3xl border-4 border-dashed border-maroon/60 bg-cream/80 dark:border-coral/60 dark:bg-ink-900/80">
            <IconUpload className="h-12 w-12 text-maroon dark:text-coral" />
            <p className="mt-4 text-lg font-semibold">วางไฟล์ PDF เพื่อเพิ่มเข้าโปรเจกต์</p>
          </div>
        </div>
      )}

      {project && dialog?.kind === "renameProject" && (
        <PromptDialog
          title="เปลี่ยนชื่อโปรเจกต์"
          label="ชื่อโปรเจกต์"
          initial={project.name}
          onSubmit={async (name) => {
            await renameProject(projectId, name);
            await refresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {project && dialog?.kind === "deleteProject" && (
        <ConfirmDialog
          title="ลบโปรเจกต์"
          message={
            <>
              ลบ <b className="font-semibold">{project.name}</b> และไฟล์ทั้งหมด {project.file_count} ไฟล์?
              <br />
              <span className="text-neutral-500 dark:text-neutral-400">ไฟล์ต้นฉบับที่คุณเพิ่มเข้ามาจะไม่ถูกลบ</span>
            </>
          }
          confirmLabel="ลบโปรเจกต์"
          onConfirm={async () => {
            await deleteProject(projectId);
            onBack();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "renameFile" && (
        <PromptDialog
          title="เปลี่ยนชื่อไฟล์"
          label="ชื่อไฟล์"
          initial={dialog.file.name}
          selectStem
          onSubmit={async (name) => {
            forgetThumb(dialog.file.path);
            await renameFile(dialog.file, name);
            await refresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "deleteFile" && (
        <ConfirmDialog
          title="ลบไฟล์"
          message={
            <>
              ลบ <b className="font-semibold">{dialog.file.name}</b> ออกจากโปรเจกต์?
              <br />
              <span className="text-neutral-500 dark:text-neutral-400">ไฟล์ต้นฉบับที่คุณเพิ่มเข้ามาจะไม่ถูกลบ</span>
            </>
          }
          onConfirm={async () => {
            await deleteFile(dialog.file);
            forgetThumb(dialog.file.path);
            await refresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </PageShell>
  );
}
