import { useEffect, useRef, useState, type ReactNode } from "react";
import { getSetting, setSetting } from "../lib/db";
import {
  fileToPicture,
  fitPicture,
  STAMPS,
  textPicture,
  trimCanvas,
  type Annot,
  type Picture,
  type Settings,
  type Tool,
} from "../lib/annotations";
import { Modal, btnGhost, btnPrimary } from "./Dialogs";

const ICON: Record<string, string> = {
  select: "M5 3l14 8-6 2-2 6z",
  hand: "M8 13V5a1.5 1.5 0 0 1 3 0v6m0-1V4a1.5 1.5 0 0 1 3 0v7m0-.5V5.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 14a1.5 1.5 0 0 1 2.5-1.6L8 15",
  fitW: "M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4",
  fitP: "M5 3h14v18H5zM9 8h6M9 12h6M9 16h4",
  rotL: "M3 12a9 9 0 1 0 3-6.7M3 4v5h5",
  rotR: "M21 12a9 9 0 1 1-3-6.7M21 4v5h-5",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  highlight: "M9 11l-5 5v4h4l5-5M14 5l5 5-6 6-5-5z",
  underline: "M7 4v6a5 5 0 0 0 10 0V4M5 20h14",
  strike: "M4 12h16M16.5 7c-.5-1.8-2.2-3-4.5-3-2.8 0-4.5 1.5-4.5 3.5M7.5 17c.5 1.8 2.2 3 4.5 3 2.8 0 4.5-1.5 4.5-3.5",
  squiggly: "M7 4v5a5 5 0 0 0 10 0V4M3 19c1.5-2 3-2 4.5 0s3 2 4.5 0 3-2 4.5 0 3 2 4.5 0",
  pen: "M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z",
  marker: "M9 11l-6 6v3h6l3-3M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4",
  eraser: "M7 21h10M3.5 14.5l7-7a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L12 20H7.5z",
  rect: "M4 5h16v14H4z",
  ellipse: "M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z",
  line: "M5 19L19 5",
  arrow: "M5 19L19 5M10 5h9v9",
  sign: "M3 17c3-4 5-9 7-9s-1 9 1 9 3-4 4-4 1 3 2 3 2-1 3-2M3 21h18",
  undo: "M9 14L4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3",
  redo: "M15 14l5-5-5-5M20 9H9a5 5 0 0 0 0 10h3",
  copy: "M8 8h12v12H8zM4 16V4h12",
  front: "M4 4h10v10H4zM10 10h10v10H10z",
  back: "M10 10h10v10H10zM4 4h10v10H4z",
  trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
  alignL: "M4 6h16M4 10h10M4 14h16M4 18h10",
  alignC: "M4 6h16M7 10h10M4 14h16M7 18h10",
  alignR: "M4 6h16M10 10h10M4 14h16M10 18h10",
};

function Icon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d={ICON[name]} />
    </svg>
  );
}

const btn =
  "flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-neutral-600 transition hover:bg-neutral-100 hover:text-maroon disabled:opacity-30 disabled:hover:bg-transparent dark:text-neutral-300 dark:hover:bg-white/10 dark:hover:text-coral";
const on = "bg-maroon/10 text-maroon ring-1 ring-maroon/30 dark:bg-coral/15 dark:text-coral dark:ring-coral/40";
const inputCls =
  "rounded-md border border-neutral-200 bg-white px-2 py-1 text-xs text-neutral-800 outline-none focus:border-maroon dark:border-white/15 dark:bg-ink-800 dark:text-neutral-100 dark:focus:border-coral";

function Section({ title, open = false, children }: { title: string; open?: boolean; children: ReactNode }) {
  return (
    <details open={open} className="group border-b border-neutral-200 dark:border-white/10">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-neutral-500 select-none hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-100">
        <svg viewBox="0 0 24 24" className="h-3 w-3 transition group-open:rotate-90" fill="currentColor">
          <path d="M8 5l8 7-8 7z" />
        </svg>
        {title}
      </summary>
      <div className="space-y-2 px-3 pb-3">{children}</div>
    </details>
  );
}

const Row = ({ children }: { children: ReactNode }) => <div className="flex flex-wrap items-center gap-1">{children}</div>;
const Label = ({ children }: { children: ReactNode }) => (
  <span className="w-14 shrink-0 text-[11px] text-neutral-500 dark:text-neutral-400">{children}</span>
);

