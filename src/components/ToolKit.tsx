// Building blocks shared by the tool pages (merge, split, compress, …).
import { useEffect, useRef, useState, type ReactNode } from "react";
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
  // A copy of the dragged item follows the pointer; the original stays put, faded, until drop.
  // A bar between items shows the insertion point; the move happens on release.
  type Drag = {
    key: number;
    src: HTMLElement;
    startX: number;
    startY: number;
    x: number;
    y: number;
    // Created once the pointer has moved a few px, so a plain click doesn't flash anything.
    el?: HTMLElement;
    bar?: HTMLElement;
    dx: number;
    dy: number;
    target: { key: number; after: boolean } | null;
    raf: number;
  };
  const ghost = useRef<Drag | null>(null);

  const startVisuals = (g: Drag) => {
    const r = g.src.getBoundingClientRect();
    const el = g.src.cloneNode(true) as HTMLElement;
    el.removeAttribute("id");
    Object.assign(el.style, {
      position: "fixed",
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
      margin: "0",
      zIndex: "60",
      pointerEvents: "none",
      opacity: "0.9",
      transform: "rotate(3deg) scale(0.7)", // smaller, so the drop spot stays visible
      transformOrigin: `${g.startX - r.left}px ${g.startY - r.top}px`, // shrink around the grab point
      boxShadow: "0 12px 32px rgba(0,0,0,.25)",
    });
    const bar = document.createElement("div");
    Object.assign(bar.style, { position: "fixed", zIndex: "61", boxShadow: "0 0 0 2px white", pointerEvents: "none", display: "none", borderRadius: "3px" });
    bar.className = "bg-maroon dark:bg-coral";
    document.body.append(el, bar);
    g.src.style.opacity = "0.35";
    g.src.style.outline = "2px dashed currentColor";
    Object.assign(g, { el, bar, dx: g.startX - r.left, dy: g.startY - r.top });
    // Auto-scroll while the pointer is near the top/bottom of the scrolling area.
    const scroller = scrollParent(g.src);
    const tick = () => {
      if (ghost.current !== g) return;
      if (scroller) {
        const s = scroller.getBoundingClientRect();
        const edge = 60;
        const v = g.y < s.top + edge ? -(s.top + edge - g.y) : g.y > s.bottom - edge ? g.y - (s.bottom - edge) : 0;
        if (v) {
          scroller.scrollTop += Math.max(-25, Math.min(25, v / 3));
          track(g);
        }
      }
      g.raf = requestAnimationFrame(tick);
    };
    g.raf = requestAnimationFrame(tick);
  };

  /** Moves the floating copy to the pointer and places the insertion bar. */
  const track = (g: Drag) => {
    if (!g.el || !g.bar) return;
    g.el.style.left = `${g.x - g.dx}px`;
    g.el.style.top = `${g.y - g.dy}px`;
    const el = document.elementFromPoint(g.x, g.y)?.closest<HTMLElement>("[data-key]");
    if (!el || el === g.src || el.parentElement !== g.src.parentElement) {
      g.target = null;
      g.bar.style.display = "none";
      return;
    }
    // Grid items sit side by side → vertical bar left/right; full-width rows → horizontal bar above/below.
    const r = el.getBoundingClientRect();
    const row = r.width > (el.parentElement?.clientWidth ?? 0) * 0.8;
    const after = row ? g.y > r.top + r.height / 2 : g.x > r.left + r.width / 2;
    g.target = { key: Number(el.dataset.key), after };
    const gap = 8; // half of gap-4, so the bar sits in the gutter
    Object.assign(
      g.bar.style,
      row
        ? { display: "block", left: `${r.left}px`, width: `${r.width}px`, height: "4px", top: `${(after ? r.bottom : r.top) - 2}px` }
        : { display: "block", top: `${r.top}px`, height: `${r.height}px`, width: "4px", left: `${(after ? r.right + gap : r.left - gap) - 2}px` },
    );
  };

  const endDrag = (drop: boolean) => {
    const g = ghost.current;
    ghost.current = null;
    if (g) {
      cancelAnimationFrame(g.raf);
      g.el?.remove();
      g.bar?.remove();
      g.src.style.opacity = "";
      g.src.style.outline = "";
      const t = g.target;
      const dragKey = g.key;
      if (drop && t && t.key !== dragKey)
        setItems((cur) => {
          const from = cur.findIndex((x) => x.key === dragKey);
          if (from < 0) return cur;
          const next = [...cur];
          const [moved] = next.splice(from, 1);
          const to = next.findIndex((x) => x.key === t.key);
          if (to < 0) return cur;
          next.splice(to + (t.after ? 1 : 0), 0, moved);
          return next;
        });
    }
    setDragKey(null);
  };
  // Leaving the page mid-drag: don't leave the floating copy behind.
  useEffect(() => () => endDrag(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  const handle = (key: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (disabled || e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const src = e.currentTarget.closest<HTMLElement>("[data-key]") ?? (e.currentTarget as HTMLElement);
      ghost.current = { key, src, startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY, dx: 0, dy: 0, target: null, raf: 0 };
    },
    onPointerMove: (e: React.PointerEvent) => {
      const g = ghost.current;
      if (!g) return;
      g.x = e.clientX;
      g.y = e.clientY;
      if (!g.el) {
        if (Math.hypot(g.x - g.startX, g.y - g.startY) < 5) return;
        startVisuals(g);
        setDragKey(g.key);
      }
      track(g);
    },
    onPointerUp: () => endDrag(true),
    onPointerCancel: () => endDrag(false),
    onLostPointerCapture: () => ghost.current && endDrag(false),
    title: "ลากเพื่อเรียงลำดับ",
    className: `touch-none select-none ${disabled ? "opacity-30" : dragKey === key ? "cursor-grabbing" : "cursor-grab"}`,
  });
  return { dragKey, handle };
}

/** Nearest ancestor that scrolls vertically. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if ((o === "auto" || o === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** Moves item `i` one step up (-1) or down (1). */
export const moveItem = <T,>(list: T[], i: number, d: -1 | 1) => {
  const next = [...list];
  [next[i], next[i + d]] = [next[i + d], next[i]];
  return next;
};

/** Big dashed "click or drop files here" target. */
export function DropZone({ onClick, dragOver, label, className = "" }: { onClick: () => void; dragOver: boolean; label: string; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full flex-col items-center justify-center gap-3 ${className} rounded-2xl px-6 py-16 text-neutral-500 transition dark:text-neutral-400 ${
        dragOver ? "bg-maroon/5" : "hover:bg-maroon/5 dark:hover:bg-white/5"
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
      className={`rounded-2xl border bg-white dark:bg-ink-900 ${
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
export const sectionTitle = "mb-2 text-sm font-medium text-neutral-600 dark:text-neutral-400";

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
