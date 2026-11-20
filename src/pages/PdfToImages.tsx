import { useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import PageShell, { actionPrimary } from "../components/PageShell";
import { Choice, DropZone, errText, inputCls, sectionTitle } from "../components/ToolKit";
import { pickFolder } from "../lib/pdf";
import { parseRanges } from "../lib/ranges";
import { pdfToImages, type ImageFormat } from "../lib/tools";
import { ChosenFile, usePickOnePdf, type ToolProps } from "./Tools";

const DPIS = [
  { dpi: 72, title: "72 DPI", desc: "ดูบนจอ ไฟล์เล็ก" },
  { dpi: 150, title: "150 DPI", desc: "ทั่วไป (แนะนำ)" },
  { dpi: 300, title: "300 DPI", desc: "สำหรับพิมพ์ ไฟล์ใหญ่" },
];

export default function PdfToImages({ onBack, onError, onDone }: ToolProps) {
  const { file, dragOver, chooseViaDialog } = usePickOnePdf(onError);
  const [allPages, setAllPages] = useState(true);
  const [rangeText, setRangeText] = useState("");
  const [format, setFormat] = useState<ImageFormat>("png");
  const [dpi, setDpi] = useState(150);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = progress !== null;

  const total = file?.pages ?? 0;
  const ranges = allPages ? ([[1, total]] as [number, number][]) : parseRanges(rangeText, total);
  const pages =
    typeof ranges === "string" || total === 0
      ? []
      : [...new Set(ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i)))];
  const rangeError = !allPages && rangeText.trim() && typeof ranges === "string" ? ranges : null;

  const run = async () => {
    if (!file || !pages.length) return;
    try {
      const dir = await pickFolder("เลือกโฟลเดอร์สำหรับเก็บรูป");
      if (!dir) return;
      setProgress({ done: 0, total: pages.length });
      const written = await pdfToImages(file.path, pages, format, dpi, dir, (done, t) => setProgress({ done, total: t }));
      onDone({ notice: `บันทึกแล้ว ${written.length} รูป` });
      void revealItemInDir(written[0]).catch(() => {});
    } catch (e) {
      onError(`แปลงไม่สำเร็จ: ${errText(e)}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <PageShell
      title="PDF → รูปภาพ"
      subtitle="แปลงแต่ละหน้าเป็นไฟล์รูป 1 รูปต่อ 1 หน้า"
      onBack={onBack}
      actions={
        <button onClick={run} disabled={busy || !pages.length} className={actionPrimary}>
          {busy ? `กำลังแปลง ${progress.done}/${progress.total}…` : pages.length ? `แปลง ${pages.length} หน้า` : "แปลง"}
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
              <h2 className={sectionTitle}>หน้า</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Choice name="pages" checked={allPages} onChange={() => setAllPages(true)} title="ทุกหน้า" />
                <Choice name="pages" checked={!allPages} onChange={() => setAllPages(false)} title="เลือกหน้า" desc={<>เช่น <code>1-3, 5, 8-</code></>}>
                  {!allPages && (
                    <input autoFocus value={rangeText} onChange={(e) => setRangeText(e.target.value)} placeholder="1-3, 5, 8-" className={`${inputCls} mt-3`} />
                  )}
                  {rangeError && <span className="mt-2 block text-sm text-brand-700 dark:text-brand-400">{rangeError}</span>}
                </Choice>
              </div>
            </section>
            <section>
              <h2 className={sectionTitle}>ชนิดไฟล์</h2>
              <div className="grid gap-3 sm:grid-cols-2">
                <Choice name="format" checked={format === "png"} onChange={() => setFormat("png")} title="PNG" desc="คมชัด เหมาะกับเอกสารตัวอักษร" />
                <Choice name="format" checked={format === "jpg"} onChange={() => setFormat("jpg")} title="JPG" desc="ไฟล์เล็กกว่า เหมาะกับหน้าที่มีรูปถ่าย" />
              </div>
            </section>
            <section>
              <h2 className={sectionTitle}>ความละเอียด</h2>
              <div className="grid gap-3 sm:grid-cols-3">
                {DPIS.map((d) => (
                  <Choice key={d.dpi} name="dpi" checked={dpi === d.dpi} onChange={() => setDpi(d.dpi)} title={d.title} desc={d.desc} />
                ))}
              </div>
            </section>
          </fieldset>
        )}
      </div>
    </PageShell>
  );
}
