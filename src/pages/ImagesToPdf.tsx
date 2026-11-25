import { useCallback, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import PageShell, { actionPrimary, actionSecondary } from "../components/PageShell";
import { IconTrash, IconUpload } from "../components/icons";
import { Choice, DropZone, Panel, errText, iconBtn, sectionTitle, useFileDrop, useReorder } from "../components/ToolKit";
import { exportPdf, fileName } from "../lib/pdf";
import { imagesToPdf, isImage, pickImagePaths, type PageFit } from "../lib/tools";
import type { ToolProps } from "./Tools";

interface Img {
  key: number;
  path: string;
}
let nextKey = 1;

export default function ImagesToPdf({ onBack, onError, onDone }: ToolProps) {
  const [items, setItems] = useState<Img[]>([]);
  const [fit, setFit] = useState<PageFit>("a4");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const busy = progress !== null;

  const addPaths = useCallback(
    (paths: string[]) => {
      const imgs = paths.filter(isImage);
      if (imgs.length < paths.length) onError("ข้ามไฟล์ที่ไม่ใช่ JPG/PNG");
      setItems((cur) => [...cur, ...imgs.map((path) => ({ key: nextKey++, path }))]);
    },
    [onError],
  );
  const dragOver = useFileDrop(addPaths);
  const { dragKey, handle } = useReorder(setItems, busy);

  const addViaDialog = async () => {
    try {
      addPaths(await pickImagePaths());
    } catch (e) {
      onError(errText(e));
    }
  };

  const create = async () => {
    setProgress({ done: 0, total: items.length });
    try {
      const bytes = await imagesToPdf(items.map((it) => it.path), fit, (done, total) => setProgress({ done, total }));
      const dest = await exportPdf(bytes, "รูปภาพ.pdf");
      if (dest) onDone({ open: dest });
    } catch (e) {
      onError(`สร้าง PDF ไม่สำเร็จ: ${errText(e)}`);
    } finally {
      setProgress(null);
    }
  };

  return (
    <PageShell
      title="รูปภาพ → PDF"
      subtitle={items.length ? `${items.length} รูป · ลากเพื่อเรียงลำดับ` : "เพิ่มรูป JPG/PNG เรียงลำดับ แล้วกดสร้าง PDF"}
      onBack={onBack}
      actions={
        <>
          <button onClick={addViaDialog} disabled={busy} className={actionSecondary}>
            <IconUpload className="h-4 w-4" />
            เพิ่มรูป
          </button>
          <button onClick={create} disabled={busy || items.length === 0} className={actionPrimary}>
            {busy ? `กำลังสร้าง ${progress.done}/${progress.total}…` : "สร้าง PDF"}
          </button>
        </>
      }
    >
      <div className={`space-y-8 p-6 lg:p-10 ${items.length ? "mx-auto max-w-4xl" : "flex min-h-full flex-col"}`}>
        {items.length === 0 ? (
          <DropZone className="flex-1" onClick={addViaDialog} dragOver={dragOver} label="คลิกเพื่อเลือกรูป หรือลากรูปมาวางที่นี่ (JPG, PNG)" />
        ) : (
          <Panel dragOver={dragOver} className="p-4">
            <ol className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((it, i) => (
                <li
                  key={it.key}
                  data-key={it.key}
                  className={`group relative overflow-hidden rounded-xl border bg-white dark:bg-ink-950 ${
                    dragKey === it.key ? "border-maroon ring-2 ring-maroon/30 dark:border-coral" : "border-maroon/10 dark:border-white/10"
                  }`}
                >
                  <div {...handle(it.key)} className={`${handle(it.key).className} aspect-[3/4]`}>
                    <img src={convertFileSrc(it.path)} alt="" draggable={false} className="h-full w-full object-contain" />
                  </div>
                  <div className="flex items-center gap-2 border-t border-maroon/10 px-2 py-1.5 text-xs dark:border-white/10">
                    <span className="text-neutral-400">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate" title={it.path}>
                      {fileName(it.path)}
                    </span>
                    <button
                      onClick={() => setItems((cur) => cur.filter((x) => x.key !== it.key))}
                      disabled={busy}
                      aria-label="นำออก"
                      title="นำออก"
                      className={`${iconBtn} hover:text-brand-700`}
                    >
                      <IconTrash className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          </Panel>
        )}

        <section>
          <h2 className={sectionTitle}>ขนาดหน้า</h2>
          <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
            <Choice name="fit" checked={fit === "a4"} onChange={() => setFit("a4")} title="A4" desc="วางรูปกลางหน้า A4 แนวตั้งหรือแนวนอนตามรูป" />
            <Choice name="fit" checked={fit === "image"} onChange={() => setFit("image")} title="ตามสัดส่วนรูป" desc="หน้ากระดาษมีรูปทรงเดียวกับรูป ไม่มีขอบ" />
          </fieldset>
        </section>
      </div>
    </PageShell>
  );
}
