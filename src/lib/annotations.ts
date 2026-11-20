/**
 * Edits the user adds on top of a PDF. They live in memory (so they can be
 * moved, deleted, undone) in page-viewport units at scale 1 — top-left origin,
 * already rotated like the page is shown — and are flattened into the file by
 * `bake()` on save.
 */
import type { PDFDocument as PdfJsDoc } from "./pdf";

export type Tool =
  | "select" | "hand" | "text"
  | "highlight" | "underline" | "strike" | "squiggly"
  | "pen" | "marker" | "eraser"
  | "rect" | "ellipse" | "line" | "arrow"
  | "image";

export type BoxKind = "rect" | "ellipse" | "highlight" | "underline" | "strike" | "squiggly";

interface Base {
  id: string;
  page: number; // 0-based
  opacity: number;
}
export interface BoxAnnot extends Base {
  kind: BoxKind;
  x: number; y: number; w: number; h: number;
  stroke: string;
  fill: string | null;
  width: number;
}
export interface LineAnnot extends Base {
  kind: "line" | "arrow";
  x1: number; y1: number; x2: number; y2: number;
  stroke: string;
  width: number;
}
export interface PathAnnot extends Base {
  kind: "path";
  points: number[]; // x0, y0, x1, y1, …
  stroke: string;
  width: number;
  marker: boolean; // highlighter pen: multiply blend
}
export interface TextStyle {
  font: string;
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: string;
  align: "left" | "center" | "right";
}
export interface TextAnnot extends Base, TextStyle {
  kind: "text";
  x: number; y: number; w: number; h: number;
  text: string;
}
export interface ImageAnnot extends Base {
  kind: "image";
  x: number; y: number; w: number; h: number;
  src: string; // PNG data URL
}
export type Annot = BoxAnnot | LineAnnot | PathAnnot | TextAnnot | ImageAnnot;

/** A ready-to-place picture (signature, stamp) with its natural size in pt. */
export interface Picture {
  src: string;
  w: number;
  h: number;
}

export interface Settings extends TextStyle {
  stroke: string;
  fill: string | null;
  width: number;
  opacity: number;
  hlColor: string; // highlight / markup / marker colour
}

export const DEFAULT_SETTINGS: Settings = {
  stroke: "#dc2626",
  fill: null,
  width: 2,
  opacity: 1,
  hlColor: "#facc15",
  font: "Leelawadee UI",
  size: 14,
  bold: false,
  italic: false,
  underline: false,
  strike: false,
  color: "#111111",
  align: "left",
};

export const uid = () => crypto.randomUUID();
const isLine = (a: Annot): a is LineAnnot => a.kind === "line" || a.kind === "arrow";

export const isMarkup = (k: Annot["kind"]) =>
  k === "highlight" || k === "underline" || k === "strike" || k === "squiggly";
/** Annotations coloured by the highlighter colour rather than the pen colour. */
const usesHl = (a: Annot) => isMarkup(a.kind) || (a.kind === "path" && a.marker);
export const resizable = (a: Annot): a is BoxAnnot | ImageAnnot => a.kind === "image" || "fill" in a;

// ---- Geometry ---------------------------------------------------------------

export interface Rect { x: number; y: number; w: number; h: number }
type Pt = [number, number];

export function bbox(a: Annot): Rect {
  if (isLine(a)) {
    return { x: Math.min(a.x1, a.x2), y: Math.min(a.y1, a.y2), w: Math.abs(a.x2 - a.x1), h: Math.abs(a.y2 - a.y1) };
  }
  if (a.kind === "path") {
    const xs = a.points.filter((_, i) => i % 2 === 0);
    const ys = a.points.filter((_, i) => i % 2 === 1);
    const x = Math.min(...xs), y = Math.min(...ys);
    return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
  }
  return { x: a.x, y: a.y, w: a.w, h: a.h };
}

export function translate(a: Annot, dx: number, dy: number): Annot {
  if (isLine(a)) return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
  if (a.kind === "path") return { ...a, points: a.points.map((v, i) => v + (i % 2 ? dy : dx)) };
  return { ...a, x: a.x + dx, y: a.y + dy };
}

