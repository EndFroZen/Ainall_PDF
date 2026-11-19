import type { PDFDocument } from "./pdf";

const PRINT_DPI = 150;
const MAX_SCALE = PRINT_DPI / 72;

/** Parses "1-5, 8, 11-13" into a sorted list of unique page numbers. Returns null if invalid. */
export function parsePageRange(input: string, numPages: number): number[] | null {
  const out = new Set<number>();
  const parts = input.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  for (const part of parts) {
    const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(part);
    if (!m) return null;
    const a = parseInt(m[1], 10);
    const b = m[2] ? parseInt(m[2], 10) : a;
    if (a < 1 || b < a || b > numPages) return null;
    for (let p = a; p <= b; p++) out.add(p);
  }
  return [...out].sort((x, y) => x - y);
}

export class PrintCancelled extends Error {}

/**
 * Renders the given pages to images, mounts them in a print-only container
 * and opens the system print dialog. Cleans up after printing.
 */
export async function printPages(
  doc: PDFDocument,
  pages: number[],
  onProgress: (done: number, total: number) => void,
  signal: AbortSignal,
) {
  runPendingCleanup(); // leftovers from a previous job
  const urls: string[] = [];
  const root = document.createElement("div");
  root.id = "print-root";
  const style = document.createElement("style");
  const sizeNames = new Map<string, string>();
  let pageRules = "";

  const cleanup = () => {
    urls.forEach(URL.revokeObjectURL);
    root.remove();
    style.remove();
  };

  try {
    for (let i = 0; i < pages.length; i++) {
      if (signal.aborted) throw new PrintCancelled();
      const page = await doc.getPage(pages[i]);
      const base = page.getViewport({ scale: 1 }); // 1 unit = 1pt
      const viewport = page.getViewport({ scale: MAX_SCALE });

      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, viewport }).promise;

      const blob = await new Promise<Blob>((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/jpeg", 0.95),
      );
      canvas.width = canvas.height = 0; // free memory early
      const url = URL.createObjectURL(blob);
      urls.push(url);

      // One named @page per distinct page size, so paper matches the PDF page.
      const w = base.width.toFixed(1);
      const h = base.height.toFixed(1);
      const key = `${w}x${h}`;
      let name = sizeNames.get(key);
      if (!name) {
        name = `pdf${sizeNames.size}`;
        sizeNames.set(key, name);
        pageRules += `@page ${name} { size: ${w}pt ${h}pt; margin: 0; }\n`;
      }

      const sheet = document.createElement("div");
      sheet.className = "print-sheet";
      sheet.style.page = name;
      sheet.style.width = `${w}pt`;
      sheet.style.height = `${h}pt`;
      const img = document.createElement("img");
      img.src = url;
      sheet.appendChild(img);
      root.appendChild(sheet);

      onProgress(i + 1, pages.length);
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0)); // keep UI responsive
    }

    style.textContent = `
      ${pageRules}
      #print-root { display: none; }
      @media print {
        html, body { background: #fff !important; height: auto !important; }
        body > *:not(#print-root) { display: none !important; }
        #print-root { display: block; }
        .print-sheet { break-after: page; overflow: hidden; }
        .print-sheet:last-child { break-after: auto; }
        .print-sheet img { display: block; width: 100%; height: 100%; object-fit: contain; }
      }`;
    document.head.appendChild(style);
    document.body.appendChild(root);
    await Promise.all([...root.querySelectorAll("img")].map((im) => im.decode().catch(() => {})));
    if (signal.aborted) throw new PrintCancelled();

    // Keep the prepared pages until the print dialog is done with them.
    pendingCleanup = cleanup;
    window.addEventListener("afterprint", runPendingCleanup, { once: true });
    window.print();
  } catch (e) {
    cleanup();
    throw e;
  }
}

let pendingCleanup: (() => void) | null = null;

function runPendingCleanup() {
  pendingCleanup?.();
  pendingCleanup = null;
}
