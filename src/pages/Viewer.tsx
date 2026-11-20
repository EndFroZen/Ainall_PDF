import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { sourceBytes, type OpenedPdf, type PDFDocument } from "../lib/pdf";
import PrintDialog from "../components/PrintDialog";
import ToolPanel from "../components/ToolPanel";
import AnnotationLayer, { type LayerCtl } from "../components/AnnotationLayer";
import {
  applyStyle,
  bake,
  DEFAULT_SETTINGS,
  measureText,
  styleOf,
  translate,
  uid,
  type Annot,
  type Picture,
  type Settings,
  type TextAnnot,
  type Tool,
} from "../lib/annotations";

const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const GAP = 24; // px between pages
const PAD = 32; // px around the page column
const OVERSCAN = 1200; // px rendered above/below the viewport
const MEASURE_BATCH = 64; // pages measured per background batch

interface PageSize {
  width: number;
  height: number;
}

/** Renders one page to a canvas. Only mounted while near the viewport. */
const PageView = memo(function PageView({
  doc,
  pageNumber,
  scale,
  width,
  height,
}: {
  doc: PDFDocument;
  pageNumber: number;
  scale: number;
  width: number;
  height: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rendered, setRendered] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    // Small delay so pages flying past during fast scrolling don't start rendering.
    const timer = setTimeout(async () => {
      try {
        const page = await doc.getPage(pageNumber);
        if (cancelled) return;
        const dpr = window.devicePixelRatio || 1;
        const viewport = page.getViewport({ scale: scale * dpr });
        // Render offscreen, then swap in, so the old image stays visible while zooming.
        const off = document.createElement("canvas");
        off.width = Math.floor(viewport.width);
        off.height = Math.floor(viewport.height);
        task = page.render({ canvas: off, viewport });
        await task.promise;
        if (cancelled) return;
        const canvas = canvasRef.current!;
        canvas.width = off.width;
        canvas.height = off.height;
        canvas.getContext("2d")!.drawImage(off, 0, 0);
        setRendered(true);
      } catch {
        /* cancelled or page failed — leave placeholder */
      }
    }, 30);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      task?.cancel();
    };
  }, [doc, pageNumber, scale]);

  return (
    <div
      className="relative bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12),0_8px_24px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.5),0_8px_24px_rgba(0,0,0,0.4)]"
      style={{ width, height }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {!rendered && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-neutral-300">{pageNumber}</div>
      )}
    </div>
  );
});

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-md p-1.5 text-neutral-600 transition hover:bg-neutral-100 hover:text-maroon dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-coral disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

