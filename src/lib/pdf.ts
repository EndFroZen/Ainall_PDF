import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { addRecentFile } from "./db";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

/**
 * Data pdf.js needs to render every PDF correctly (non-embedded standard fonts,
 * CJK/Thai CMaps, JPEG2000/JBIG2 decoders, colour profiles). Served from
 * public/pdfjs — see scripts/copy-pdfjs-assets.mjs. Pass to every getDocument().
 */
export const PDFJS_ASSETS = {
  standardFontDataUrl: "/pdfjs/standard_fonts/",
  cMapUrl: "/pdfjs/cmaps/",
  cMapPacked: true,
  wasmUrl: "/pdfjs/wasm/",
  iccUrl: "/pdfjs/iccs/",
} as const;

/** Options for reading a file on disk through the asset protocol (range requests). */
export function fileSource(path: string) {
  return {
    ...PDFJS_ASSETS,
    url: convertFileSrc(path),
    disableAutoFetch: true, // don't pull the whole file in the background
    rangeChunkSize: 1 << 20, // 1 MB ranges
  };
}

export type PDFDocument = pdfjs.PDFDocumentProxy;

let nextId = 1;

export interface OpenedPdf {
  /** Stable identity for the open document (survives Save As). */
  id: number;
  /** Where the document lives on disk; null for a new, never-saved document. */
  path: string | null;
  name: string;
  doc: PDFDocument;
  /** Current content when it differs from what's on disk (new or edited). */
  bytes: Uint8Array | null;
  /** True when there are changes that haven't been saved. */
  dirty: boolean;
}

const A4: [number, number] = [595.28, 841.89]; // points

/** Creates an empty one-page A4 document (not saved anywhere yet). */
export async function createBlankPdf(): Promise<OpenedPdf> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  out.setCreator("Ainall PDF");
  out.setProducer("Ainall PDF");
  out.addPage(A4);
  const bytes = await out.save();
  return { id: nextId++, path: null, name: "เอกสารใหม่.pdf", doc: await openBytes(bytes), bytes, dirty: true };
}

/** Opens in-memory PDF bytes with pdf.js. */
export function openBytes(bytes: Uint8Array): Promise<PDFDocument> {
  // pdf.js takes ownership of the buffer it gets, so give it a copy.
  return pdfjs.getDocument({ ...PDFJS_ASSETS, data: bytes.slice() }).promise;
}

/** The document's current full content (edited bytes, or the file as loaded). */
export async function sourceBytes(pdf: OpenedPdf): Promise<Uint8Array> {
  return pdf.bytes ?? (await pdf.doc.getData());
}

/** Save dialog; returns the chosen path (with .pdf) or null if cancelled. */
async function pickSavePath(defaultName: string): Promise<string | null> {
  const chosen = await save({
    title: "บันทึกเป็น",
    defaultPath: defaultName,
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!chosen) return null;
  return /\.pdf$/i.test(chosen) ? chosen : `${chosen}.pdf`;
}

async function writeTo(pdf: OpenedPdf, dest: string) {
  if (pdf.bytes) {
    await invoke("write_pdf", pdf.bytes, { headers: { "x-path": encodeURIComponent(dest) } });
  } else if (pdf.path) {
    await invoke("copy_pdf", { src: pdf.path, dest });
  } else {
    throw new Error("ไม่มีข้อมูลเอกสารให้บันทึก");
  }
}

/**
 * Save As: asks where, writes there, and returns the document now pointing
 * at the new file — or null if the user cancelled.
 */
export async function savePdfAs(pdf: OpenedPdf): Promise<OpenedPdf | null> {
  const dest = await pickSavePath(pdf.name);
  if (!dest) return null;
  await writeTo(pdf, dest);
  const name = fileName(dest);
  await addRecentFile(dest, name, pdf.doc.numPages).catch(() => {});
  return { ...pdf, path: dest, name, bytes: null, dirty: false };
}

/** On-disk size of documents opened with loadForEdit. */
const fileSizes = new WeakMap<object, number>();

/** Loads a file on disk with pdf-lib; errors name the file. */
export async function loadForEdit(path: string) {
  const { PDFDocument } = await import("pdf-lib");
  try {
    const res = await fetch(convertFileSrc(path));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    const doc = await PDFDocument.load(buf);
    fileSizes.set(doc, buf.byteLength);
    return doc;
  } catch (e) {
    const why = e instanceof Error && /encrypt/i.test(e.message) ? "ไฟล์มีรหัสผ่าน" : describePdfError(e);
    throw new Error(`${fileName(path)}: ${why}`);
  }
}

export async function newEditDoc() {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  out.setCreator("Ainall PDF");
  out.setProducer("Ainall PDF");
  return out;
}

/** Joins the PDFs in order into one document. */
export async function mergePdfs(paths: string[]): Promise<Uint8Array> {
  const out = await newEditDoc();
  for (const path of paths) {
    const src = await loadForEdit(path);
    for (const page of await out.copyPages(src, src.getPageIndices())) out.addPage(page);
  }
  return out.save();
}

/**
 * Writes one new PDF per [from, to] range (1-based) into `dir`, named
 * "<name>_<range>.pdf". Never overwrites. Returns the paths written.
 */
export async function splitPdf(path: string, ranges: [number, number][], dir: string): Promise<string[]> {
  const src = await loadForEdit(path);
  const stem = fileName(path).replace(/\.pdf$/i, "");
  const written: string[] = [];
  for (const [from, to] of ranges) {
    const out = await newEditDoc();
    const idx = Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
    for (const page of await out.copyPages(src, idx)) out.addPage(page);
    const dest = joinPath(dir, `${stem}_${from === to ? from : `${from}-${to}`}.pdf`);
    written.push(await writeUnique(await out.save(), dest));
  }
  return written;
}

/** Shrinks the photos inside a PDF. Returns the original size and the new content. */
export async function compressPdf(
  path: string,
  level: import("./compress").Level,
  onProgress?: (done: number, total: number) => void,
): Promise<{ before: number; bytes: Uint8Array }> {
  const { compressImages, canvasRecompress } = await import("./compress");
  const doc = await loadForEdit(path);
  await compressImages(doc, level, canvasRecompress, onProgress);
  doc.setProducer("Ainall PDF");
  return { before: fileSizes.get(doc)!, bytes: await doc.save({ updateFieldAppearances: false }) };
}

/** Writes `bytes` (PDF, PNG or JPG) to `dest`, adding " (2)"… instead of overwriting. Returns the path written. */
export function writeUnique(bytes: Uint8Array, dest: string): Promise<string> {
  return invoke<string>("write_pdf", bytes, { headers: { "x-path": encodeURIComponent(dest), "x-unique": "1" } });
}

/** `dir` + file name, with the separator `dir` already uses. */
export function joinPath(dir: string, name: string) {
  return `${dir.replace(/[\\/]$/, "")}${dir.includes("\\") ? "\\" : "/"}${name}`;
}

/** Folder picker. Returns null if the user cancels. */
export async function pickFolder(title: string): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false, title });
  return typeof selected === "string" ? selected : null;
}

