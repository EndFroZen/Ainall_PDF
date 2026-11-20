// PDF operations behind the tool pages: images ⇄ PDF, organize pages, page numbers / watermark.
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { fileName, fileSource, joinPath, loadForEdit, newEditDoc, writeUnique } from "./pdf";
import { canvasRecompress } from "./compress";
import { textPicture } from "./annotations";
import { cornerCenter, pageLabel, place, type Corner } from "./stamp";

const A4: [number, number] = [595.28, 841.89];

async function readFile(path: string): Promise<Uint8Array> {
  const res = await fetch(convertFileSrc(path));
  if (!res.ok) throw new Error(`${fileName(path)}: อ่านไฟล์ไม่ได้ (HTTP ${res.status})`);
  return new Uint8Array(await res.arrayBuffer());
}

export const isImage = (p: string) => /\.(jpe?g|png)$/i.test(p);

/** Lets the user pick several JPG/PNG images. */
export async function pickImagePaths(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    directory: false,
    title: "เลือกรูปภาพ",
    filters: [{ name: "รูปภาพ", extensions: ["jpg", "jpeg", "png"] }],
  });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

/** Decodes any browser-readable image and re-encodes it as PNG (fallback for odd PNGs). */
async function toPng(bytes: Uint8Array): Promise<Uint8Array> {
  const bmp = await createImageBitmap(new Blob([bytes.slice()]));
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  bmp.close();
  return new Uint8Array(await (await c.convertToBlob({ type: "image/png" })).arrayBuffer());
}

export type PageFit = "image" | "a4";

/**
 * One page per image, in order. "image": page has the image's shape (A4 width);
 * "a4": A4 in the image's orientation, image fitted inside a margin.
 */
export async function imagesToPdf(
  paths: string[],
  fit: PageFit,
  onProgress?: (done: number, total: number) => void,
): Promise<Uint8Array> {
  const out = await newEditDoc();
  for (const [i, path] of paths.entries()) {
    const raw = await readFile(path);
    let img;
    try {
      if (/\.png$/i.test(path)) {
        img = await out.embedPng(raw).catch(async () => out.embedPng(await toPng(raw)));
      } else {
        // Re-encode so the phone's EXIF rotation is applied; also caps huge photos at 4000px.
        img = await out.embedJpg((await canvasRecompress(raw, 4000, 0.92))!.bytes);
      }
    } catch {
      throw new Error(`${fileName(path)}: เปิดรูปนี้ไม่ได้`);
    }
    if (fit === "image") {
      const w = A4[0], h = (A4[0] * img.height) / img.width;
      out.addPage([w, h]).drawImage(img, { x: 0, y: 0, width: w, height: h });
    } else {
      const landscape = img.width > img.height;
      const [pw, ph] = landscape ? [A4[1], A4[0]] : A4;
      const m = 24, s = Math.min((pw - 2 * m) / img.width, (ph - 2 * m) / img.height);
      const [w, h] = [img.width * s, img.height * s];
      out.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
    onProgress?.(i + 1, paths.length);
  }
  return out.save();
}

/** Renders one page onto a white canvas `scale` px per pt. */
async function renderPage(doc: pdfjs.PDFDocumentProxy, n: number, scale: number) {
  const page = await doc.getPage(n);
  const base = page.getViewport({ scale: 1 });
  // ponytail: cap at 10000px per side to stay under the browser's canvas limit
  const s = Math.min(scale, 10000 / Math.max(base.width, base.height));
  const viewport = page.getViewport({ scale: s });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport }).promise;
  page.cleanup();
  return canvas;
}

export type ImageFormat = "png" | "jpg";

/** Saves `pages` (1-based) as image files in `dir`. Never overwrites. Returns the paths written. */
export async function pdfToImages(
  path: string,
  pages: number[],
  format: ImageFormat,
  dpi: number,
  dir: string,
  onProgress?: (done: number, total: number) => void,
): Promise<string[]> {
  const task = pdfjs.getDocument(fileSource(path));
  const stem = fileName(path).replace(/\.pdf$/i, "");
  const written: string[] = [];
  try {
    const doc = await task.promise;
    for (const [i, n] of pages.entries()) {
      const canvas = await renderPage(doc, n, dpi / 72);
      const blob = await new Promise<Blob | null>((r) =>
        canvas.toBlob(r, format === "png" ? "image/png" : "image/jpeg", 0.92),
      );
      if (!blob) throw new Error(`สร้างรูปหน้า ${n} ไม่ได้ (หน้าอาจใหญ่เกินไป)`);
      written.push(await writeUnique(new Uint8Array(await blob.arrayBuffer()), joinPath(dir, `${stem}_${n}.${format}`)));
      onProgress?.(i + 1, pages.length);
    }
  } finally {
    void task.destroy();
  }
  return written;
}

