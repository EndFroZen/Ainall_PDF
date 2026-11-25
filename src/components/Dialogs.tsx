import { useEffect, useRef, useState, type ReactNode } from "react";

export function Modal({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl bg-white text-neutral-900 shadow-2xl animate-rise dark:bg-ink-900 dark:text-neutral-100 dark:ring-1 dark:ring-white/10"
      >
        <h2 className="border-b border-maroon/10 px-6 py-4 text-lg font-semibold text-maroon dark:border-white/10 dark:text-coral">
          {title}
        </h2>
        <div className="px-6 py-5">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-maroon/10 px-6 py-4 dark:border-white/10">{footer}</div>
        )}
      </div>
    </div>
  );
}

export const btnGhost =
  "rounded-full px-5 py-2 text-sm font-medium text-neutral-600 transition hover:bg-maroon/10 dark:text-neutral-300 dark:hover:bg-white/10";
export const btnPrimary =
  "rounded-full bg-maroon px-5 py-2 text-sm font-semibold text-cream transition hover:bg-maroon-dark disabled:opacity-50 dark:bg-coral dark:text-night dark:hover:bg-[#ea8676]";
export const btnDanger =
  "rounded-full bg-brand-700 px-5 py-2 text-sm font-semibold text-white transition hover:bg-brand-800 disabled:opacity-50 dark:bg-brand-600 dark:hover:bg-brand-700";

/** Asks for a single line of text (create / rename). */
export function PromptDialog({
  title,
  label,
  initial = "",
  placeholder,
  confirmLabel = "บันทึก",
  selectStem = false,
  onSubmit,
  onClose,
}: {
  title: string;
  label: string;
  initial?: string;
  placeholder?: string;
  confirmLabel?: string;
  /** Pre-select only the part before ".pdf" */
  selectStem?: boolean;
  onSubmit: (value: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current!;
    el.focus();
    const dot = selectStem ? initial.toLowerCase().lastIndexOf(".pdf") : -1;
    el.setSelectionRange(0, dot > 0 ? dot : initial.length);
  }, [initial, selectStem]);

  const valid = value.trim().length > 0;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(value.trim());
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={btnGhost}>
            ยกเลิก
          </button>
          <button onClick={submit} disabled={!valid || busy} className={btnPrimary}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <label className="block">
        <span className="mb-1.5 block text-sm text-neutral-600 dark:text-neutral-400">{label}</span>
        <input
          ref={inputRef}
          value={value}
          placeholder={placeholder}
          maxLength={120}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-maroon focus:ring-2 focus:ring-maroon/15 dark:border-white/15 dark:bg-ink-800 dark:focus:border-coral dark:focus:ring-coral/20"
        />
      </label>
      {error && <p className="mt-2 text-xs text-brand-700 dark:text-brand-400">{error}</p>}
    </Modal>
  );
}

/** Yes/no confirmation for destructive actions. */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "ลบ",
  onConfirm,
  onClose,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className={btnGhost}>
            ยกเลิก
          </button>
          <button onClick={confirm} disabled={busy} className={btnDanger} autoFocus>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-neutral-700 dark:text-neutral-300">{message}</div>
      {error && <p className="mt-2 text-xs text-brand-700 dark:text-brand-400">{error}</p>}
    </Modal>
  );
}