export function resize(a: BoxAnnot | ImageAnnot, dx: number, dy: number): Annot {
  const w = Math.max(4, a.w + dx);
  const h = a.kind === "image" ? (w * a.h) / a.w : Math.max(4, a.h + dy);
  return { ...a, w, h };
}

function segDist(p: Pt, a: Pt, b: Pt) {
  const [dx, dy] = [b[0] - a[0], b[1] - a[1]];
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

export function pairs(points: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points.length; i += 2) out.push([points[i], points[i + 1]]);
  return out;
}

export function hit(a: Annot, x: number, y: number, tol: number): boolean {
  if (isLine(a) || a.kind === "path") {
    const pts: Pt[] = a.kind === "path" ? pairs(a.points) : [[a.x1, a.y1], [a.x2, a.y2]];
    const r = a.width / 2 + tol;
    if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= r;
    return pts.some((p, i) => i > 0 && segDist([x, y], pts[i - 1], p) <= r);
  }
  return x >= a.x - tol && x <= a.x + a.w + tol && y >= a.y - tol && y <= a.y + a.h + tol;
}

export function ellipsePts(a: Rect): Pt[] {
  const [cx, cy, rx, ry] = [a.x + a.w / 2, a.y + a.h / 2, a.w / 2, a.h / 2];
  return Array.from({ length: 72 }, (_, i) => {
    const t = (i / 72) * Math.PI * 2;
    return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)] as Pt;
  });
}

export const corners = (a: Rect): Pt[] => [[a.x, a.y], [a.x + a.w, a.y], [a.x + a.w, a.y + a.h], [a.x, a.y + a.h]];

export function arrowHead(a: LineAnnot): Pt[] {
  const ang = Math.atan2(a.y2 - a.y1, a.x2 - a.x1);
  const len = Math.max(8, a.width * 4);
  const side = (s: number): Pt => [a.x2 - len * Math.cos(ang + s), a.y2 - len * Math.sin(ang + s)];
  return [side(0.5), [a.x2, a.y2], side(-0.5)];
}

/** Line(s) for underline / strike-through / squiggly, plus their thickness. */
export function markupLine(a: BoxAnnot): { pts: Pt[]; lw: number } {
  const lw = Math.max(1, a.h * 0.08);
  if (a.kind === "strike") return { pts: [[a.x, a.y + a.h / 2], [a.x + a.w, a.y + a.h / 2]], lw };
  const y = a.y + a.h - lw;
  if (a.kind === "underline") return { pts: [[a.x, y], [a.x + a.w, y]], lw };
  const amp = Math.max(1.5, lw * 1.2), step = amp * 2;
  const pts: Pt[] = [];
  for (let x = a.x, i = 0; x <= a.x + a.w; x += step, i++) pts.push([x, y + (i % 2 ? -amp : amp)]);
  return { pts, lw };
}

// ---- Style ------------------------------------------------------------------

const TEXT_KEYS = ["font", "size", "bold", "italic", "underline", "strike", "color", "align"] as const;
const SHAPE_KEYS = ["stroke", "fill", "width", "opacity"] as const;

/** Applies changed panel settings to an annotation (only the fields it has). */
export function applyStyle<A extends Annot>(a: A, s: Partial<Settings>): A {
  if (usesHl(a)) return s.hlColor ? { ...a, stroke: s.hlColor } : a;
  const out: Record<string, unknown> = { ...a };
  for (const k of [...TEXT_KEYS, ...SHAPE_KEYS]) if (k in s && k in a) out[k] = s[k];
  const next = out as unknown as A;
  return next.kind === "text" ? ({ ...next, ...measureText(next, next.text) } as A) : next;
}

/** The panel settings that describe an annotation (so selecting it shows its style). */
export function styleOf(a: Annot): Partial<Settings> {
  if (usesHl(a)) return { hlColor: (a as BoxAnnot | PathAnnot).stroke };
  const out: Record<string, unknown> = {};
  for (const k of [...TEXT_KEYS, ...SHAPE_KEYS]) if (k in a) out[k] = (a as unknown as Record<string, unknown>)[k];
  return out as Partial<Settings>;
}

