import { useMemo, useRef, useState, type CSSProperties } from "react";
import {
  arrowHead,
  bbox,
  cssFont,
  ellipsePts,
  hit,
  LINE_H,
  markupLine,
  pairs,
  resizable,
  resize,
  TEXT_PAD,
  textCanvas,
  translate,
  uid,
  type Annot,
  type BoxKind,
  type Picture,
  type Settings,
  type TextAnnot,
  type Tool,
} from "../lib/annotations";

/** What every page's layer needs from the viewer. */
export interface LayerCtl {
  tool: Tool;
  settings: Settings;
  scale: number;
  annots: Annot[];
  selectedId: string | null;
  editing: TextAnnot | null;
  pending: Picture | null;
  add: (a: Annot) => void;
  update: (a: Annot) => void;
  remove: (id: string) => void;
  select: (a: Annot | null) => void;
  startText: (a: TextAnnot) => void;
  editText: (text: string) => void;
  finishText: () => void;
  placePicture: (page: number, x: number, y: number) => void;
}

type Drag =
  | { mode: "create" | "move" | "resize"; x: number; y: number; orig: Annot }
  | { mode: "erase" };

const pts = (p: [number, number][]) => p.map((q) => q.join(",")).join(" ");

function TextImage({ a }: { a: TextAnnot }) {
  const href = useMemo(() => textCanvas(a, 3).toDataURL(), [a]);
  return <image href={href} x={a.x} y={a.y} width={a.w} height={a.h} opacity={a.opacity} preserveAspectRatio="none" />;
}

function Shape({ a }: { a: Annot }) {
  const so = { stroke: "stroke" in a ? a.stroke : undefined, strokeOpacity: a.opacity, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, fill: "none" };
  switch (a.kind) {
    case "rect":
      return <rect x={a.x} y={a.y} width={a.w} height={a.h} {...so} strokeWidth={a.width} fill={a.fill ?? "none"} fillOpacity={a.opacity} />;
    case "ellipse":
      return <polygon points={pts(ellipsePts(a))} {...so} strokeWidth={a.width} fill={a.fill ?? "none"} fillOpacity={a.opacity} />;
    case "highlight":
      return <rect x={a.x} y={a.y} width={a.w} height={a.h} fill={a.stroke} fillOpacity={a.opacity} />;
    case "underline":
    case "strike":
    case "squiggly": {
      const m = markupLine(a);
      return <polyline points={pts(m.pts)} {...so} strokeWidth={m.lw} />;
    }
    case "line":
      return <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} {...so} strokeWidth={a.width} />;
    case "arrow":
      return (
        <g {...so} strokeWidth={a.width}>
          <line x1={a.x1} y1={a.y1} x2={a.x2} y2={a.y2} />
          <polyline points={pts(arrowHead(a))} />
        </g>
      );
    case "path": {
      const p = pairs(a.points);
      return <polyline points={pts(p.length === 1 ? [p[0], p[0]] : p)} {...so} strokeWidth={a.width} />;
    }
    case "text":
      return <TextImage a={a} />;
    case "image":
      return <image href={a.src} x={a.x} y={a.y} width={a.w} height={a.h} opacity={a.opacity} preserveAspectRatio="none" />;
  }
}

/** Highlights and marker strokes multiply with the page so the text stays readable. */
const multiplies = (a: Annot) => a.kind === "highlight" || (a.kind === "path" && a.marker);

const CURSOR: Partial<Record<Tool, string>> = { select: "default", hand: "grab", text: "text", eraser: "cell", image: "copy" };

