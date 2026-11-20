import { useState } from "react";
import PageShell, { actionPrimary } from "../components/PageShell";
import { Choice, DropZone, Panel, errText, inputCls, sectionTitle } from "../components/ToolKit";
import { exportPdf, fileName } from "../lib/pdf";
import type { Corner } from "../lib/stamp";
import { stampPdf } from "../lib/tools";
import { ChosenFile, usePickOnePdf, type ToolProps } from "./Tools";

const FORMATS = ["{n}", "หน้า {n}", "{n} / {total}", "หน้า {n} จาก {total}"];
const CORNERS: { corner: Corner; title: string }[] = [
  { corner: "bottom-center", title: "ล่าง กลาง" },
  { corner: "bottom-right", title: "ล่าง ขวา" },
  { corner: "top-center", title: "บน กลาง" },
  { corner: "top-right", title: "บน ขวา" },
];
const PRESETS = ["ลับ", "สำเนา", "ร่าง", "ห้ามเผยแพร่"];

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

  const ready = !!file && (numbersOn || (wmOn && !!wmText.trim())) && !busy;

  const run = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const bytes = await stampPdf(file.path, {
        numbers: numbersOn ? { format, corner, size: 11 } : undefined,
        watermark: wmOn ? { text: wmText, color: wmColor, opacity: wmOpacity, diagonal } : undefined,
      });
      const dest = await exportPdf(bytes, fileName(file.path).replace(/\.pdf$/i, numbersOn ? "_เลขหน้า.pdf" : "_ลายน้ำ.pdf"));
      if (dest) onDone({ open: dest });
    } catch (e) {
      onError(`ใส่ไม่สำเร็จ: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (checked: boolean, set: (v: boolean) => void, label: string) => (
    <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm font-semibold">
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
      <div className="mx-auto max-w-3xl space-y-8 p-6 lg:p-10">
        {file ? (
          <ChosenFile path={file.path} pages={file.pages} dragOver={dragOver} busy={busy} onChange={chooseViaDialog} />
        ) : (
          <DropZone onClick={chooseViaDialog} dragOver={dragOver} label="คลิกเพื่อเลือกไฟล์ PDF หรือลากไฟล์มาวางที่นี่" />
        )}

        {file && (
          <fieldset disabled={busy} className="space-y-8">
            <section>
              {toggle(numbersOn, setNumbersOn, "ใส่เลขหน้า")}
              {numbersOn && (
                <Panel className="space-y-5 p-4">
                  <div>
                    <h3 className={sectionTitle}>รูปแบบ</h3>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {FORMATS.map((f) => (
                        <Choice key={f} name="format" checked={format === f} onChange={() => setFormat(f)} title={f.replace("{n}", "3").replace("{total}", "10")} />
                      ))}
                    </div>
                  </div>
                  <div>
                    <h3 className={sectionTitle}>ตำแหน่ง</h3>
                    <div className="grid gap-2 sm:grid-cols-4">
                      {CORNERS.map((c) => (
                        <Choice key={c.corner} name="corner" checked={corner === c.corner} onChange={() => setCorner(c.corner)} title={c.title} />
                      ))}
                    </div>
                  </div>
                </Panel>
              )}
            </section>

            <section>
              {toggle(wmOn, setWmOn, "ใส่ลายน้ำ")}
              {wmOn && (
                <Panel className="space-y-5 p-4">
                  <div>
                    <h3 className={sectionTitle}>ข้อความ</h3>
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
                  <div className="grid gap-5 sm:grid-cols-3">
                    <label className="text-sm">
                      <span className={`${sectionTitle} block`}>สี</span>
                      <input type="color" value={wmColor} onChange={(e) => setWmColor(e.target.value)} className="h-9 w-16 cursor-pointer rounded" />
                    </label>
                    <label className="text-sm">
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
                    <label className="flex items-center gap-2 self-end pb-2 text-sm">
                      <input type="checkbox" checked={diagonal} onChange={(e) => setDiagonal(e.target.checked)} className="h-4 w-4 accent-maroon" />
                      แนวทแยง
                    </label>
                  </div>
                  {/* Rough preview of how it sits on a page */}
                  <div className="mx-auto flex aspect-[1/1.414] w-40 items-center justify-center overflow-hidden rounded border border-neutral-200 bg-white shadow-sm">
                    <span
                      className="whitespace-nowrap text-2xl font-bold"
                      style={{ color: wmColor, opacity: wmOpacity, transform: diagonal ? "rotate(-54.7deg)" : undefined }}
                    >
                      {wmText}
                    </span>
                  </div>
                </Panel>
              )}
            </section>
          </fieldset>
        )}
      </div>
    </PageShell>
  );
}
