// Copies pdf.js runtime data (fonts, CMaps, wasm decoders, ICC profiles) into
// public/pdfjs so the app can load them offline. Runs before `dev` and `build`.
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "node_modules", "pdfjs-dist");
const dest = join(root, "public", "pdfjs");

mkdirSync(dest, { recursive: true });
for (const dir of ["standard_fonts", "cmaps", "wasm", "iccs"]) {
  const from = join(src, dir);
  if (existsSync(from)) cpSync(from, join(dest, dir), { recursive: true });
  else console.warn(`[pdfjs-assets] missing ${from}`);
}
console.log("[pdfjs-assets] copied to public/pdfjs");
