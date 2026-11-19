import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
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

async function renderThumb(path: string): Promise<string> {
  const task = pdfjs.getDocument(fileSource(path));
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
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

/** First-page preview of a PDF; renders when scrolled into view. */
export default function PdfThumb({ path, className = "" }: { path: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState(() => cache.get(path) ?? null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (cache.has(path)) return setSrc(cache.get(path)!);
    setSrc(null);
    setFailed(false);
    let cancelled = false;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      slot(() => (cancelled ? Promise.reject() : renderThumb(path)))
        .then((url) => {
          cache.set(path, url);
          if (!cancelled) setSrc(url);
        })
        .catch(() => !cancelled && setFailed(true));
    });
    io.observe(ref.current!);
    return () => {
      cancelled = true;
      io.disconnect();
    };
  }, [path]);

  return (
    <div ref={ref} className={`relative overflow-hidden bg-white ${className}`}>
      {src ? (
        <img src={src} alt="" draggable={false} className="h-full w-full object-cover object-top" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-neutral-300">
          <IconFile className={`h-8 w-8 ${failed ? "" : "animate-pulse"}`} />
        </div>
      )}
    </div>
  );
}

/** Drop a cached thumbnail (e.g. after a file is renamed or removed). */
export function forgetThumb(path: string) {
  cache.delete(path);
}