/** Annotations of one page, plus all the pointer interaction for drawing/editing them. */
export default function AnnotationLayer({ page, w, h, ctl }: { page: number; w: number; h: number; ctl: LayerCtl }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<Drag | null>(null);
  const liveRef = useRef<Annot | null>(null);
  const [live, setLiveState] = useState<Annot | null>(null);
  const setLive = (a: Annot | null) => ((liveRef.current = a), setLiveState(a));
  const { scale, tool, settings: s, editing } = ctl;

  const list = ctl.annots.filter((a) => a.page === page && a.id !== editing?.id);
  const shown = live ? (list.some((a) => a.id === live.id) ? list.map((a) => (a.id === live.id ? live : a)) : [...list, live]) : list;
  const selected = shown.find((a) => a.id === ctl.selectedId) ?? null;
  const tol = 5 / scale;

  const at = (e: React.PointerEvent | React.MouseEvent) => {
    const r = svgRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / scale, (e.clientY - r.top) / scale] as const;
  };
  const topHit = (x: number, y: number) => [...list].reverse().find((a) => hit(a, x, y, tol));
  const onHandle = (a: Annot, x: number, y: number) => {
    const b = bbox(a);
    return resizable(a) && Math.abs(x - b.x - b.w) <= 2 * tol && Math.abs(y - b.y - b.h) <= 2 * tol;
  };

  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection / focus change; we finish edits ourselves
    ctl.finishText();
    const [x, y] = at(e);
    const base = { id: uid(), page, opacity: s.opacity };

    if (tool === "text") {
      const t = topHit(x, y);
      ctl.startText(
        t?.kind === "text"
          ? t
          : { ...base, kind: "text", x, y: y - s.size * 0.75, w: 0, h: 0, text: "", font: s.font, size: s.size, bold: s.bold, italic: s.italic, underline: s.underline, strike: s.strike, color: s.color, align: s.align },
      );
      return;
    }
    if (tool === "image") return ctl.placePicture(page, x, y);

    svgRef.current!.setPointerCapture(e.pointerId);
    if (tool === "select") {
      if (selected && onHandle(selected, x, y)) {
        drag.current = { mode: "resize", x, y, orig: selected };
        return;
      }
      const t = topHit(x, y);
      ctl.select(t ?? null);
      if (t) drag.current = { mode: "move", x, y, orig: t };
      return;
    }
    if (tool === "eraser") {
      drag.current = { mode: "erase" };
      const t = topHit(x, y);
      if (t) ctl.remove(t.id);
      return;
    }

    let a: Annot;
    switch (tool) {
      case "pen":
        a = { ...base, kind: "path", points: [x, y], stroke: s.stroke, width: s.width, marker: false };
        break;
      case "marker":
        a = { ...base, kind: "path", points: [x, y], stroke: s.hlColor, width: 12, marker: true, opacity: 0.4 };
        break;
      case "line":
      case "arrow":
        a = { ...base, kind: tool, x1: x, y1: y, x2: x, y2: y, stroke: s.stroke, width: s.width };
        break;
      case "rect":
      case "ellipse":
        a = { ...base, kind: tool, x, y, w: 0, h: 0, stroke: s.stroke, fill: s.fill, width: s.width };
        break;
      default: // markup
        a = { ...base, kind: tool as BoxKind, x, y, w: 0, h: 0, stroke: s.hlColor, fill: null, width: 0, opacity: tool === "highlight" ? 0.4 : 1 };
    }
    drag.current = { mode: "create", x, y, orig: a };
    setLive(a);
  };

  const move = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const [x, y] = at(e);
    if (d.mode === "erase") {
      const t = topHit(x, y);
      if (t) ctl.remove(t.id);
      return;
    }
    const o = d.orig;
    if (d.mode === "move") return setLive(translate(o, x - d.x, y - d.y));
    if (d.mode === "resize") return setLive(resize(o as Parameters<typeof resize>[0], x - d.x, y - d.y));
    const cur = liveRef.current!;
    if (cur.kind === "path") {
      const p = cur.points;
      if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) * scale >= 2) setLive({ ...cur, points: [...p, x, y] });
    } else if (cur.kind === "line" || cur.kind === "arrow") {
      setLive({ ...cur, x2: x, y2: y });
    } else {
      setLive({ ...cur, x: Math.min(d.x, x), y: Math.min(d.y, y), w: Math.abs(x - d.x), h: Math.abs(y - d.y) } as Annot);
    }
  };

  const up = () => {
    const d = drag.current;
    const a = liveRef.current;
    drag.current = null;
    setLive(null);
    if (!d || d.mode === "erase" || !a) return;
    if (d.mode !== "create") return void (a !== d.orig && ctl.update(a));
    const b = bbox(a);
    const big = a.kind === "path" || Math.hypot(b.w, b.h) * scale >= 4;
    if (big) ctl.add(a);
  };

  const dbl = (e: React.MouseEvent) => {
    if (tool !== "select") return;
    const [x, y] = at(e);
    const t = topHit(x, y);
    if (t?.kind === "text") ctl.startText(t);
  };

  const sb = selected && bbox(selected);
  const svgBox = { viewBox: `0 0 ${w} ${h}`, className: "absolute inset-0 h-full w-full overflow-visible" };

  return (
    <div className="absolute inset-0" style={{ pointerEvents: tool === "hand" ? "none" : undefined }}>
      <svg {...svgBox} style={{ mixBlendMode: "multiply", pointerEvents: "none" }}>
        {shown.filter(multiplies).map((a) => <Shape key={a.id} a={a} />)}
      </svg>
      <svg
        ref={svgRef}
        {...svgBox}
        style={{ cursor: CURSOR[tool] ?? "crosshair", touchAction: "none" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onDoubleClick={dbl}
      >
        {shown.filter((a) => !multiplies(a)).map((a) => <Shape key={a.id} a={a} />)}
        {sb && (
          <g fill="none" stroke="#2563eb" strokeWidth={1 / scale} pointerEvents="none">
            <rect x={sb.x - 3 / scale} y={sb.y - 3 / scale} width={sb.w + 6 / scale} height={sb.h + 6 / scale} strokeDasharray={`${4 / scale} ${3 / scale}`} />
            {resizable(selected) && (
              <rect x={sb.x + sb.w - 4 / scale} y={sb.y + sb.h - 4 / scale} width={8 / scale} height={8 / scale} fill="#fff" />
            )}
          </g>
        )}
      </svg>
      {editing?.page === page && (
        <textarea
          key={editing.id}
          autoFocus
          value={editing.text}
          placeholder="พิมพ์ข้อความ"
          onChange={(e) => ctl.editText(e.target.value)}
          onBlur={ctl.finishText}
          onKeyDown={(e) => {
            if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) e.currentTarget.blur();
          }}
          className="absolute resize-none overflow-hidden whitespace-pre border-0 bg-white/60 outline outline-1 outline-dashed outline-blue-600"
          style={
            {
              left: editing.x * scale,
              top: editing.y * scale,
              padding: TEXT_PAD * scale,
              font: cssFont(editing, editing.size * scale),
              lineHeight: LINE_H,
              color: editing.color,
              textAlign: editing.align,
              textDecoration: [editing.underline && "underline", editing.strike && "line-through"].filter(Boolean).join(" ") || "none",
              fieldSizing: "content",
              minWidth: 24,
            } as CSSProperties
          }
        />
      )}
    </div>
  );
}
