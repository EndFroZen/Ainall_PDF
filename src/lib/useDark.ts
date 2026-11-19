import { useEffect, useState } from "react";
import { isDark, onThemeChange } from "./theme";

/** True while the dark theme is active (follows the setting and the OS). */
export function useDark() {
  const [dark, setDark] = useState(isDark);
  useEffect(() => onThemeChange(setDark), []);
  return dark;
}
