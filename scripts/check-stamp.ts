// Self-check for place(): run with `node scripts/check-stamp.ts` (Node 22.6+).
// Simulates pdf-lib's drawImage transform and maps the picture's corners back to the
// screen with pdf.js, on normal and rotated pages, straight and diagonal.
import assert from "node:assert/strict";
import { PDFDocument, degrees } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { cornerCenter, place } from "../src/lib/stamp.ts";

const src = await PDFDocument.create();
for (const r of [0, 90, 180, 270]) src.addPage([600, 800]).setRotation(degrees(r));
const doc = await pdfjs.getDocument({ data: await src.save() }).promise;

const near = (a: number[], b: number[], what: string) =>
  assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1]) < 0.01, `${what}: got ${a}, want ${b}`);

for (let p = 1; p <= 4; p++) {
  const vp = (await doc.getPage(p)).getViewport({ scale: 1 });
  for (const angle of [0, 45]) {
    const [cx, cy, w, h] = [vp.width / 2, vp.height / 3, 120, 40];
    const o = place(vp, cx, cy, w, h, angle);
    const f = (o.rotate * Math.PI) / 180;
    // drawImage: image point (u, v) -> PDF (x + u cos f - v sin f, y + u sin f + v cos f)
    const screen = (u: number, v: number) =>
      vp.convertToViewportPoint(o.x + u * Math.cos(f) - v * Math.sin(f), o.y + u * Math.sin(f) + v * Math.cos(f));
    const t = (angle * Math.PI) / 180;
    // expected: picture centred on (cx, cy), its "right" direction turned anticlockwise on screen
    const right = [Math.cos(t), -Math.sin(t)], up = [-Math.sin(t), -Math.cos(t)];
    const at = (a: number, b: number) => [cx + a * right[0] + b * up[0], cy + a * right[1] + b * up[1]];
    const what = `rotation ${vp.rotation}, angle ${angle}`;
    near(screen(0, 0), at(-w / 2, -h / 2), `${what} bottom-left`);
    near(screen(w, h), at(w / 2, h / 2), `${what} top-right`);
  }
  const [x, y] = cornerCenter(vp, "bottom-right", 40, 10);
  near([x, y], [vp.width - 44, vp.height - 29], `corner on rotation ${vp.rotation}`);
}
console.log("place OK");