// ---- Text (rendered by the browser so Thai shaping is correct) ---------------

export const TEXT_PAD = 2;
export const LINE_H = 1.5;

export function cssFont(t: TextStyle, size = t.size) {
  return `${t.italic ? "italic " : ""}${t.bold ? "bold " : ""}${size}px "${t.font}", "Leelawadee UI", Tahoma, sans-serif`;
}

let measurer: CanvasRenderingContext2D | null = null;
export function measureText(t: TextStyle, text: string) {
  measurer ??= document.createElement("canvas").getContext("2d")!;
  measurer.font = cssFont(t);
  const lines = text.split("\n");
  const w = Math.max(...lines.map((l) => measurer!.measureText(l).width));
  return { w: Math.ceil(w) + TEXT_PAD * 2, h: lines.length * t.size * LINE_H + TEXT_PAD * 2 };
}

/** Renders a text annotation at `k` pixels per pt. */
export function textCanvas(a: TextAnnot, k: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.ceil(a.w * k));
  c.height = Math.max(1, Math.ceil(a.h * k));
  const ctx = c.getContext("2d")!;
  ctx.scale(k, k);
  ctx.font = cssFont(a);
  ctx.fillStyle = a.color;
  ctx.textAlign = a.align;
  const x = a.align === "left" ? TEXT_PAD : a.align === "center" ? a.w / 2 : a.w - TEXT_PAD;
  const t = Math.max(1, a.size / 14);
  a.text.split("\n").forEach((line, i) => {
    const base = TEXT_PAD + i * a.size * LINE_H + a.size * 1.15;
    ctx.fillText(line, x, base);
    const lw = ctx.measureText(line).width;
    const left = a.align === "left" ? x : a.align === "center" ? x - lw / 2 : x - lw;
    if (a.underline) ctx.fillRect(left, base + a.size * 0.12, lw, t);
    if (a.strike) ctx.fillRect(left, base - a.size * 0.32, lw, t);
  });
  return c;
}

/** A picture of one line of text (typed signatures, stamps). */
export function textPicture(text: string, font: string, color: string, border = false): Picture {
  const k = 4, pad = border ? 10 : 4, size = parseFloat(font.match(/(\d+(?:\.\d+)?)px/)![1]);
  const ctx = document.createElement("canvas").getContext("2d")!;
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + pad * 2;
  const h = Math.ceil(size * 1.6) + pad * 2;
  const c = document.createElement("canvas");
  c.width = w * k;
  c.height = h * k;
  const g = c.getContext("2d")!;
  g.scale(k, k);
  g.font = font;
  g.fillStyle = g.strokeStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2 + size * 0.05);
  if (border) {
    g.lineWidth = 2.5;
    g.beginPath();
    g.roundRect(1.5, 1.5, w - 3, h - 3, 6);
    g.stroke();
  }
  return { src: c.toDataURL("image/png"), w, h };
}

export const STAMPS = [
  { label: "อนุมัติ", color: "#15803d" },
  { label: "ไม่อนุมัติ", color: "#b91c1c" },
  { label: "ตรวจแล้ว", color: "#1d4ed8" },
  { label: "ด่วน", color: "#b91c1c" },
  { label: "ลับ", color: "#b91c1c" },
  { label: "ร่าง", color: "#525252" },
  { label: "สำเนาถูกต้อง", color: "#1d4ed8" },
] as const;