const PEN_COLORS = ["#111111", "#dc2626", "#2563eb", "#16a34a", "#ea580c", "#9333ea", "#ffffff"];
const HL_COLORS = ["#facc15", "#4ade80", "#38bdf8", "#f472b6", "#fb923c", "#dc2626"];

function Swatches({ colors, value, onChange }: { colors: string[]; value: string | null; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {colors.map((c) => (
        <button
          key={c}
          onClick={() => onChange(c)}
          aria-label={c}
          title={c}
          className={`h-5 w-5 rounded-full border border-black/15 ${value === c ? "ring-2 ring-maroon ring-offset-1 dark:ring-coral dark:ring-offset-ink-900" : ""}`}
          style={{ background: c }}
        />
      ))}
      <input
        type="color"
        value={value ?? "#000000"}
        onChange={(e) => onChange(e.target.value)}
        title="เลือกสีอื่น"
        className="h-5 w-6 cursor-pointer rounded border-0 bg-transparent p-0"
      />
    </div>
  );
}

const FONTS = ["Leelawadee UI", "Tahoma", "TH Sarabun New", "Angsana New", "Cordia New", "Arial", "Times New Roman", "Courier New"];

export interface PanelProps {
  tool: Tool;
  setTool: (t: Tool) => void;
  settings: Settings;
  change: (patch: Partial<Settings>) => void;
  selected: Annot | null;
  duplicate: () => void;
  remove: () => void;
  order: (front: boolean) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  count: number;
  fitWidth: () => void;
  fitPage: () => void;
  rotate: (delta: number) => void;
  pending: Picture | null;
  place: (p: Picture) => void;
}

const KIND_NAME: Record<Annot["kind"], string> = {
  rect: "สี่เหลี่ยม", ellipse: "วงรี", highlight: "ไฮไลต์", underline: "ขีดเส้นใต้", strike: "ขีดฆ่า",
  squiggly: "ขีดหยัก", line: "เส้น", arrow: "ลูกศร", path: "เส้นวาด", text: "ข้อความ", image: "รูปภาพ",
};

