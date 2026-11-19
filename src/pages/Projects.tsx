import { useCallback, useEffect, useState } from "react";
import { openPath } from "@tauri-apps/plugin-opener";
import PageShell, { actionPrimary } from "../components/PageShell";
import Menu from "../components/Menu";
import { ConfirmDialog, PromptDialog } from "../components/Dialogs";
import { IconFolder, IconFolderOpen, IconPencil, IconPlus, IconTrash } from "../components/icons";
import {
  createProject,
  deleteProject,
  formatDate,
  listProjects,
  projectDir,
  renameProject,
  type Project,
} from "../lib/projects";

type DialogState =
  | { kind: "create" }
  | { kind: "rename"; project: Project }
  | { kind: "delete"; project: Project }
  | null;

export default function Projects({
  onBack,
  onOpenProject,
  onError,
}: {
  onBack: () => void;
  onOpenProject: (id: number) => void;
  onError: (msg: string) => void;
}) {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const refresh = useCallback(() => {
    listProjects()
      .then(setProjects)
      .catch((e) => {
        setProjects([]);
        onError(String(e));
      });
  }, [onError]);

  useEffect(refresh, [refresh]);

  const openFolder = async (p: Project) => {
    try {
      await openPath(await projectDir(p.id));
    } catch (e) {
      onError(`เปิดโฟลเดอร์ไม่ได้: ${e}`);
    }
  };

  return (
    <PageShell
      title="โปรเจกต์"
      subtitle={projects ? `${projects.length} โปรเจกต์` : " "}
      onBack={onBack}
      backLabel="กลับหน้าแรก"
      actions={
        <button onClick={() => setDialog({ kind: "create" })} className={actionPrimary}>
          <IconPlus className="h-4 w-4" />
          โปรเจกต์ใหม่
        </button>
      }
    >
      <div className="mx-auto max-w-6xl px-4 py-8 lg:px-8">
        {projects === null ? null : projects.length === 0 ? (
          <EmptyState onCreate={() => setDialog({ kind: "create" })} />
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-4">
            <li>
              <button
                onClick={() => setDialog({ kind: "create" })}
                className="flex h-full min-h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-maroon/20 text-sm font-medium text-maroon/70 transition hover:border-maroon/50 hover:bg-maroon/5 hover:text-maroon dark:border-white/15 dark:text-neutral-400 dark:hover:border-coral/60 dark:hover:bg-coral/5 dark:hover:text-coral"
              >
                <IconPlus className="h-6 w-6" />
                โปรเจกต์ใหม่
              </button>
            </li>
            {projects.map((p) => (
              <li key={p.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenProject(p.id)}
                  onKeyDown={(e) => e.key === "Enter" && onOpenProject(p.id)}
                  className="group flex h-full min-h-40 cursor-pointer flex-col rounded-2xl border border-maroon/10 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-maroon/30 hover:shadow-md focus-visible:outline-2 focus-visible:outline-maroon dark:border-white/10 dark:bg-ink-900 dark:hover:border-coral/40"
                >
                  <div className="flex items-start justify-between">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-maroon/10 text-maroon dark:bg-coral/15 dark:text-coral">
                      <IconFolder className="h-6 w-6" />
                    </span>
                    <Menu
                      items={[
                        { label: "เปลี่ยนชื่อ", icon: <IconPencil />, onSelect: () => setDialog({ kind: "rename", project: p }) },
                        { label: "เปิดโฟลเดอร์", icon: <IconFolderOpen />, onSelect: () => openFolder(p) },
                        { label: "ลบโปรเจกต์", icon: <IconTrash />, danger: true, onSelect: () => setDialog({ kind: "delete", project: p }) },
                      ]}
                    />
                  </div>
                  <h2 className="mt-4 line-clamp-2 font-semibold leading-snug" title={p.name}>
                    {p.name}
                  </h2>
                  <p className="mt-1 text-sm text-neutral-500 dark:text-neutral-400">
                    {p.file_count} ไฟล์{p.page_total > 0 && ` · ${p.page_total.toLocaleString()} หน้า`}
                  </p>
                  <p className="mt-auto pt-3 text-xs text-neutral-400 dark:text-neutral-500">
                    แก้ไขล่าสุด {formatDate(p.updated_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {dialog?.kind === "create" && (
        <PromptDialog
          title="โปรเจกต์ใหม่"
          label="ชื่อโปรเจกต์"
          placeholder="เช่น เอกสารประชุมเดือนนี้"
          confirmLabel="สร้าง"
          onSubmit={async (name) => {
            const id = await createProject(name);
            onOpenProject(id);
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "rename" && (
        <PromptDialog
          title="เปลี่ยนชื่อโปรเจกต์"
          label="ชื่อโปรเจกต์"
          initial={dialog.project.name}
          onSubmit={async (name) => {
            await renameProject(dialog.project.id, name);
            refresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === "delete" && (
        <ConfirmDialog
          title="ลบโปรเจกต์"
          message={
            <>
              ลบ <b className="font-semibold">{dialog.project.name}</b> และไฟล์ทั้งหมด {dialog.project.file_count} ไฟล์ในโปรเจกต์นี้?
              <br />
              <span className="text-neutral-500 dark:text-neutral-400">ไฟล์ต้นฉบับที่คุณเพิ่มเข้ามาจะไม่ถูกลบ ลบเฉพาะสำเนาในโปรเจกต์</span>
            </>
          }
          confirmLabel="ลบโปรเจกต์"
          onConfirm={async () => {
            await deleteProject(dialog.project.id);
            refresh();
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </PageShell>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center py-24 text-center animate-rise">
      <span className="flex h-20 w-20 items-center justify-center rounded-3xl bg-maroon/10 text-maroon dark:bg-coral/15 dark:text-coral">
        <IconFolder className="h-10 w-10" />
      </span>
      <h2 className="mt-6 text-xl font-semibold">ยังไม่มีโปรเจกต์</h2>
      <p className="mt-2 max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
        สร้างโปรเจกต์เพื่อรวบรวมไฟล์ PDF ที่เกี่ยวข้องไว้ด้วยกัน แต่ละโปรเจกต์มีโฟลเดอร์ของตัวเอง
      </p>
      <button onClick={onCreate} className={`${actionPrimary} mt-6`}>
        <IconPlus className="h-4 w-4" />
        สร้างโปรเจกต์แรก
      </button>
    </div>
  );
}