/** Asks where to save `bytes` as a new PDF; returns the path, or null if cancelled. */
export async function exportPdf(bytes: Uint8Array, defaultName: string): Promise<string | null> {
  const dest = await pickSavePath(defaultName);
  if (!dest) return null;
  await invoke("write_pdf", bytes, { headers: { "x-path": encodeURIComponent(dest) } });
  return dest;
}

/** Save: writes to the current file, or falls back to Save As for a new document. */
export async function savePdf(pdf: OpenedPdf): Promise<OpenedPdf | null> {
  if (!pdf.path) return savePdfAs(pdf);
  if (!pdf.dirty) return pdf;
  await writeTo(pdf, pdf.path);
  return { ...pdf, bytes: null, dirty: false };
}

export function fileName(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Shows the native file picker. Returns null if the user cancels. */
export async function pickPdfPath(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    directory: false,
    title: "เปิดไฟล์ PDF",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  return typeof selected === "string" ? selected : null;
}

/**
 * Starts loading a PDF. pdf.js reads the file through Tauri's asset protocol,
 * fetching only the byte ranges it needs, so huge files open quickly.
 * Call `cancel()` to abort; `promise` then rejects.
 */
export function loadPdf(
  path: string,
  { recordRecent = true }: { recordRecent?: boolean } = {},
): { promise: Promise<OpenedPdf>; cancel: () => void } {
  if (!/\.pdf$/i.test(path)) {
    return { promise: Promise.reject("รองรับเฉพาะไฟล์ .pdf"), cancel: () => {} };
  }
  const task = pdfjs.getDocument(fileSource(path));
  const promise = task.promise.then(async (doc) => {
    const name = fileName(path);
    if (recordRecent) {
      await addRecentFile(path, name, doc.numPages).catch((e) => console.error("recent_files:", e));
    }
    return { id: nextId++, path, name, doc, bytes: null, dirty: false };
  });
  return { promise, cancel: () => void task.destroy() };
}

/** Lets the user pick several PDFs at once. */
export async function pickPdfPaths(): Promise<string[]> {
  const selected = await open({
    multiple: true,
    directory: false,
    title: "เพิ่มไฟล์ PDF",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (!selected) return [];
  return Array.isArray(selected) ? selected : [selected];
}

/** Page count without keeping the document open. Returns null if unreadable. */
export async function countPages(path: string): Promise<number | null> {
  const task = pdfjs.getDocument(fileSource(path));
  try {
    return (await task.promise).numPages;
  } catch {
    return null;
  } finally {
    void task.destroy();
  }
}

export function closePdf(pdf: OpenedPdf) {
  void pdf.doc.loadingTask.destroy();
}

export function describePdfError(e: unknown): string {
  if (e instanceof pdfjs.PasswordException) return "ไฟล์นี้มีรหัสผ่าน (ยังไม่รองรับ)";
  if (e instanceof pdfjs.InvalidPDFException) return "ไฟล์นี้ไม่ใช่ PDF ที่ถูกต้องหรือไฟล์เสีย";
  if (e instanceof pdfjs.ResponseException) return "เปิดไฟล์ไม่ได้ — ไฟล์อาจถูกย้ายหรือลบไปแล้ว";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
