import { getCurrentWindow } from "@tauri-apps/api/window";
import { getSetting, setSetting } from "./db";
import { loadTheme } from "./theme";

const START_MAXIMIZED = "window.startMaximized";

export async function getStartMaximized(): Promise<boolean> {
  return (await getSetting(START_MAXIMIZED)) === "1";
}

export async function setStartMaximized(value: boolean) {
  await setSetting(START_MAXIMIZED, value ? "1" : "0");
}

/**
 * The window starts hidden (tauri.conf.json → visible: false) so we can apply
 * the saved size first and avoid a visible jump. Always shows the window,
 * even if reading the setting fails.
 */
export async function showMainWindow() {
  const win = getCurrentWindow();
  try {
    await loadTheme();
    if (await getStartMaximized()) await win.maximize();
  } catch (e) {
    console.error("Failed to apply window setting:", e);
  } finally {
    await win.show();
    await win.setFocus();
  }
}
