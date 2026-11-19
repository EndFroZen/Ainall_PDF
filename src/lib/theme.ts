import { getCurrentWindow } from "@tauri-apps/api/window";
import { getSetting, setSetting } from "./db";

export type ThemePref = "system" | "light" | "dark";

const KEY = "ui.theme";
// Mirror of the DB value so the very first paint uses the right theme (DB is async).
const CACHE_KEY = "ainall.theme";
const media = window.matchMedia("(prefers-color-scheme: dark)");

let current: ThemePref = readCache();
const listeners = new Set<(dark: boolean) => void>();

function readCache(): ThemePref {
  try {
    const v = localStorage.getItem(CACHE_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch {
    /* storage unavailable */
  }
  return "system";
}

export function isDark(pref: ThemePref = current) {
  return pref === "dark" || (pref === "system" && media.matches);
}

function apply() {
  const dark = isDark();
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  // Native title bar follows the app (null = follow the OS)
  getCurrentWindow()
    .setTheme(current === "system" ? null : current)
    .catch(() => {});
  listeners.forEach((fn) => fn(dark));
}

media.addEventListener("change", () => current === "system" && apply());

/** Apply the cached theme synchronously — call before the first render. */
export function initTheme() {
  apply();
}

/** Load the saved preference from SQLite (source of truth) and apply it. */
export async function loadTheme() {
  const v = await getSetting(KEY);
  if (v === "light" || v === "dark" || v === "system") await setTheme(v, false);
}

export function getTheme() {
  return current;
}

export async function setTheme(pref: ThemePref, persist = true) {
  current = pref;
  try {
    localStorage.setItem(CACHE_KEY, pref);
  } catch {
    /* ignore */
  }
  apply();
  if (persist) await setSetting(KEY, pref);
}

export function onThemeChange(fn: (dark: boolean) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