const svg = {
  viewBox: "0 0 24 24",
  className: "h-5 w-5",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Index of the last page whose top is <= y. */
function pageAt(tops: number[], y: number) {
  let lo = 0,
    hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export default function Viewer({
  pdf,
  onClose,
  onOpenAnother,
  onSave,
  onSaveAs,
  saving,
  onDirty,
  onEdit,
  bakeRef,
}: {
  pdf: OpenedPdf;
  onClose: () => void;
  onOpenAnother: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  saving: boolean;
  /** Called when annotations change (marks the document unsaved). */
  onDirty: () => void;
  /** Replaces the document content with new bytes (e.g. after rotating a page). */
  onEdit: (make: () => Promise<Uint8Array>) => void;
  /** Set by the viewer: flattens pending annotations into PDF bytes (null = nothing to do). */
  bakeRef: React.MutableRefObject<(() => Promise<Uint8Array | null>) | null>;
}) {
  const { doc, name } = pdf;
  const n = doc.numPages;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [sizes, setSizes] = useState<PageSize[] | null>(null);
  const [scale, setScale] = useState(1);
  const [scrollTop, setScrollTop] = useState(0);
  const [view, setView] = useState({ width: 0, height: 0 });
  const [pageInput, setPageInput] = useState("1");
  const [printOpen, setPrintOpen] = useState(false);
  const fitted = useRef(false);

  // ---- Annotations -------------------------------------------------------
  const [tool, setToolState] = useState<Tool>("select");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [hist, setHist] = useState<{ stack: Annot[][]; i: number }>({ stack: [[]], i: 0 });
  const annots = hist.stack[hist.i];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<TextAnnot | null>(null);
  const [pending, setPending] = useState<Picture | null>(null);
  const annotsRef = useRef(annots);
  annotsRef.current = annots;
  const editingRef = useRef(editing);
  editingRef.current = editing;
  const selectedRef = useRef(selectedId);
  selectedRef.current = selectedId;

  /** Records a new annotation list in the undo history (max 100 steps). */
  const commit = useCallback((fn: (list: Annot[]) => Annot[]) => {
    setHist((h) => {
      const cur = h.stack[h.i];
      const next = fn(cur);
      if (next === cur) return h;
      const stack = [...h.stack.slice(Math.max(0, h.i - 99), h.i + 1), next];
      return { stack, i: stack.length - 1 };
    });
  }, []);
  const undo = useCallback(() => setHist((h) => (h.i > 0 ? { ...h, i: h.i - 1 } : h)), []);
  const redo = useCallback(() => setHist((h) => (h.i < h.stack.length - 1 ? { ...h, i: h.i + 1 } : h)), []);

  // A new document (after save / rotate) already contains the annotations: start clean.
  useEffect(() => {
    setHist({ stack: [[]], i: 0 });
    setSelectedId(null);
    setEditing(null);
  }, [doc]);

  useEffect(() => {
    if (hist.stack.length > 1) onDirty();
  }, [hist, onDirty]);

  const finishText = useCallback(() => {
    const e = editingRef.current;
    if (!e) return;
    editingRef.current = null;
    setEditing(null);
    const exists = annotsRef.current.some((a) => a.id === e.id);
    if (!e.text.trim()) {
      if (exists) commit((list) => list.filter((a) => a.id !== e.id));
      return;
    }
    const a: TextAnnot = { ...e, ...measureText(e, e.text) };
    commit((list) => (exists ? list.map((x) => (x.id === a.id ? a : x)) : [...list, a]));
    setSelectedId(a.id);
  }, [commit]);

  const setTool = useCallback(
    (t: Tool) => {
      finishText();
      setToolState(t);
      if (t !== "select") setSelectedId(null);
      if (t !== "image") setPending(null);
    },
    [finishText],
  );

  const changeSettings = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((s) => ({ ...s, ...patch }));
      const id = selectedRef.current;
      if (id) commit((list) => list.map((a) => (a.id === id ? applyStyle(a, patch) : a)));
      setEditing((e) => e && applyStyle(e, patch));
    },
    [commit],
  );

  const select = useCallback((a: Annot | null) => {
    setSelectedId(a?.id ?? null);
    if (a) setSettings((s) => ({ ...s, ...styleOf(a) }));
  }, []);

  const removeSelected = useCallback(() => {
    const id = selectedRef.current;
    if (!id) return;
    commit((list) => list.filter((a) => a.id !== id));
    setSelectedId(null);
  }, [commit]);

  // App calls this on save to flatten pending annotations into the file.
  useEffect(() => {
    bakeRef.current = async () => {
      (document.activeElement as HTMLElement | null)?.blur?.(); // commit a text being typed
      await new Promise((r) => setTimeout(r));
      const list = annotsRef.current;
      return list.length ? bake(await sourceBytes(pdf), doc, list) : null;
    };
    return () => {
      bakeRef.current = null;
    };
  }, [bakeRef, pdf, doc]);

  /** Zoom at which the widest page fills the visible width (clamped). */
  const fitScale = useCallback((pageWidth: number) => {
    const avail = (scrollRef.current?.clientWidth ?? 1000) - PAD * 2;
    return Math.min(1.5, Math.max(0.5, avail / pageWidth));
  }, []);

  // 1) Show immediately using page 1's size for every page,
  // 2) then measure the real sizes in the background, in batches.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const first = (await doc.getPage(1)).getViewport({ scale: 1 });
      if (cancelled) return;
      const base = { width: first.width, height: first.height };
      setSizes(Array.from({ length: n }, () => base));
      // Keep the zoom when the document is swapped after save / rotate.
      if (!fitted.current) setScale(fitScale(base.width));
      fitted.current = true;

      const real: PageSize[] = new Array(n).fill(base);
      let differs = false;
      for (let start = 2; start <= n; start += MEASURE_BATCH) {
        const nums = Array.from({ length: Math.min(MEASURE_BATCH, n - start + 1) }, (_, i) => start + i);
        const pages = await Promise.all(nums.map((p) => doc.getPage(p)));
        if (cancelled) return;
        pages.forEach((pg, i) => {
          const vp = pg.getViewport({ scale: 1 });
          real[nums[i] - 1] = { width: vp.width, height: vp.height };
          if (vp.width !== base.width || vp.height !== base.height) differs = true;
        });
        await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
      }
      if (!cancelled && differs) setSizes(real);
    })().catch((e) => console.error("measure pages:", e));
    return () => {
      cancelled = true;
    };
  }, [doc, n]);

  // Note: the document is owned and destroyed by App, not here — destroying it in an
  // effect cleanup breaks under React StrictMode (mount → unmount → mount).

  // Track viewport size
  useEffect(() => {
    const el = scrollRef.current!;
    const ro = new ResizeObserver(() => setView({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track scroll position (once per frame)
  useEffect(() => {
    const el = scrollRef.current!;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setScrollTop(el.scrollTop));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  // Layout: top offset of every page at the current scale
  const layout = useMemo(() => {
    if (!sizes) return null;
    const tops = new Array<number>(sizes.length);
    let y = PAD,
      maxW = 0;
    for (let i = 0; i < sizes.length; i++) {
      tops[i] = y;
      y += sizes[i].height * scale + GAP;
      maxW = Math.max(maxW, sizes[i].width * scale);
    }
    return { tops, totalHeight: y - GAP + PAD, maxWidth: maxW };
  }, [sizes, scale]);

  const current = layout ? pageAt(layout.tops, scrollTop + view.height * 0.3) + 1 : 1;
  useEffect(() => setPageInput(String(current)), [current]);

  /**
   * Zoom keeps one document point fixed on screen: `page` + `fy` (fraction of the
   * page height) vertically, `ox` (pt from the column centre; null = re-centre)
   * horizontally, held at screen offset `sx`,`sy` inside the scroll area.
   */
  const anchor = useRef<{ page: number; fy: number; ox: number | null; sx: number; sy: number } | null>(null);

  /** Anchor at a screen point (default: the middle of the view). */
  const anchorAt = useCallback(
    (sx?: number, sy?: number, recenter = false) => {
      const el = scrollRef.current;
      if (!el || !layout || !sizes) return;
      sx ??= el.clientWidth / 2;
      sy ??= el.clientHeight / 2;
      const y = el.scrollTop + sy;
      const i = pageAt(layout.tops, y);
      const cw = Math.max(el.clientWidth, layout.maxWidth + PAD * 2);
      anchor.current = {
        page: i,
        fy: (y - layout.tops[i]) / (sizes[i].height * scale),
        ox: recenter ? null : (el.scrollLeft + sx - cw / 2) / scale,
        sx,
        sy,
      };
    },
    [layout, sizes, scale],
  );

  const clampZoom = (z: number) => Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], Math.max(ZOOM_STEPS[0], z));

  const changeScale = useCallback(
    (next: number | ((s: number) => number), at?: { x: number; y: number }) => {
      anchorAt(at?.x, at?.y);
      setScale(next);
    },
    [anchorAt],
  );
  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scrollRef.current;
    if (!a || !el || !layout || !sizes) return;
    anchor.current = null;
    const cw = Math.max(el.clientWidth, layout.maxWidth + PAD * 2);
    el.scrollTop = layout.tops[a.page] + a.fy * sizes[a.page].height * scale - a.sy;
    el.scrollLeft = a.ox === null ? (cw - el.clientWidth) / 2 : cw / 2 + a.ox * scale - a.sx;
  }, [layout, sizes, scale]);

  /** Fit the widest page to the view width, keeping the spot in the middle of the screen. */
  const fitWidth = useCallback(
    (z: number) => {
      const el = scrollRef.current;
      if (!el) return;
      if (Math.abs(z - scale) < 0.001) {
        el.scrollTo({ left: (el.scrollWidth - el.clientWidth) / 2, behavior: "smooth" });
        return;
      }
      anchorAt(undefined, undefined, true);
      setScale(z);
    },
    [scale, anchorAt],
  );

  /** Reset view (Ctrl+R): back to the opening zoom, same place, re-centred. */
  const resetView = useCallback(() => {
    if (sizes) fitWidth(fitScale(Math.max(...sizes.map((s) => s.width))));
  }, [sizes, fitWidth, fitScale]);

  const fitTo = useCallback(
    (wholePage: boolean) => {
      const el = scrollRef.current;
      if (!el || !sizes) return;
      const sw = (el.clientWidth - PAD * 2) / Math.max(...sizes.map((s) => s.width));
      if (!wholePage) return fitWidth(clampZoom(sw));
      // Whole page: show the current page centred.
      const sh = (el.clientHeight - PAD) / sizes[current - 1].height;
      anchor.current = { page: current - 1, fy: 0.5, ox: null, sx: el.clientWidth / 2, sy: el.clientHeight / 2 };
      setScale(clampZoom(Math.min(sw, sh)));
    },
    [sizes, current, fitWidth],
  );

  const rotate = (delta: number) => {
    finishText();
    const page = current - 1;
    onEdit(async () => bake(await sourceBytes(pdf), doc, annotsRef.current, { page, delta }));
  };

  const goTo = (p: number) => {
    if (!layout) return;
    const i = Math.min(n, Math.max(1, p)) - 1;
    scrollRef.current?.scrollTo({ top: layout.tops[i] - PAD / 2 });
  };

  const zoom = useCallback(
    (dir: 1 | -1) =>
      changeScale((s) => {
        const next =
          dir > 0 ? ZOOM_STEPS.find((z) => z > s + 0.001) : [...ZOOM_STEPS].reverse().find((z) => z < s - 0.001);
        return next ?? s;
      }),
    [changeScale],
  );

  // Keyboard: Ctrl +/- zoom, Ctrl+0 reset (Ctrl+O is handled in App)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName);
      if (!typing) {
        const k = e.key.toLowerCase();
        const mod = e.ctrlKey || e.metaKey;
        if (mod && (k === "y" || (k === "z" && e.shiftKey))) return void (e.preventDefault(), redo());
        if (mod && k === "z") return void (e.preventDefault(), undo());
        if (e.key === "Delete" || e.key === "Backspace") return void (e.preventDefault(), removeSelected());
        if (e.key === "Escape" && !document.querySelector("[role=dialog]")) return void (setTool("select"), setSelectedId(null));
      }
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "=" || e.key === "+") (e.preventDefault(), zoom(1));
      else if (e.key === "-") (e.preventDefault(), zoom(-1));
      else if (e.key === "0") (e.preventDefault(), changeScale(1));
      // Replace the browser's print (which would print the app UI) with our dialog
      else if (e.key.toLowerCase() === "p") (e.preventDefault(), setPrintOpen(true));
      else if (e.key.toLowerCase() === "s") (e.preventDefault(), e.shiftKey ? onSaveAs() : onSave());
      // Also stops the webview from reloading the page (which would lose unsaved work)
      else if (e.key.toLowerCase() === "r") (e.preventDefault(), resetView());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoom, changeScale, onSave, onSaveAs, resetView, undo, redo, removeSelected, setTool]);

  // Ctrl + wheel zoom
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      // Smooth, proportional zoom around the mouse pointer (also handles touchpad pinch).
      const r = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY; // lines → px
      changeScale((s) => clampZoom(s * Math.exp(-dy * 0.0015)), { x: e.clientX - r.left, y: e.clientY - r.top });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [changeScale]);

  const panStart = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const s = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      el.scrollLeft = s.l - (ev.clientX - s.x);
      el.scrollTop = s.t - (ev.clientY - s.y);
    };
    const up = () => {
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
    };
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
  };

  const ctl: LayerCtl = {
    tool,
    settings,
    scale,
    annots,
    selectedId,
    editing,
    pending,
    add: (a) => commit((list) => [...list, a]),
    update: (a) => commit((list) => list.map((x) => (x.id === a.id ? a : x))),
    remove: (id) => {
      commit((list) => list.filter((a) => a.id !== id));
      if (selectedId === id) setSelectedId(null);
    },
    select,
    startText: (a) => {
      setSelectedId(null);
      setEditing(a);
    },
    editText: (text) => setEditing((e) => e && { ...e, text }),
    finishText,
    placePicture: (page, x, y) => {
      if (!pending) return;
      const a: Annot = { id: uid(), page, kind: "image", x: x - pending.w / 2, y: y - pending.h / 2, w: pending.w, h: pending.h, src: pending.src, opacity: 1 };
      commit((list) => [...list, a]);
      setTool("select");
      setSelectedId(a.id);
    },
  };
  const selected = annots.find((a) => a.id === selectedId) ?? null;

  // Only the pages within the viewport (+ overscan) are mounted
  let first = 0,
    last = -1;
  if (layout) {
    first = pageAt(layout.tops, scrollTop - OVERSCAN);
    last = pageAt(layout.tops, scrollTop + view.height + OVERSCAN);
  }
  const contentWidth = layout ? Math.max(view.width, layout.maxWidth + PAD * 2) : 0;

  return (
    <div className="flex h-full flex-col bg-neutral-200/70 dark:bg-ink-950">
      {/* Toolbar */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-neutral-200 bg-white px-3 dark:border-white/10 dark:bg-ink-900">
        <IconButton label="ปิดเอกสาร" onClick={onClose}>
          <svg {...svg}>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </IconButton>
        <button
          onClick={onOpenAnother}
          className="rounded-md px-2.5 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-maroon dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-coral"
          title="เปิดไฟล์ (Ctrl+O)"
        >
          เปิดไฟล์
        </button>
        <button
          onClick={onSave}
          disabled={saving}
          title="บันทึก (Ctrl+S)"
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-maroon disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-coral"
        >
          <svg {...svg} className="h-4 w-4">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <path d="M17 21v-8H7v8M7 3v5h8" />
          </svg>
          {saving ? "กำลังบันทึก…" : "บันทึก"}
        </button>
        <button
          onClick={onSaveAs}
          disabled={saving}
          title="บันทึกเป็น (Ctrl+Shift+S)"
          className="rounded-md px-2.5 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-maroon disabled:opacity-50 dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-coral"
        >
          บันทึกเป็น…
        </button>
        <div className="mx-1 h-5 w-px bg-neutral-200 dark:bg-white/10" />
        <h1
          className="min-w-0 truncate text-sm font-semibold text-neutral-800 dark:text-neutral-100"
          title={pdf.path ?? "ยังไม่ได้บันทึก"}
        >
          {name}
        </h1>
        {pdf.dirty && (
          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">
            ยังไม่ได้บันทึก
          </span>
        )}

        <div className="ml-auto flex items-center gap-1">
          <IconButton label="หน้าก่อนหน้า" onClick={() => goTo(current - 1)} disabled={current <= 1}>
            <svg {...svg}>
              <path d="M18 15l-6-6-6 6" />
            </svg>
          </IconButton>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const p = parseInt(pageInput, 10);
              if (!isNaN(p)) goTo(p);
              else setPageInput(String(current));
            }}
            className="flex items-center gap-1.5 text-sm text-neutral-500 dark:text-neutral-400"
          >
            <input
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value)}
              onFocus={(e) => e.target.select()}
              aria-label="หน้า"
              className="w-14 rounded-md border border-neutral-200 py-1 text-center text-neutral-800 tabular-nums outline-none focus:border-maroon dark:border-white/15 dark:bg-ink-800 dark:text-neutral-100 dark:focus:border-coral"
            />
            <span className="tabular-nums">/ {n}</span>
          </form>
          <IconButton label="หน้าถัดไป" onClick={() => goTo(current + 1)} disabled={current >= n}>
            <svg {...svg}>
              <path d="M6 9l6 6 6-6" />
            </svg>
          </IconButton>

          <div className="mx-2 h-5 w-px bg-neutral-200 dark:bg-white/10" />

          <IconButton label="ย่อ (Ctrl -)" onClick={() => zoom(-1)} disabled={scale <= ZOOM_STEPS[0]}>
            <svg {...svg}>
              <path d="M5 12h14" />
            </svg>
          </IconButton>
          <button
            onClick={() => changeScale(1)}
            title="100% (Ctrl 0)"
            className="w-14 rounded-md py-1 text-center text-sm text-neutral-700 tabular-nums transition hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-white/10"
          >
            {Math.round(scale * 100)}%
          </button>
          <IconButton
            label="ขยาย (Ctrl +)"
            onClick={() => zoom(1)}
            disabled={scale >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}
          >
            <svg {...svg}>
              <path d="M12 5v14M5 12h14" />
            </svg>
          </IconButton>
          <IconButton label="รีเซ็ตตำแหน่งเอกสาร (Ctrl+R)" onClick={resetView} disabled={!layout}>
            <svg {...svg}>
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <path d="M3 4v5h5" />
              <rect x="9" y="9" width="6" height="6" rx="1" />
            </svg>
          </IconButton>

          <div className="mx-2 h-5 w-px bg-neutral-200 dark:bg-white/10" />

          <button
            onClick={() => setPrintOpen(true)}
            title="พิมพ์ (Ctrl+P)"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-maroon dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-coral"
          >
            <svg {...svg}>
              <path d="M6 9V3h12v6" />
              <rect x="3" y="9" width="18" height="8" rx="2" />
              <path d="M6 14h12v7H6z" />
            </svg>
            พิมพ์
          </button>
        </div>
      </header>

      {printOpen && <PrintDialog doc={doc} currentPage={current} onClose={() => setPrintOpen(false)} />}

      <div className="flex min-h-0 flex-1">
      {/* Pages (virtualized) */}
      <div
        ref={scrollRef}
        className={`relative min-w-0 flex-1 overflow-auto ${tool === "hand" ? "cursor-grab active:cursor-grabbing" : ""}`}
        onPointerDown={tool === "hand" ? panStart : undefined}
      >
        {layout && sizes ? (
          <div className="relative" style={{ height: layout.totalHeight, width: contentWidth }}>
            {Array.from({ length: last - first + 1 }, (_, k) => {
              const i = first + k;
              const w = sizes[i].width * scale;
              return (
                <div key={i} className="absolute" style={{ top: layout.tops[i], left: (contentWidth - w) / 2 }}>
                  <PageView
                    doc={doc}
                    pageNumber={i + 1}
                    scale={scale}
                    width={w}
                    height={sizes[i].height * scale}
                  />
                  <AnnotationLayer page={i} w={sizes[i].width} h={sizes[i].height} ctl={ctl} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">กำลังโหลดเอกสาร…</div>
        )}
      </div>

      <ToolPanel
        tool={tool}
        setTool={setTool}
        settings={settings}
        change={changeSettings}
        selected={selected}
        duplicate={() => {
          if (!selected) return;
          const a = { ...translate(selected, 12, 12), id: uid() };
          commit((list) => [...list, a]);
          setSelectedId(a.id);
        }}
        remove={removeSelected}
        order={(front) => {
          if (!selected) return;
          commit((list) => {
            const rest = list.filter((a) => a.id !== selected.id);
            return front ? [...rest, selected] : [selected, ...rest];
          });
        }}
        undo={undo}
        redo={redo}
        canUndo={hist.i > 0}
        canRedo={hist.i < hist.stack.length - 1}
        count={annots.length}
        fitWidth={() => fitTo(false)}
        fitPage={() => fitTo(true)}
        rotate={rotate}
        pending={pending}
        place={(p) => {
          setTool("image");
          setPending(p);
        }}
      />
      </div>
    </div>
  );
}