/** Crops transparent edges; returns null for an empty canvas. `k` = pixels per pt. */
export function trimCanvas(c: HTMLCanvasElement, k: number): Picture | null {
  const { width: W, height: H } = c;
  const data = c.getContext("2d")!.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (data[(y * W + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const out = document.createElement("canvas");
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext("2d")!.drawImage(c, -x0, -y0);
  return { src: out.toDataURL("image/png"), w: out.width / k, h: out.height / k };
}

/** Any browser-readable image file → PNG picture. */
export async function fileToPicture(file: Blob): Promise<Picture> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d")!.drawImage(bmp, 0, 0);
  return { src: c.toDataURL("image/png"), w: bmp.width / 4, h: bmp.height / 4 };
}

/** Scales a picture down so it is at most `max` pt wide. */
export function fitPicture(p: Picture, max = 160): Picture {
  return p.w <= max ? p : { ...p, w: max, h: (p.h * max) / p.w };
}

// ---- Flatten into the PDF ---------------------------------------------------

/**
 * Draws `annots` into the PDF permanently and optionally rotates one page.
 * Coordinates go through pdf.js's viewport, so rotated / cropped pages work.
 */
export async function bake(
  src: Uint8Array,
  doc: PdfJsDoc,
  annots: Annot[],
  rotate?: { page: number; delta: number },
): Promise<Uint8Array> {
  const { PDFDocument, rgb, degrees, BlendMode, LineCapStyle } = await import("pdf-lib");
  const out = await PDFDocument.load(src);
  const pages = out.getPages();
  const color = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  };

  const byPage = new Map<number, Annot[]>();
  for (const a of annots) byPage.set(a.page, [...(byPage.get(a.page) ?? []), a]);

  for (const [p, list] of byPage) {
    const page = pages[p];
    const vp = (await doc.getPage(p + 1)).getViewport({ scale: 1 });
    const cv = (x: number, y: number) => vp.convertToPdfPoint(x, y) as Pt;
    // drawSvgPath at (0,0) flips y, so feed it (x, -y) in PDF space.
    const d = (pts: Pt[], close = false) =>
      pts.map(([x, y], i) => {
        const [px, py] = cv(x, y);
        return `${i ? "L" : "M"}${px} ${-py}`;
      }).join(" ") + (close ? " Z" : "");
    const line = (path: string, a: { stroke: string; opacity: number }, width: number, multiply = false) =>
      page.drawSvgPath(path, {
        x: 0, y: 0,
        borderColor: color(a.stroke), borderWidth: width, borderOpacity: a.opacity,
        borderLineCap: LineCapStyle.Round,
        ...(multiply ? { blendMode: BlendMode.Multiply } : {}),
      });
    const picture = async (a: Rect & { opacity: number }, png: string) => {
      const img = await out.embedPng(png);
      const [x, y] = cv(a.x, a.y + a.h); // picture's own bottom-left as shown on screen
      page.drawImage(img, { x, y, width: a.w, height: a.h, rotate: degrees(vp.rotation), opacity: a.opacity });
    };

    for (const a of list) {
      switch (a.kind) {
        case "rect":
        case "ellipse":
          page.drawSvgPath(d(a.kind === "rect" ? corners(a) : ellipsePts(a), true), {
            x: 0, y: 0,
            borderColor: color(a.stroke), borderWidth: a.width, borderOpacity: a.opacity,
            ...(a.fill ? { color: color(a.fill), opacity: a.opacity } : {}),
          });
          break;
        case "highlight":
          page.drawSvgPath(d(corners(a), true), { x: 0, y: 0, color: color(a.stroke), opacity: a.opacity, blendMode: BlendMode.Multiply });
          break;
        case "underline":
        case "strike":
        case "squiggly": {
          const m = markupLine(a);
          line(d(m.pts), a, m.lw);
          break;
        }
        case "line":
          line(d([[a.x1, a.y1], [a.x2, a.y2]]), a, a.width);
          break;
        case "arrow":
          line(d([[a.x1, a.y1], [a.x2, a.y2]]), a, a.width);
          line(d(arrowHead(a)), a, a.width);
          break;
        case "path": {
          const pts = pairs(a.points);
          line(d(pts.length === 1 ? [pts[0], pts[0]] : pts), a, a.width, a.marker);
          break;
        }
        case "text":
          await picture(a, textCanvas(a, 4).toDataURL("image/png"));
          break;
        case "image":
          await picture(a, a.src);
          break;
      }
    }
  }

  if (rotate) {
    const pg = pages[rotate.page];
    pg.setRotation(degrees((((pg.getRotation().angle + rotate.delta) % 360) + 360) % 360));
  }
  return out.save();
}
