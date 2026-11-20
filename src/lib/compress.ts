import { PDFArray, PDFDocument, PDFName, PDFNumber, PDFRawStream, type PDFObject } from "pdf-lib";

export type Level = "low" | "medium" | "high";

/** Longest image side in pixels and JPEG quality for each level. */
export const LEVELS: Record<Level, { maxSide: number; quality: number }> = {
  low: { maxSide: 2400, quality: 0.85 },
  medium: { maxSide: 1600, quality: 0.7 },
  high: { maxSide: 1100, quality: 0.5 },
};

/** Re-encodes JPEG bytes; returns null to keep the original. Output is always RGB. */
export type Recompress = (jpeg: Uint8Array, maxSide: number, quality: number) => Promise<
  { bytes: Uint8Array; width: number; height: number } | null
>;

const N = (s: string) => PDFName.of(s);

/** Number of colour components, or null for colour spaces we don't touch (CMYK, Indexed, …). */
function components(doc: PDFDocument, cs: PDFObject | undefined): 1 | 3 | null {
  cs = cs && doc.context.lookup(cs);
  if (cs === N("DeviceRGB")) return 3;
  if (cs === N("DeviceGray")) return 1;
  if (cs instanceof PDFArray && cs.size() === 2 && cs.get(0) === N("ICCBased")) {
    const icc = doc.context.lookup(cs.get(1));
    const n = icc instanceof PDFRawStream ? icc.dict.lookup(N("N")) : undefined;
    if (n instanceof PDFNumber && (n.asNumber() === 1 || n.asNumber() === 3)) return n.asNumber() as 1 | 3;
  }
  return null;
}

/**
 * Shrinks the plain JPEG images in `doc` in place (text and vector graphics are untouched).
 * Images that aren't 8-bit RGB/gray JPEGs, or that wouldn't get smaller, are left as they are.
 */
export async function compressImages(
  doc: PDFDocument,
  level: Level,
  recompress: Recompress,
  onProgress?: (done: number, total: number) => void,
) {
  const { maxSide, quality } = LEVELS[level];
  const jpegs = doc.context.enumerateIndirectObjects().filter(([, obj]) => {
    if (!(obj instanceof PDFRawStream)) return false;
    const d = obj.dict;
    let filter = d.lookup(N("Filter"));
    if (filter instanceof PDFArray && filter.size() === 1) filter = filter.lookup(0);
    const bpc = d.lookup(N("BitsPerComponent"));
    return (
      d.lookup(N("Subtype")) === N("Image") &&
      filter === N("DCTDecode") &&
      bpc instanceof PDFNumber && bpc.asNumber() === 8 &&
      !d.has(N("ImageMask")) &&
      !d.has(N("Decode")) && // inverted/remapped samples
      !d.has(N("SMaskInData")) &&
      components(doc, d.get(N("ColorSpace"))) !== null
    );
  });

  let done = 0;
  for (const [ref, obj] of jpegs as [Parameters<typeof doc.context.assign>[0], PDFRawStream][]) {
    try {
      const out = await recompress(obj.contents, maxSide, quality);
      if (out && out.bytes.length < obj.contents.length) {
        const d = obj.dict;
        d.set(N("Width"), PDFNumber.of(out.width));
        d.set(N("Height"), PDFNumber.of(out.height));
        d.set(N("Filter"), N("DCTDecode"));
        d.delete(N("DecodeParms"));
        if (components(doc, d.get(N("ColorSpace"))) === 1) d.set(N("ColorSpace"), N("DeviceRGB"));
        doc.context.assign(ref, PDFRawStream.of(d, out.bytes));
      }
    } catch {
      // ponytail: an image the browser can't decode is kept as-is
    }
    onProgress?.(++done, jpegs.length);
  }
}

/** Browser implementation of Recompress: decode → downscale → JPEG. */
export const canvasRecompress: Recompress = async (jpeg, maxSide, quality) => {
  const bmp = await createImageBitmap(new Blob([jpeg.slice()], { type: "image/jpeg" }), {
    colorSpaceConversion: "none",
  });
  try {
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const width = Math.max(1, Math.round(bmp.width * scale));
    const height = Math.max(1, Math.round(bmp.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bmp, 0, 0, width, height);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    return { bytes: new Uint8Array(await blob.arrayBuffer()), width, height };
  } finally {
    bmp.close();
  }
};
