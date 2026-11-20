import { useCallback, useEffect, useState } from "react";
import PageShell, { actionPrimary } from "../components/PageShell";
import { IconFile, IconTrash } from "../components/icons";
import { DropZone, Panel, errText, iconBtn, useReorder } from "../components/ToolKit";
import { exportPdf, fileName } from "../lib/pdf";
import { organizePdf, renderThumbs } from "../lib/tools";
import { ChosenFile, usePickOnePdf, type ToolProps } from "./Tools";

interface PageItem {
  key: number;
  index: number; // 0-based page in the source file
  rotate: number; // extra degrees, multiple of 90
}
let nextKey = 1;

export default function OrganizePages({ onBack, onError, onDone }: ToolProps) {
  const [items, setItems] = useState<PageItem[]>([]);
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const reset = useCallback(() => {
    setItems([]);
    setThumbs([]);
  }, []);
  const { file, dragOver, chooseViaDialog } = usePickOnePdf(onError, reset);
  const { dragKey, handle } = useReorder(setItems, busy);

  useEffect(() => {
    if (!file) return;
    const job = renderThumbs(file.path, 220, (i, url) =>
      setThumbs((cur) => {
        const next = [...cur];
        next[i] = url;
        return next;
      }),
    );
    job.pages
      .then((n) => setItems(Array.from({ length: n }, (_, index) => ({ key: nextKey++, index, rotate: 0 }))))
      .catch((e) => onError(`เปิดไฟล์ไม่ได้: ${errText(e)}`));
    return job.cancel;
  }, [file?.path, onError]); // eslint-disable-line react-hooks/exhaustive-deps

  const update = (key: number, fn: (p: PageItem) => PageItem) =>
    setItems((cur) => cur.map((p) => (p.key === key ? fn(p) : p)));
  const duplicate = (key: number) =>
    setItems((cur) => {
      const i = cur.findIndex((p) => p.key === key);
      return [...cur.slice(0, i + 1), { ...cur[i], key: nextKey++ }, ...cur.slice(i + 1)];
    });

  const changed = items.some((p, i) => p.index !== i || p.rotate % 360 !== 0) || items.length !== (file?.pages ?? 0);

  const save = async () => {
    if (!file) return;
    setBusy(true);
    try {
      const bytes = await organizePdf(file.path, items);
      const dest = await exportPdf(bytes, fileName(file.path).replace(/\.pdf$/i, "_จัดหน้า.pdf"));
      if (dest) onDone({ open: dest });
    } catch (e) {
      onError(`บันทึกไม่สำเร็จ: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageShell
      title="จัดหน้า"
      subtitle={file ? `${items.length} หน้า · ลากเพื่อเรียงลำดับ` : "เรียงลำดับ หมุน ลบ หรือทำสำเนาหน้า"}
      onBack={onBack}
      actions={
        <button onClick={save} disabled={busy || !items.length || !changed} className={actionPrimary} title={changed ? undefined : "ยังไม่มีการเปลี่ยนแปลง"}>
          {busy ? "กำลังบันทึก…" : "บันทึกเป็น…"}
        </button>
      }
    >
      <div className="mx-auto max-w-6xl space-y-6 p-6 lg:p-10">
        {file ? (
          <ChosenFile path={file.path} dragOver={dragOver} busy={busy} onChange={chooseViaDialog} />
        ) : (
          <DropZone onClick={chooseViaDialog} dragOver={dragOver} label="คลิกเพื่อเลือกไฟล์ PDF หรือลากไฟล์มาวางที่นี่" />
        )}

        {items.length > 0 && (
          <Panel className="p-4">
            <ol className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
              {items.map((p, i) => (
                <li
                  key={p.key}
                  data-key={p.key}
                  className={`overflow-hidden rounded-xl border bg-white dark:bg-ink-950 ${
                    dragKey === p.key ? "border-maroon ring-2 ring-maroon/30 dark:border-coral" : "border-maroon/10 dark:border-white/10"
                  }`}
                >
                  <div {...handle(p.key)} className={`${handle(p.key).className} flex aspect-square items-center justify-center p-2`}>
                    {thumbs[p.index] ? (
                      <img
                        src={thumbs[p.index]}
                        alt={`หน้า ${p.index + 1}`}
                        draggable={false}
                        style={{ transform: `rotate(${p.rotate}deg)` }}
                        className="max-h-full max-w-full shadow-sm transition-transform"
                      />
                    ) : (
                      <IconFile className="h-8 w-8 animate-pulse text-neutral-300" />
                    )}
                  </div>
                  <div className="flex items-center gap-0.5 border-t border-maroon/10 px-1.5 py-1 text-xs dark:border-white/10">
                    <span className="flex-1 truncate pl-1 text-neutral-500" title={`หน้า ${p.index + 1} ของไฟล์เดิม`}>
                      {i + 1}
                      {p.index !== i && <span className="text-neutral-400"> (เดิม {p.index + 1})</span>}
                    </span>
                    <button onClick={() => update(p.key, (x) => ({ ...x, rotate: x.rotate - 90 }))} disabled={busy} aria-label="หมุนทวนเข็ม" title="หมุนทวนเข็ม" className={iconBtn}>
                      ↺
                    </button>
                    <button onClick={() => update(p.key, (x) => ({ ...x, rotate: x.rotate + 90 }))} disabled={busy} aria-label="หมุนตามเข็ม" title="หมุนตามเข็ม" className={iconBtn}>
                      ↻
                    </button>
                    <button onClick={() => duplicate(p.key)} disabled={busy} aria-label="ทำสำเนา" title="ทำสำเนา" className={iconBtn}>
                      ⧉
                    </button>
                    <button
                      onClick={() => setItems((cur) => cur.filter((x) => x.key !== p.key))}
                      disabled={busy || items.length === 1}
                      aria-label="ลบหน้า"
                      title={items.length === 1 ? "ต้องเหลืออย่างน้อย 1 หน้า" : "ลบหน้า"}
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
      </div>
    </PageShell>
  );
}
