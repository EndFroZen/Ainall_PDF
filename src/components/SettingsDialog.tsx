import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { getStartMaximized, setStartMaximized } from "../lib/window";
import { getTheme, setTheme, type ThemePref } from "../lib/theme";

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition ${
        checked ? "bg-maroon dark:bg-coral" : "bg-neutral-300 dark:bg-ink-700"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-5" : ""
        }`}
      />
    </button>
  );
}

const THEMES: { value: ThemePref; label: string; icon: React.ReactNode }[] = [
  {
    value: "system",
    label: "ตามระบบ",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M8 20h8M12 16v4" />
      </>
    ),
  },
  {
    value: "light",
    label: "สว่าง",
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </>
    ),
  },
  {
    value: "dark",
    label: "มืด",
    icon: <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />,
  },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.2em] text-neutral-500 dark:text-neutral-400">
        {title}
      </h3>
      {children}
    </section>
  );
}

export default function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [startMaximized, setStartMax] = useState(false);
  const [theme, setThemeState] = useState<ThemePref>(getTheme);

  useEffect(() => {
    if (!open) return;
    setThemeState(getTheme());
    getStartMaximized().then(setStartMax).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toggleStartMaximized = async (v: boolean) => {
    setStartMax(v);
    await setStartMaximized(v);
    // Apply right away too, so the user sees the effect.
    const win = getCurrentWindow();
    if (v) await win.maximize();
    else await win.unmaximize();
  };

  const chooseTheme = (t: ThemePref) => {
    setThemeState(t);
    void setTheme(t);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white text-neutral-900 shadow-2xl animate-rise dark:bg-ink-900 dark:text-neutral-100 dark:ring-1 dark:ring-white/10"
      >
        <div className="flex items-center justify-between border-b border-maroon/10 px-6 py-4 dark:border-white/10">
          <h2 id="settings-title" className="text-lg font-semibold text-maroon dark:text-coral">
            ตั้งค่า
          </h2>
          <button
            onClick={onClose}
            aria-label="ปิด"
            className="rounded-full p-1.5 text-neutral-500 transition hover:bg-maroon/10 hover:text-maroon dark:text-neutral-400 dark:hover:bg-white/10 dark:hover:text-white"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        <div className="space-y-6 px-6 py-5">
          <Section title="ธีม">
            <div role="radiogroup" aria-label="ธีม" className="grid grid-cols-3 gap-2">
              {THEMES.map((t) => {
                const active = theme === t.value;
                return (
                  <button
                    key={t.value}
                    role="radio"
                    aria-checked={active}
                    onClick={() => chooseTheme(t.value)}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-sm transition ${
                      active
                        ? "border-maroon bg-maroon/5 font-medium text-maroon dark:border-coral dark:bg-coral/10 dark:text-coral"
                        : "border-maroon/15 text-neutral-600 hover:border-maroon/40 dark:border-white/10 dark:text-neutral-300 dark:hover:border-white/30"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      {t.icon}
                    </svg>
                    {t.label}
                  </button>
                );
              })}
            </div>
          </Section>

          <Section title="หน้าต่าง">
            <div className="flex items-center justify-between gap-6">
              <div>
                <p className="text-sm font-medium">เปิดแบบเต็มหน้าต่างทุกครั้ง</p>
                <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">ขยายหน้าต่างให้เต็มจอเมื่อเปิดแอป</p>
              </div>
              <Toggle checked={startMaximized} onChange={toggleStartMaximized} label="เปิดแบบเต็มหน้าต่างทุกครั้ง" />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
