// Self-check for compressImages(): run with `node scripts/check-compress.ts` (Node 22.6+).
// Uses fake image bytes and a fake recompressor, so it checks which images get
// replaced and how their dictionaries are rewritten — not the JPEG encoding itself.
import assert from "node:assert/strict";
import { PDFDocument, PDFName, PDFNumber, PDFRawStream } from "pdf-lib";
import { compressImages, type Recompress } from "../src/lib/compress.ts";

const doc = await PDFDocument.create();
const ctx = doc.context;
const img = (extra: Record<string, unknown>, size = 1000) =>
  ctx.register(
    PDFRawStream.of(
      ctx.obj({ Type: "XObject", Subtype: "Image", Width: 4000, Height: 2000, BitsPerComponent: 8, Filter: "DCTDecode", ...extra }),
      new Uint8Array(size),
    ),
  );
const rgb = img({ ColorSpace: "DeviceRGB" });
const gray = img({ ColorSpace: "DeviceGray" });
const cmyk = img({ ColorSpace: "DeviceCMYK" });
const inverted = img({ ColorSpace: "DeviceRGB", Decode: [1, 0, 1, 0, 1, 0] });
const tiny = img({ ColorSpace: "DeviceRGB" }, 10); // recompressing would make it bigger

const seen: number[] = [];
const fake: Recompress = async (jpeg, maxSide) => {
  seen.push(jpeg.length);
  return { bytes: new Uint8Array(100), width: maxSide, height: maxSide / 2 };
};
await compressImages(doc, "medium", fake);

const get = (ref: typeof rgb) => ctx.lookup(ref) as PDFRawStream;
assert.equal(seen.length, 3, "only RGB/gray JPEGs are offered for recompression");
assert.equal(get(rgb).contents.length, 100);
assert.equal((get(rgb).dict.get(PDFName.of("Width")) as PDFNumber).asNumber(), 1600);
assert.equal(get(gray).dict.get(PDFName.of("ColorSpace")), PDFName.of("DeviceRGB"), "gray becomes RGB");
assert.equal(get(cmyk).contents.length, 1000, "CMYK untouched");
assert.equal(get(inverted).contents.length, 1000, "Decode array untouched");
assert.equal(get(tiny).contents.length, 10, "kept when not smaller");
await doc.save(); // still serialises
console.log("compressImages OK");
