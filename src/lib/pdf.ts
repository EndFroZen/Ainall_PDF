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
  // pdf.js takes ownership of the buffer it gets, so give it a copy.
  const doc = await pdfjs.getDocument({ ...PDFJS_ASSETS, data: bytes.slice() }).promise;
  return { id: nextId++, path: null, name: "เอกสารใหม่.pdf", doc, bytes, dirty: true };
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
