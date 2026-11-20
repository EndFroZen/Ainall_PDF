// Building blocks shared by the tool pages (merge, split, compress, …).
import { useEffect, useState, type ReactNode } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { IconUpload } from "./icons";

/** Calls `onDrop` with paths dropped from Explorer; returns true while files hover the window. */
export function useFileDrop(onDrop: (paths: string[]) => void) {
  const [dragOver, setDragOver] = useState(false);
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
          onDrop(p.paths);
        }
      })
      .then((fn) => (disposed ? fn() : (unlisten = fn)));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [onDrop]);
  return dragOver;
}

/**
 * Drag-to-reorder for a list of `{ key }` items. Spread `handle(key)` on the grip and put
 * `data-key` on each item. Pointer events, not HTML5 drag & drop: Tauri's file-drop
 * handling swallows HTML5 drag events on Windows.
 */
export function useReorder<T extends { key: number }>(setItems: (fn: (cur: T[]) => T[]) => void, disabled = false) {
  const [dragKey, setDragKey] = useState<number | null>(null);
  const handle = (key: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (disabled) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setDragKey(key);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (dragKey === null) return;
      const el = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>("[data-key]");
      const overKey = el ? Number(el.dataset.key) : null;
      if (overKey === null || overKey === dragKey) return;
      setItems((cur) => {
        const from = cur.findIndex((x) => x.key === dragKey);
        const to = cur.findIndex((x) => x.key === overKey);
        if (from < 0 || to < 0) return cur;
        const next = [...cur];
        next.splice(to, 0, ...next.splice(from, 1));
        return next;
      });
    },
    onPointerUp: () => setDragKey(null),
    onPointerCancel: () => setDragKey(null),
    title: "ลากเพื่อเรียงลำดับ",
    className: `touch-none select-none ${disabled ? "opacity-30" : dragKey === key ? "cursor-grabbing" : "cursor-grab"}`,
  });
  return { dragKey, handle };
}

/** Moves item `i` one step up (-1) or down (1). */
export const moveItem = <T,>(list: T[], i: number, d: -1 | 1) => {
  const next = [...list];
  [next[i], next[i + d]] = [next[i + d], next[i]];
  return next;
};

/** Big dashed "click or drop files here" target. */
export function DropZone({ onClick, dragOver, label }: { onClick: () => void; dragOver: boolean; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-16 text-neutral-500 transition dark:text-neutral-400 ${
        dragOver ? "border-maroon bg-maroon/5 dark:border-coral" : "border-maroon/20 hover:border-maroon/40 dark:border-white/15"
      }`}
    >
      <IconUpload className="h-8 w-8" />
      <span className="text-sm">{label}</span>
    </button>
  );
}

/** Rounded panel; highlighted while files are dragged over the window. */
export function Panel({ dragOver = false, className = "", children }: { dragOver?: boolean; className?: string; children: ReactNode }) {
  return (
    <div
      className={`rounded-2xl border bg-cream dark:bg-ink-900 ${
        dragOver ? "border-maroon dark:border-coral" : "border-maroon/10 dark:border-white/10"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** A radio option drawn as a selectable card. */
export function Choice({
  name,
  checked,
  onChange,
  title,
  desc,
  children,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: ReactNode;
  desc?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <label
      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition ${
        checked
          ? "border-maroon bg-maroon/5 dark:border-coral dark:bg-coral/10"
          : "border-maroon/10 hover:border-maroon/30 dark:border-white/10 dark:hover:border-white/25"
      }`}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-1 accent-maroon" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        {desc && <span className="block text-sm text-neutral-500 dark:text-neutral-400">{desc}</span>}
        {children}
      </span>
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-maroon/20 bg-white px-3 py-2 text-sm outline-none focus:border-maroon dark:border-white/15 dark:bg-ink-950 dark:focus:border-coral";
export const iconBtn =
  "rounded-full p-1.5 text-neutral-500 hover:bg-maroon/10 disabled:opacity-30 dark:hover:bg-white/10";
export const sectionTitle = "mb-3 text-xs font-medium uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400";

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
