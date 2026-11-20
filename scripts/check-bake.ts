// Self-check for bake(): run with `node scripts/check-bake.ts` (Node 22.6+).
// Draws a rectangle on a normal and a 90°-rotated page and checks it lands
// where pdf.js shows it, and that page rotation is applied.
import assert from "node:assert/strict";
import { PDFDocument, degrees } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { bake, type Annot } from "../src/lib/annotations.ts";

const src = await PDFDocument.create();
src.addPage([600, 800]);
src.addPage([600, 800]).setRotation(degrees(90));
const bytes = await src.save();
const open = (b: Uint8Array) => pdfjs.getDocument({ data: b.slice() }).promise;
const doc = await open(bytes);

const rect = (page: number): Annot => ({
  id: String(page), page, kind: "rect", x: 100, y: 50, w: 40, h: 20,
  stroke: "#ff0000", fill: "#ff0000", width: 0, opacity: 1,
});
const out = await bake(bytes, doc as never, [rect(0), rect(1)], { page: 0, delta: -90 });
const res = await open(out);

// Page 1 now rotated 270; page 2 still 90.
assert.equal((await res.getPage(1)).rotate, 270);
assert.equal((await res.getPage(2)).rotate, 90);

// On page 2 (rotated 90) the red box must be where it was on screen: rasterless check
// via the content stream's path bbox mapped back through the viewport.
const p2 = await res.getPage(2);
const vp = p2.getViewport({ scale: 1 });
const ops = await p2.getOperatorList();
const flat = (v: unknown): number[] => typeof v === "number" ? [v] : v && typeof v === "object" && Symbol.iterator in v ? [...(v as Iterable<unknown>)].flatMap(flat) : [];
// The path's bbox (last 4 numbers) is in drawSvgPath's y-flipped space.
const [x0, y0, x1, y1] = flat(ops.argsArray).slice(-4);
const got = [x0, -y1, x1, -y0];
const [a, b] = [vp.convertToPdfPoint(100, 50), vp.convertToPdfPoint(140, 70)];
const want = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
assert.deepEqual(got.map(Math.round), want.map(Math.round));
console.log("bake ok");
