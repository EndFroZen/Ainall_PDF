import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { fileSource } from "../lib/pdf";
import { IconFile } from "./icons";

const THUMB_WIDTH = 320; // px (rendered at 2× of the ~160px card)
const cache = new Map<string, string>();

// Render at most two thumbnails at a time so a big project doesn't flood the worker.
let running = 0;
const queue: (() => void)[] = [];
function slot<T>(job: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running++;
      job()
        .then(resolve, reject)
        .finally(() => {
          running--;
          queue.shift()?.();
        });
    };
    if (running < 2) run();
    else queue.push(run);
  });
}

async function renderThumb(path: string, pageNo: number, width: number): Promise<string> {
  const task = pdfjs.getDocument(fileSource(path));
  try {
    const doc = await task.promise;
    const page = await doc.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    void task.destroy();
  }
}

/** Preview of one PDF page (default: the first); renders when scrolled into view. · `contain` shows the whole page (landscape stays landscape) instead of cropping it to the box. */
export default function PdfThumb({
  path,
  page = 1,
  className = "",
  contain = false,
  width = THUMB_WIDTH,
}: {
  path: string;
  page?: number;
  className?: string;
  contain?: boolean;
  width?: number;
}) {
  const key = (page === 1 ? path : `${path}#${page}`) + (width === THUMB_WIDTH ? "" : `@${width}`);
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState(() => cache.get(key) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (cache.has(key)) return setSrc(cache.get(key)!);
    setSrc(null);
    setFailed(false);
    let cancelled = false;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      // ponytail: reopens the PDF for every page; share one pdf.js doc if long files feel slow.
      slot(() => (cancelled ? Promise.reject() : renderThumb(path, page, width)))
        .then((url) => {
          cache.set(key, url);
          if (!cancelled) setSrc(url);
        })
        .catch(() => !cancelled && setFailed(true));
    });
    io.observe(ref.current!);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [path, page, width, key]);

  return (
    <div ref={ref} className={`relative overflow-hidden ${contain ? "" : "bg-white"} ${className}`}>
      {src ? (
        <img src={src} alt="" draggable={false} className={`h-full w-full animate-fade ${contain ? "object-contain" : "object-cover object-top"}`} />
      ) : (
        <div role="status" aria-label={failed ? "โหลดไม่สำเร็จ" : "กำลังโหลด"} className="flex h-full w-full items-center justify-center text-neutral-400">
          {failed || !contain ? (
            <IconFile className={`h-8 w-8 ${failed ? "" : "animate-pulse"}`} />
          ) : (
            <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-current/25 border-t-current" />
          )}
        </div>
      )}
    </div>
  );
}

/** Drop a cached thumbnail (e.g. after a file is renamed or removed). */
export function forgetThumb(path: string) {
  cache.delete(path);
}
