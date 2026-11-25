/** The part of a pdf.js PageViewport (scale 1) that placement needs. */
export interface Viewport {
  width: number;
  height: number;
  rotation: number;
  convertToPdfPoint(x: number, y: number): number[];
}

/**
 * Where to draw an upright w×h picture centred on screen point (cx, cy), turned `angle`
 * degrees anticlockwise as seen on screen. Screen = the page as displayed (rotation applied,
 * y down, 1 unit = 1pt). Returns pdf-lib drawImage options (x, y = picture's bottom-left).
 */
export function place(vp: Viewport, cx: number, cy: number, w: number, h: number, angle = 0) {
  const t = (angle * Math.PI) / 180;
  // bottom-left corner relative to the centre, turned anticlockwise on a y-down screen
  const [dx, dy] = [-w / 2, h / 2];
  const sx = cx + dx * Math.cos(t) + dy * Math.sin(t);
  const sy = cy - dx * Math.sin(t) + dy * Math.cos(t);
  const [x, y] = vp.convertToPdfPoint(sx, sy);
  return { x, y, width: w, height: h, rotate: (vp.rotation + angle) % 360 };
}

export type Corner = `${"top" | "bottom"}-${"left" | "center" | "right"}`;

/** Centre of a w×h label at `corner` of the page as displayed, `margin` pt from the edges. */
export function cornerCenter(vp: Viewport, corner: Corner, w: number, h: number, margin = 24): [number, number] {
  const x = corner.endsWith("center") ? vp.width / 2 : corner.endsWith("left") ? margin + w / 2 : vp.width - margin - w / 2;
  const y = corner.startsWith("top") ? margin + h / 2 : vp.height - margin - h / 2;
  return [x, y];
}

/** Page-number text for page `n` of `total`. `format` uses {n} and {total}. */
export const pageLabel = (format: string, n: number, total: number) =>
  format.split("{n}").join(String(n)).split("{total}").join(String(total));
