import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { OpenedPdf, PDFDocument } from "../lib/pdf";
import PrintDialog from "../components/PrintDialog";

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
}: {
  pdf: OpenedPdf;
  onClose: () => void;
  onOpenAnother: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  saving: boolean;
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
      setScale(fitScale(base.width));

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

  // Keep the same spot in view when zoom changes
  const anchor = useRef<{ page: number; frac: number; resetLeft?: boolean } | null>(null);
  const changeScale = useCallback(
    (next: number | ((s: number) => number)) => {
      const el = scrollRef.current;
      if (el && layout && sizes) {
        const i = pageAt(layout.tops, el.scrollTop);
        anchor.current = { page: i, frac: (el.scrollTop - layout.tops[i]) / (sizes[i].height * scale) };
      }
      setScale(next);
    },
    [layout, sizes, scale],
  );
  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scrollRef.current;
    if (!a || !el || !layout || !sizes) return;
    anchor.current = null;
    el.scrollTop = layout.tops[a.page] + a.frac * sizes[a.page].height * scale;
    if (a.resetLeft) el.scrollLeft = 0;
  }, [layout, sizes, scale]);

  /**
   * Reset view: zoom back to "fit width" (as when the file was opened),
   * re-centre horizontally, and line the current page up at the top.
   */
  const resetView = useCallback(() => {
    const el = scrollRef.current;
    if (!el || !layout || !sizes) return;
    const page = current - 1;
    const fit = fitScale(Math.max(...sizes.map((s) => s.width)));
    if (Math.abs(fit - scale) < 0.001) {
      el.scrollTo({ top: layout.tops[page] - PAD / 2, left: 0, behavior: "smooth" });
    } else {
      anchor.current = { page, frac: 0, resetLeft: true };
      setScale(fit);
    }
  }, [layout, sizes, scale, current]);

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
  }, [zoom, changeScale, onSave, onSaveAs, resetView]);

  // Ctrl + wheel zoom
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      zoom(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoom]);

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
      <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-auto">
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
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-neutral-500 dark:text-neutral-400">กำลังโหลดเอกสาร…</div>
        )}
      </div>

      <ToolPanel />
      </div>
    </div>
  );
}

/** Right-hand tool panel. Empty for now — tools will be designed next. */
function ToolPanel() {
  return (
    <aside
      aria-label="เครื่องมือ"
      className="flex w-72 shrink-0 flex-col border-l border-neutral-200 bg-white xl:w-80 dark:border-white/10 dark:bg-ink-900"
    >
      <div className="flex h-11 shrink-0 items-center border-b border-neutral-200 px-4 dark:border-white/10">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">เครื่องมือ</h2>
      </div>
      <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-neutral-400 dark:text-neutral-500">
        เครื่องมือแก้ไขจะอยู่ที่นี่
      </div>
    </aside>
  );
}
