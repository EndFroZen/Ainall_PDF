import { useEffect, useMemo, useState } from "react";
import PageShell, { actionPrimary } from "../components/PageShell";
import PdfThumb from "../components/PdfThumb";
import { DropZone, errText, inputCls, sectionTitle } from "../components/ToolKit";
import { textPicture } from "../lib/annotations";
import { exportPdf, fileName } from "../lib/pdf";
import { cornerCenter, pageLabel, type Corner } from "../lib/stamp";
import { FONT, pageSizes, stampPdf } from "../lib/tools";
import { ChosenFile, usePickOnePdf, type ToolProps } from "./Tools";

const FORMATS = ["{n}", "หน้า {n}", "{n} / {total}", "หน้า {n} จาก {total}"];
const CORNER_TITLE: Record<Corner, string> = {
  "top-left": "บนซ้าย",
  "top-center": "บนกลาง",
  "top-right": "บนขวา",
  "bottom-left": "ล่างซ้าย",
  "bottom-center": "ล่างกลาง",
  "bottom-right": "ล่างขวา",
};
const PRESETS = ["ลับ", "สำเนา", "ร่าง", "ห้ามเผยแพร่"];
const NUM_SIZE = 11;

type Size = { width: number; height: number };
type Watermark = { text: string; color: string; opacity: number; diagonal: boolean };

