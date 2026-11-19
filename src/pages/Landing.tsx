import { useEffect, useState } from "react";
import heroLight from "../assets/landing-hero.jpg";
import heroDark from "../assets/landing-hero-dark.jpg";
import LogoMark from "../components/LogoMark";
import { IconFolder } from "../components/icons";
import { listRecentFiles, type RecentFile } from "../lib/db";
import SettingsDialog from "../components/SettingsDialog";
import { useDark } from "../lib/useDark";

export default function Landing({
  onOpenFile,
  onOpenPath,
  onNewDocument,
  onOpenProjects,
  busy,
}: {
  onOpenFile: () => void;
  onOpenPath: (path: string) => void;
  onNewDocument: () => void;
  onOpenProjects: () => void;
  busy: boolean;
}) {
  const [recent, setRecent] = useState<RecentFile[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const dark = useDark();

  useEffect(() => {
    listRecentFiles(5).then(setRecent).catch(() => setRecent([]));
  }, []);

  const openPdf = onOpenFile;
  const newPdf = onNewDocument;

  return (
    <div className="relative h-full overflow-hidden bg-maroon text-cream select-none dark:bg-night">
      {/* Artwork */}
      <img
        src={dark ? heroDark : heroLight}
        alt=""
        draggable={false}
        className="pointer-events-none absolute inset-0 h-full w-full object-cover object-right"
      />
      {/* Keeps the text column readable when the window gets narrow */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-maroon via-maroon/70 to-transparent dark:from-night dark:via-night/70" />

      <div className="relative flex h-full flex-col px-10 py-8 lg:px-16 2xl:px-24 2xl:py-12">
        {/* Brand bar */}
        <header className="flex items-center gap-3 animate-rise">
          <LogoMark className="h-8 w-8 bg-cream" />
          <span className="text-lg font-semibold tracking-tight">
            Ainall <span className="font-light opacity-80">PDF</span>
          </span>
          <button
            onClick={onOpenProjects}
            title="โปรเจกต์"
            className="ml-auto flex items-center gap-2 rounded-full bg-maroon/85 px-4 py-2 text-sm font-medium text-cream shadow-lg shadow-black/15 backdrop-blur-sm transition hover:bg-maroon dark:bg-night/85 dark:hover:bg-night-800"
          >
            <IconFolder className="h-4 w-4" />
            โปรเจกต์
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            aria-label="ตั้งค่า"
            title="ตั้งค่า"
            className="flex items-center gap-2 rounded-full bg-maroon/85 px-4 py-2 text-sm font-medium text-cream shadow-lg shadow-black/15 backdrop-blur-sm transition hover:bg-maroon dark:bg-night/85 dark:hover:bg-night-800"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            ตั้งค่า
          </button>
        </header>
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />

        {/* Hero copy */}
        <main className="flex flex-1 flex-col justify-center">
          <div className="max-w-md 2xl:max-w-xl">
            <p
              className="mb-4 text-xs font-medium uppercase tracking-[0.3em] text-cream/60 animate-rise"
              style={{ animationDelay: "80ms" }}
            >
              PDF Editor
            </p>
            <h1
              className="text-5xl leading-[1.15] font-bold tracking-tight lg:text-6xl 2xl:text-7xl animate-rise"
              style={{ animationDelay: "160ms" }}
            >
              จัดการ PDF
              <br />
              <span className="text-cream/75 dark:text-coral">ได้ดั่งใจนึก</span>
            </h1>
            <p
              className="mt-5 max-w-sm text-base leading-relaxed 2xl:max-w-md 2xl:text-lg text-cream/70 animate-rise"
              style={{ animationDelay: "240ms" }}
            >
              เปิด แก้ไข รวม แยก และเซ็นเอกสาร PDF ได้ในที่เดียว ทำงานบนเครื่องของคุณ ไม่ต้องอัปโหลดไฟล์
            </p>

            <div className="mt-9 flex flex-wrap gap-3 animate-rise" style={{ animationDelay: "320ms" }}>
              <button
                onClick={openPdf}
                disabled={busy}
                title="เปิดไฟล์ PDF (Ctrl+O)"
                className="rounded-full bg-cream px-7 py-3 text-sm font-semibold text-maroon 2xl:px-8 2xl:py-3.5 2xl:text-base shadow-lg shadow-black/20 transition hover:-translate-y-0.5 hover:bg-white active:translate-y-0 dark:bg-coral dark:text-night dark:shadow-black/40 dark:hover:bg-[#ea8676] disabled:cursor-wait disabled:opacity-70 disabled:hover:translate-y-0"
              >
                {busy ? "กำลังเปิด…" : "เปิดไฟล์ PDF"}
              </button>
              <button
                onClick={newPdf}
                className="rounded-full border border-cream/40 px-7 py-3 text-sm font-semibold text-cream 2xl:px-8 2xl:py-3.5 2xl:text-base transition hover:border-cream hover:bg-cream/10 dark:border-cream/25"
              >
                สร้างเอกสารใหม่
              </button>
            </div>
          </div>
        </main>

        {/* Recent files */}
        <footer className="-mx-5 w-[min(28rem,100%)] rounded-2xl bg-maroon/90 px-5 py-4 shadow-xl shadow-black/15 dark:bg-night/90 dark:shadow-black/40 backdrop-blur-sm animate-rise" style={{ animationDelay: "400ms" }}>
          <h2 className="mb-3 text-xs font-medium uppercase tracking-[0.25em] text-cream/50">ไฟล์ล่าสุด</h2>
          {recent.length === 0 ? (
            <p className="text-sm text-cream/45">ยังไม่มีไฟล์ที่เปิดล่าสุด</p>
          ) : (
            <ul className="divide-y divide-cream/10 border-y border-cream/10">
              {recent.map((f) => (
                <li key={f.id}>
                  <button
                    onClick={() => onOpenPath(f.path)}
                    disabled={busy}
                    title={f.path}
                    className="flex w-full items-center justify-between gap-4 py-2.5 text-left text-sm transition hover:text-white">
                    <span className="truncate">{f.name}</span>
                    {f.page_count != null && (
                      <span className="shrink-0 text-xs text-cream/45">{f.page_count} หน้า</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </footer>
      </div>
    </div>
  );
}