export default function ToolPanel(p: PanelProps) {
  const { tool, settings: s, change } = p;
  const [sigOpen, setSigOpen] = useState(false);
  const [sigs, setSigs] = useState<Picture[]>([]);

  useEffect(() => {
    getSetting("signatures")
      .then((v) => v && setSigs(JSON.parse(v)))
      .catch(() => {});
  }, []);
  const saveSigs = (next: Picture[]) => {
    setSigs(next);
    void setSetting("signatures", JSON.stringify(next)).catch(() => {});
  };

  const T = (t: Tool, label: string) => (
    <button onClick={() => p.setTool(t)} aria-pressed={tool === t} className={`${btn} ${tool === t ? on : ""}`} title={label}>
      <Icon name={t} />
      {label}
    </button>
  );
  const Toggle = (k: "bold" | "italic" | "underline" | "strike", label: string, cls: string) => (
    <button onClick={() => change({ [k]: !s[k] })} aria-pressed={s[k]} className={`${btn} w-7 justify-center ${cls} ${s[k] ? on : ""}`}>
      {label}
    </button>
  );

  return (
    <aside
      aria-label="เครื่องมือ"
      className="flex w-72 shrink-0 flex-col border-l border-neutral-200 bg-white xl:w-80 dark:border-white/10 dark:bg-ink-900"
    >
      <div className="flex h-11 shrink-0 items-center border-b border-neutral-200 px-4 dark:border-white/10">
        <h2 className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">เครื่องมือ</h2>
      </div>

      {p.selected && (
        <div className="shrink-0 border-b border-neutral-200 bg-blue-50/60 px-3 py-2 dark:border-white/10 dark:bg-blue-400/5">
          <p className="mb-1 text-[11px] font-semibold text-blue-700 dark:text-blue-300">เลือก: {KIND_NAME[p.selected.kind]}</p>
          <Row>
            <button className={btn} onClick={p.duplicate} title="ทำสำเนา"><Icon name="copy" />สำเนา</button>
            <button className={btn} onClick={() => p.order(true)} title="ไว้หน้าสุด"><Icon name="front" />หน้าสุด</button>
            <button className={btn} onClick={() => p.order(false)} title="ไว้หลังสุด"><Icon name="back" />หลังสุด</button>
            <button className={`${btn} hover:text-brand-700`} onClick={p.remove} title="ลบ (Delete)"><Icon name="trash" />ลบ</button>
          </Row>
        </div>
      )}

      {tool === "image" && p.pending && (
        <div className="shrink-0 border-b border-neutral-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-white/10 dark:bg-amber-400/10 dark:text-amber-300">
          คลิกบนหน้าเอกสารเพื่อวาง · Esc เพื่อยกเลิก
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="เลือก / มุมมอง" open>
          <Row>
            {T("select", "เลือก")}
            {T("hand", "เลื่อน")}
          </Row>
          <Row>
            <button className={btn} onClick={p.fitWidth}><Icon name="fitW" />พอดีความกว้าง</button>
            <button className={btn} onClick={p.fitPage}><Icon name="fitP" />พอดีหน้า</button>
          </Row>
          <Row>
            <button className={btn} onClick={() => p.rotate(-90)} title="หมุนหน้าปัจจุบันทวนเข็ม"><Icon name="rotL" />หมุนซ้าย</button>
            <button className={btn} onClick={() => p.rotate(90)} title="หมุนหน้าปัจจุบันตามเข็ม"><Icon name="rotR" />หมุนขวา</button>
          </Row>
        </Section>

        <Section title="ข้อความ">
          <Row>
            {T("text", "เพิ่มข้อความ")}
          </Row>
          <Row>
            <Label>ฟอนต์</Label>
            <select value={s.font} onChange={(e) => change({ font: e.target.value })} className={`${inputCls} min-w-0 flex-1`}>
              {FONTS.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
            </select>
          </Row>
          <Row>
            <Label>ขนาด</Label>
            <input
              type="number" min={4} max={200} value={s.size}
              onChange={(e) => +e.target.value >= 4 && change({ size: +e.target.value })}
              className={`${inputCls} w-16`}
            />
            {Toggle("bold", "B", "font-bold")}
            {Toggle("italic", "I", "italic")}
            {Toggle("underline", "U", "underline")}
            {Toggle("strike", "S", "line-through")}
          </Row>
          <Row>
            <Label>จัดวาง</Label>
            {(["left", "center", "right"] as const).map((a) => (
              <button key={a} onClick={() => change({ align: a })} aria-pressed={s.align === a} className={`${btn} ${s.align === a ? on : ""}`}>
                <Icon name={a === "left" ? "alignL" : a === "center" ? "alignC" : "alignR"} />
              </button>
            ))}
          </Row>
          <Row>
            <Label>สี</Label>
            <Swatches colors={PEN_COLORS} value={s.color} onChange={(color) => change({ color })} />
          </Row>
        </Section>

        <Section title="ไฮไลต์ / มาร์กอัป">
          <div className="grid grid-cols-2 gap-1">
            {T("highlight", "ไฮไลต์")}
            {T("underline", "ขีดเส้นใต้")}
            {T("strike", "ขีดฆ่า")}
            {T("squiggly", "ขีดหยัก")}
          </div>
          <Row>
            <Label>สี</Label>
            <Swatches colors={HL_COLORS} value={s.hlColor} onChange={(hlColor) => change({ hlColor })} />
          </Row>
        </Section>

        <Section title="วาด / รูปทรง">
          <div className="grid grid-cols-3 gap-1">
            {T("pen", "ปากกา")}
            {T("marker", "มาร์กเกอร์")}
            {T("eraser", "ยางลบ")}
            {T("rect", "สี่เหลี่ยม")}
            {T("ellipse", "วงรี")}
            {T("line", "เส้น")}
            {T("arrow", "ลูกศร")}
          </div>
          <Row>
            <Label>เส้น</Label>
            <Swatches colors={PEN_COLORS} value={s.stroke} onChange={(stroke) => change({ stroke })} />
          </Row>
          <Row>
            <Label>เติม</Label>
            <button onClick={() => change({ fill: null })} className={`${btn} ${s.fill === null ? on : ""}`}>ไม่เติม</button>
            <Swatches colors={["#ffffff", "#fef08a", "#bfdbfe", "#fecaca"]} value={s.fill} onChange={(fill) => change({ fill })} />
          </Row>
          <Row>
            <Label>ความหนา</Label>
            <input type="range" min={0.5} max={20} step={0.5} value={s.width} onChange={(e) => change({ width: +e.target.value })} className="min-w-0 flex-1 accent-maroon dark:accent-coral" />
            <span className="w-10 text-right text-[11px] tabular-nums text-neutral-500">{s.width}pt</span>
          </Row>
          <Row>
            <Label>ความทึบ</Label>
            <input type="range" min={0.1} max={1} step={0.05} value={s.opacity} onChange={(e) => change({ opacity: +e.target.value })} className="min-w-0 flex-1 accent-maroon dark:accent-coral" />
            <span className="w-10 text-right text-[11px] tabular-nums text-neutral-500">{Math.round(s.opacity * 100)}%</span>
          </Row>
        </Section>

        <Section title="ลายเซ็น / ตราประทับ" open>
          <button className={btn} onClick={() => setSigOpen(true)}><Icon name="sign" />สร้างลายเซ็น</button>
          {sigs.length > 0 && (
            <div className="grid grid-cols-2 gap-1.5">
              {sigs.map((g, i) => (
                <div key={i} className="group relative">
                  <button
                    onClick={() => p.place(g)}
                    title="คลิกแล้ววางบนหน้า"
                    className={`flex h-14 w-full items-center justify-center rounded-md border bg-white p-1 transition hover:border-maroon dark:hover:border-coral ${p.pending?.src === g.src && tool === "image" ? "border-maroon dark:border-coral" : "border-neutral-200 dark:border-white/15"}`}
                  >
                    <img src={g.src} alt="ลายเซ็น" className="max-h-full max-w-full" />
                  </button>
                  <button
                    onClick={() => saveSigs(sigs.filter((_, j) => j !== i))}
                    aria-label="ลบลายเซ็น"
                    className="absolute -top-1.5 -right-1.5 hidden h-5 w-5 items-center justify-center rounded-full bg-neutral-800 text-[10px] text-white group-hover:flex"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
          <p className="pt-1 text-[11px] text-neutral-500 dark:text-neutral-400">ตราประทับ</p>
          <div className="flex flex-wrap gap-1">
            {STAMPS.map((st) => (
              <button
                key={st.label}
                onClick={() => p.place(textPicture(st.label, `bold 22px "Leelawadee UI", Tahoma, sans-serif`, st.color, true))}
                className="rounded border-2 px-1.5 py-0.5 text-[11px] font-bold transition hover:opacity-70"
                style={{ color: st.color, borderColor: st.color }}
              >
                {st.label}
              </button>
            ))}
          </div>
        </Section>
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t border-neutral-200 px-3 py-2 dark:border-white/10">
        <button className={btn} onClick={p.undo} disabled={!p.canUndo} title="เลิกทำ (Ctrl+Z)"><Icon name="undo" />เลิกทำ</button>
        <button className={btn} onClick={p.redo} disabled={!p.canRedo} title="ทำซ้ำ (Ctrl+Y)"><Icon name="redo" />ทำซ้ำ</button>
        {p.count > 0 && (
          <span className="ml-auto text-[11px] text-neutral-500 dark:text-neutral-400" title="จะถูกบันทึกลงไฟล์เมื่อกดบันทึก">
            {p.count} รายการ
          </span>
        )}
      </div>

      {sigOpen && (
        <SignatureDialog
          onClose={() => setSigOpen(false)}
          onCreate={(g) => {
            setSigOpen(false);
            saveSigs([...sigs, g]);
            p.place(g);
          }}
        />
      )}
    </aside>
  );
}

const SIG_FONTS = ["Segoe Script", "Brush Script MT", "Leelawadee UI"];
const SIG_COLORS = ["#111111", "#1d4ed8", "#b91c1c"];

function SignatureDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (p: Picture) => void }) {
  const [mode, setMode] = useState<"draw" | "type" | "upload">("draw");
  const [color, setColor] = useState(SIG_COLORS[0]);
  const [name, setName] = useState("");
  const [font, setFont] = useState(SIG_FONTS[0]);
  const [upload, setUpload] = useState<Picture | null>(null);
  const [drawn, setDrawn] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const K = 2; // canvas pixels per CSS px

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    c.width = c.clientWidth * K;
    c.height = c.clientHeight * K;
    setDrawn(false);
  }, [mode]);

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget;
    const ctx = c.getContext("2d")!;
    const r = c.getBoundingClientRect();
    const p = (ev: PointerEvent | React.PointerEvent) => [(ev.clientX - r.left) * K, (ev.clientY - r.top) * K] as const;
    c.setPointerCapture(e.pointerId);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5 * K;
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(...p(e));
    ctx.lineTo(...p(e));
    ctx.stroke();
    const move = (ev: PointerEvent) => {
      ctx.lineTo(...p(ev));
      ctx.stroke();
    };
    const up = () => {
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", up);
    };
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", up);
    setDrawn(true);
  };

  const result = (): Picture | null => {
    if (mode === "draw") {
      const t = canvas.current && trimCanvas(canvas.current, K * 1.6); // ~1.6 CSS px drawn per pt placed
      return t && fitPicture(t);
    }
    if (mode === "type") return name.trim() ? fitPicture(textPicture(name.trim(), `36px "${font}", "Leelawadee UI", cursive`, color)) : null;
    return upload && fitPicture(upload);
  };
  const ready = mode === "draw" ? drawn : mode === "type" ? !!name.trim() : !!upload;

  const tab = (m: typeof mode, label: string) => (
    <button
      onClick={() => setMode(m)}
      className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition ${mode === m ? "bg-maroon text-cream dark:bg-coral dark:text-night" : "text-neutral-600 hover:bg-maroon/10 dark:text-neutral-300 dark:hover:bg-white/10"}`}
    >
      {label}
    </button>
  );

  return (
    <Modal
      title="สร้างลายเซ็น"
      onClose={onClose}
      footer={
        <>
          <button className={btnGhost} onClick={onClose}>ยกเลิก</button>
          <button
            className={btnPrimary}
            disabled={!ready}
            onClick={() => {
              const r = result();
              if (r) onCreate(r);
            }}
          >
            ใช้ลายเซ็นนี้
          </button>
        </>
      }
    >
      <div className="mb-4 flex gap-1 rounded-full bg-white/60 p-1 dark:bg-white/5">
        {tab("draw", "วาด")}
        {tab("type", "พิมพ์")}
        {tab("upload", "อัปโหลด")}
      </div>

      {mode !== "upload" && (
        <div className="mb-3 flex items-center gap-2 text-xs text-neutral-500">
          สีหมึก
          {SIG_COLORS.map((c) => (
            <button
              key={c}
              onClick={() => setColor(c)}
              aria-label={c}
              className={`h-5 w-5 rounded-full ${color === c ? "ring-2 ring-maroon ring-offset-2 dark:ring-coral dark:ring-offset-ink-900" : ""}`}
              style={{ background: c }}
            />
          ))}
        </div>
      )}

      {mode === "draw" && (
        <div>
          <canvas
            ref={canvas}
            onPointerDown={draw}
            className="h-40 w-full cursor-crosshair touch-none rounded-xl border border-dashed border-neutral-300 bg-white dark:border-white/20"
          />
          <div className="mt-1 flex justify-between text-xs text-neutral-500">
            <span>วาดลายเซ็นในกรอบ</span>
            <button
              onClick={() => {
                const c = canvas.current!;
                c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
                setDrawn(false);
              }}
              className="hover:text-maroon dark:hover:text-coral"
            >
              ล้าง
            </button>
          </div>
        </div>
      )}

      {mode === "type" && (
        <div className="space-y-2">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="พิมพ์ชื่อ"
            className="w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-maroon dark:border-white/15 dark:bg-ink-800 dark:focus:border-coral"
          />
          <div className="space-y-1">
            {SIG_FONTS.map((f) => (
              <button
                key={f}
                onClick={() => setFont(f)}
                className={`block w-full truncate rounded-lg border bg-white px-3 py-2 text-left text-2xl dark:bg-ink-800 ${font === f ? "border-maroon dark:border-coral" : "border-neutral-200 dark:border-white/10"}`}
                style={{ fontFamily: `"${f}", cursive`, color }}
              >
                {name || "ลายเซ็น"}
              </button>
            ))}
          </div>
        </div>
      )}

      {mode === "upload" && (
        <label className="flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-neutral-300 bg-white text-sm text-neutral-500 dark:border-white/20 dark:bg-ink-800">
          {upload ? <img src={upload.src} alt="" className="max-h-28 max-w-full" /> : "เลือกไฟล์รูป (PNG / JPG)"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setUpload(await fileToPicture(f));
            }}
          />
        </label>
      )}
    </Modal>
  );
}
