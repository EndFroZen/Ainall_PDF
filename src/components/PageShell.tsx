import type { ReactNode } from "react";
import LogoMark from "./LogoMark";
import { IconBack } from "./icons";

/** Common frame for the management pages: top bar + scrollable body. */
export default function PageShell({
  title,
  subtitle,
  onBack,
  backLabel = "กลับ",
  actions,
  children,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack: () => void;
  backLabel?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full flex-col bg-[#f7f1e8] text-neutral-900 dark:bg-ink-950 dark:text-neutral-100">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b border-maroon/10 bg-cream/70 px-4 backdrop-blur dark:border-white/10 dark:bg-ink-900/80 lg:px-8">
        <button
          onClick={onBack}
          aria-label={backLabel}
          title={backLabel}
          className="rounded-full p-2 text-neutral-600 transition hover:bg-maroon/10 hover:text-maroon dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-coral"
        >
          <IconBack />
        </button>
        <LogoMark className="h-7 w-7 shrink-0 bg-maroon dark:bg-coral" />
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold leading-tight">{title}</h1>
          {subtitle && <p className="truncate text-xs text-neutral-500 dark:text-neutral-400">{subtitle}</p>}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">{actions}</div>
      </header>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

export const actionPrimary =
  "flex items-center gap-2 rounded-full bg-maroon px-4 py-2 text-sm font-semibold text-cream shadow-sm transition hover:bg-maroon-dark disabled:opacity-50 dark:bg-coral dark:text-night dark:hover:bg-[#ea8676]";
export const actionSecondary =
  "flex items-center gap-2 rounded-full border border-maroon/20 px-4 py-2 text-sm font-medium text-maroon transition hover:bg-maroon/5 dark:border-white/15 dark:text-neutral-200 dark:hover:bg-white/5";