/**
 * Renders a small preview of every page, calling `onThumb` as each one is ready.
 * Returns the page count; call the returned `cancel` to stop.
 */
export function renderThumbs(path: string, width: number, onThumb: (index: number, url: string) => void) {
  const task = pdfjs.getDocument(fileSource(path));
  let cancelled = false;
  const pages = task.promise.then((doc) => {
    void (async () => {
      for (let n = 1; n <= doc.numPages && !cancelled; n++) {
        try {
          const vp = (await doc.getPage(n)).getViewport({ scale: 1 });
          const c = await renderPage(doc, n, width / vp.width);
          if (!cancelled) onThumb(n - 1, c.toDataURL("image/jpeg", 0.8));
        } catch {
          // ponytail: a page that fails to render just keeps its placeholder
        }
      }
    })();
    return doc.numPages;
  });
  return {
    pages,
    cancel: () => {
      cancelled = true;
      void task.destroy();
    },
  };
}

/** Builds a new PDF from pages of any files: any order, repeats allowed, extra rotation in degrees. */
export async function buildPdf(pages: { path: string; index: number; rotate: number }[]): Promise<Uint8Array> {
  const { degrees } = await import("pdf-lib");
  const out = await newEditDoc();
  // One copyPages call per file, so fonts and images its pages share are copied once.
  const copied = new Array<Awaited<ReturnType<typeof out.copyPages>>[number]>(pages.length);
  for (const path of new Set(pages.map((p) => p.path))) {
    const at = pages.flatMap((p, i) => (p.path === path ? [i] : []));
    const got = await out.copyPages(await loadForEdit(path), at.map((i) => pages[i].index));
    at.forEach((i, j) => (copied[i] = got[j]));
  }
  copied.forEach((page, i) => {
    out.addPage(page);
    page.setRotation(degrees((((page.getRotation().angle + pages[i].rotate) % 360) + 360) % 360));
  });
  return out.save();
}

export interface StampOptions {
  numbers?: { format: string; corner: Corner; size: number };
  watermark?: { text: string; color: string; opacity: number; diagonal: boolean };
}

const FONT = `"Leelawadee UI", Tahoma, sans-serif`;

/**
 * Adds page numbers and/or a text watermark to every page. Text is drawn as an image
 * (like the viewer's stamps), so Thai renders without embedding a font.
 */
export async function stampPdf(path: string, opts: StampOptions): Promise<Uint8Array> {
  const out = await loadForEdit(path);
  const task = pdfjs.getDocument(fileSource(path));
  try {
    const doc = await task.promise;
    const pages = out.getPages();
    const { degrees } = await import("pdf-lib");
    const pics = new Map<string, { img: Awaited<ReturnType<typeof out.embedPng>>; w: number; h: number }>();
    const picture = async (text: string, font: string, color: string) => {
      const key = `${font}|${color}|${text}`;
      if (!pics.has(key)) {
        const p = textPicture(text, font, color);
        pics.set(key, { img: await out.embedPng(p.src), w: p.w, h: p.h });
      }
      return pics.get(key)!;
    };

    for (let i = 0; i < pages.length; i++) {
      const vp = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
      const wm = opts.watermark;
      if (wm?.text.trim()) {
        const p = await picture(wm.text.trim(), `bold 96px ${FONT}`, wm.color);
        const angle = wm.diagonal ? (Math.atan2(vp.height, vp.width) * 180) / Math.PI : 0;
        const room = wm.diagonal ? Math.hypot(vp.width, vp.height) * 0.7 : vp.width * 0.8;
        const s = Math.min(room / p.w, (vp.height * 0.4) / p.h);
        const o = place(vp, vp.width / 2, vp.height / 2, p.w * s, p.h * s, angle);
        pages[i].drawImage(p.img, { ...o, rotate: degrees(o.rotate), opacity: wm.opacity });
      }
      const num = opts.numbers;
      if (num) {
        const p = await picture(pageLabel(num.format, i + 1, pages.length), `${num.size}px ${FONT}`, "#333333");
        const [cx, cy] = cornerCenter(vp, num.corner, p.w, p.h);
        const o = place(vp, cx, cy, p.w, p.h);
        pages[i].drawImage(p.img, { ...o, rotate: degrees(o.rotate) });
      }
    }
    return out.save();
  } finally {
    void task.destroy();
  }
}