export default function StampPdf({ onBack, onError, onDone }: ToolProps) {
  const { file, dragOver, chooseViaDialog } = usePickOnePdf(onError);
  const [numbersOn, setNumbersOn] = useState(true);
  const [format, setFormat] = useState(FORMATS[1]);
  const [corner, setCorner] = useState<Corner>("bottom-center");
  const [wmOn, setWmOn] = useState(false);
  const [wmText, setWmText] = useState("ลับ");
  const [wmColor, setWmColor] = useState("#b91c1c");
  const [wmOpacity, setWmOpacity] = useState(0.15);
  const [diagonal, setDiagonal] = useState(true);
  const [busy, setBusy] = useState(false);
  const [sizes, setSizes] = useState<Size[] | null>(null);

  useEffect(() => {
    setSizes(null);
    if (!file) return;
    let live = true;
    pageSizes(file.path).then((s) => live && setSizes(s), () => live && setSizes([]));
    return () => {
      live = false;
    };
  }, [file?.path]);

  const watermark: Watermark | undefined = wmOn && wmText.trim() ? { text: wmText.trim(), color: wmColor, opacity: wmOpacity, diagonal } : undefined;
  const ready = !!file && (numbersOn || !!watermark) && !busy;

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const bytes = await stampPdf(file.path, { numbers: numbersOn ? { format, corner, size: NUM_SIZE } : undefined, watermark });
      const dest = await exportPdf(bytes, fileName(file.path).replace(/\.pdf$/i, numbersOn ? "_เลขหน้า.pdf" : "_ลายน้ำ.pdf"));
      if (dest) onDone({ open: dest });
    } catch (e) {
      onError(`ใส่ไม่สำเร็จ: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (checked: boolean, set: (v: boolean) => void, label: string) => (
    <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
      <input type="checkbox" checked={checked} onChange={(e) => set(e.target.checked)} className="h-4 w-4 accent-maroon" />
      {label}
    </label>
  );

  return (
    <PageShell
      title="เลขหน้า / ลายน้ำ"
      subtitle="ใส่เลขหน้า และ/หรือ ลายน้ำข้อความลงทุกหน้า"
      onBack={onBack}
      actions={
        <button onClick={run} disabled={!ready} className={actionPrimary}>
          {busy ? "กำลังใส่…" : "บันทึกเป็น…"}
        </button>
      }
    >
      {!file ? (
        <div className="flex min-h-full flex-col p-6 lg:p-10">
          <DropZone className="flex-1" onClick={chooseViaDialog} dragOver={dragOver} label="คลิกเพื่อเลือกไฟล์ PDF หรือลากไฟล์มาวางที่นี่" />
        </div>
      ) : (
        <div className="flex h-full min-h-0">
          {/* Tools */}
          <aside className="w-80 shrink-0 overflow-y-auto border-r border-maroon/10 bg-white p-5 dark:border-white/10 dark:bg-ink-900">
            <ChosenFile path={file.path} pages={file.pages} dragOver={dragOver} busy={busy} onChange={chooseViaDialog} showPages={false} />

            <fieldset disabled={busy} className="mt-6 space-y-6">
              <section className="space-y-3">
                {toggle(numbersOn, setNumbersOn, "ใส่เลขหน้า")}
                {numbersOn && (
                  <div className="space-y-4 pl-6">
                    <label className="block">
                      <span className={`${sectionTitle} block`}>รูปแบบ</span>
                      <select value={format} onChange={(e) => setFormat(e.target.value)} className={inputCls}>
                        {FORMATS.map((f) => (
                          <option key={f} value={f}>
                            {pageLabel(f, 3, 10)}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div>
                      <span className={`${sectionTitle} block`}>ตำแหน่ง · {CORNER_TITLE[corner]}</span>
                      {/* Mini page: click a spot */}
                      <div role="radiogroup" aria-label="ตำแหน่งเลขหน้า" className="relative h-28 w-20 rounded border border-neutral-300 bg-white dark:border-white/20">
                        {(Object.keys(CORNER_TITLE) as Corner[]).map((c) => {
                          const [v, h] = c.split("-");
                          const pos = `${v === "top" ? "top-1.5" : "bottom-1.5"} ${h === "left" ? "left-1.5" : h === "right" ? "right-1.5" : "left-1/2 -translate-x-1/2"}`;
                          return (
                            <button
                              key={c}
                              type="button"
                              role="radio"
                              aria-checked={corner === c}
                              aria-label={CORNER_TITLE[c]}
                              title={CORNER_TITLE[c]}
                              onClick={() => setCorner(c)}
                              className={`absolute h-3.5 w-3.5 rounded-full border-2 ${pos} ${corner === c ? "border-maroon bg-maroon" : "border-neutral-300 hover:border-maroon"}`}
                            />
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </section>

              <section className="space-y-3">
                {toggle(wmOn, setWmOn, "ใส่ลายน้ำ")}
                {wmOn && (
                  <div className="space-y-4 pl-6">
                    <div>
                      <span className={`${sectionTitle} block`}>ข้อความ</span>
                      <input value={wmText} onChange={(e) => setWmText(e.target.value)} placeholder="เช่น ลับ" className={inputCls} />
                      <div className="mt-2 flex flex-wrap gap-2">
                        {PRESETS.map((p) => (
                          <button
                            key={p}
                            type="button"
                            onClick={() => setWmText(p)}
                            className="rounded-full border border-maroon/20 px-3 py-1 text-xs hover:bg-maroon/5 dark:border-white/15 dark:hover:bg-white/5"
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-end gap-4">
                      <label className="text-sm">
                        <span className={`${sectionTitle} block`}>สี</span>
                        <input type="color" value={wmColor} onChange={(e) => setWmColor(e.target.value)} className="h-9 w-14 cursor-pointer rounded" />
                      </label>
                      <label className="flex items-center gap-2 pb-2 text-sm">
                        <input type="checkbox" checked={diagonal} onChange={(e) => setDiagonal(e.target.checked)} className="h-4 w-4 accent-maroon" />
                        แนวทแยง
                      </label>
                    </div>
                    <label className="block text-sm">
                      <span className={`${sectionTitle} block`}>ความทึบ {Math.round(wmOpacity * 100)}%</span>
                      <input
                        type="range"
                        min={0.05}
                        max={0.6}
                        step={0.05}
                        value={wmOpacity}
                        onChange={(e) => setWmOpacity(Number(e.target.value))}
                        className="w-full accent-maroon"
                      />
                    </label>
                  </div>
                )}
              </section>
            </fieldset>
          </aside>

          {/* Every page, with the stamp drawn on top as it will be saved */}
          <div className="min-w-0 flex-1 overflow-y-auto bg-neutral-200/70 p-8 dark:bg-ink-950">
            {!sizes ? (
              <p className="text-center text-sm text-neutral-500">กำลังโหลดหน้า…</p>
            ) : (
              <ol className="mx-auto max-w-3xl space-y-6" aria-label="ตัวอย่างทุกหน้า">
                {sizes.map((size, i) => (
                  <li key={i} aria-label={`หน้า ${i + 1}`}>
                    <StampedPage
                      path={file.path}
                      n={i + 1}
                      size={size}
                      label={numbersOn ? pageLabel(format, i + 1, sizes.length) : null}
                      corner={corner}
                      watermark={watermark}
                    />
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}

/** One page with the number/watermark overlaid in PDF points, same maths as stampPdf. */
function StampedPage({
  path,
  n,
  size,
  label,
  corner,
  watermark: wm,
}: {
  path: string;
  n: number;
  size: Size;
  label: string | null;
  corner: Corner;
  watermark?: Watermark;
}) {
  const { width: W, height: H } = size;
  const num = useMemo(() => label && textPicture(label, `${NUM_SIZE}px ${FONT}`, "#333333"), [label]);
  const mark = useMemo(() => wm && textPicture(wm.text, `bold 96px ${FONT}`, wm.color), [wm?.text, wm?.color]);

  let markBox = null;
  if (wm && mark) {
    const angle = wm.diagonal ? (Math.atan2(H, W) * 180) / Math.PI : 0;
    const room = wm.diagonal ? Math.hypot(W, H) * 0.7 : W * 0.8;
    const s = Math.min(room / mark.w, (H * 0.4) / mark.h);
    const [w, h] = [mark.w * s, mark.h * s];
    markBox = (
      <image href={mark.src} x={W / 2 - w / 2} y={H / 2 - h / 2} width={w} height={h} opacity={wm.opacity} transform={`rotate(${-angle} ${W / 2} ${H / 2})`} />
    );
  }
  let numBox = null;
  if (num) {
    const [cx, cy] = cornerCenter(size as Parameters<typeof cornerCenter>[0], corner, num.w, num.h);
    numBox = <image href={num.src} x={cx - num.w / 2} y={cy - num.h / 2} width={num.w} height={num.h} />;
  }

  return (
    <div
      className="relative w-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12),0_8px_24px_rgba(0,0,0,0.08)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.5),0_8px_24px_rgba(0,0,0,0.4)]"
      style={{ aspectRatio: `${W} / ${H}` }}
    >
      <PdfThumb path={path} page={n} width={1200} contain className="absolute inset-0" />
      <svg viewBox={`0 0 ${W} ${H}`} className="pointer-events-none absolute inset-0 h-full w-full">
        {markBox}
        {numBox}
      </svg>
    </div>
  );
}
