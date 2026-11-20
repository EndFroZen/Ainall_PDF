/**
 * Parses page ranges like "1-3, 5, 8-" for a document of `total` pages.
 * Each comma-separated part becomes one output file. Returns 1-based [from, to]
 * pairs, or an error message in Thai.
 */
export function parseRanges(text: string, total: number): [number, number][] | string {
  const out: [number, number][] = [];
  for (const raw of text.split(",")) {
    const part = raw.trim();
    if (!part) continue;
    const m = /^(\d+)?\s*(-)?\s*(\d+)?$/.exec(part);
    if (!m || (!m[1] && !m[3])) return `อ่านช่วงหน้า "${part}" ไม่ได้`;
    const from = m[1] ? Number(m[1]) : 1;
    const to = m[2] ? (m[3] ? Number(m[3]) : total) : from;
    if (from < 1 || to > total || from > to) return `ช่วง "${part}" ไม่อยู่ใน 1–${total}`;
    out.push([from, to]);
  }
  return out.length ? out : "ยังไม่ได้ระบุช่วงหน้า";
}
