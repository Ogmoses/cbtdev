"use client";

import { useEffect, useRef, useState } from "react";
import { X, RotateCcw, RotateCw, FlipHorizontal, ZoomIn, Loader2, Check } from "lucide-react";

/**
 * Photo editor shown right after someone picks an image, before it's used.
 *
 *  - shape="circle": the logo mode. A fixed round frame; drag and pinch/zoom
 *    the photo underneath, like choosing a WhatsApp profile picture. Only
 *    what's inside the circle is kept, saved as a square PNG whose corners are
 *    transparent — so it looks round everywhere it's shown (screens, PDFs).
 *  - shape="rect": for diagrams. A fixed frame with a choice of shape
 *    (original, square, 4:3, 3:4, 16:9); drag and zoom to pick the part to keep.
 *
 * Both can rotate and flip. No library: the pan / pinch / zoom, and the final
 * crop, are plain pointer events and a <canvas>.
 */

export type CropShape = "circle" | "rect";

const RECT_ASPECTS: { key: string; label: string; value: number | null }[] = [
  { key: "original", label: "Original", value: null },
  { key: "1:1", label: "Square", value: 1 },
  { key: "4:3", label: "4:3", value: 4 / 3 },
  { key: "3:4", label: "3:4", value: 3 / 4 },
  { key: "16:9", label: "16:9", value: 16 / 9 },
];

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

interface Props {
  file: File;
  shape: CropShape;
  title?: string;
  /** Longest side of the saved image, in pixels (never upscaled beyond the original's detail). */
  maxOutput?: number;
  /** Lock the frame to this width/height ratio (e.g. 4/5 for a passport photo): no shape picker, and the result is always a JPEG. */
  fixedAspect?: number;
  onCancel: () => void;
  onDone: (file: File) => void;
}

export default function ImageCropModal({ file, shape, title, maxOutput, fixedAspect, onCancel, onDone }: Props) {
  const outputLimit = maxOutput ?? (shape === "circle" ? 512 : 1600);

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [rotation, setRotation] = useState(0); // 0 / 90 / 180 / 270
  const [flip, setFlip] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [aspectKey, setAspectKey] = useState("original");
  const [stageW, setStageW] = useState(320);
  const [saving, setSaving] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startX: number; startY: number; startOffset: { x: number; y: number }; startDist: number; startZoom: number } | null>(null);

  // Load the chosen file.
  useEffect(() => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => setImg(image);
    image.onerror = () => setLoadError(true);
    image.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // Track the stage's width so the frame fits any screen.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => setStageW(el.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ---- geometry -----------------------------------------------------------
  const natW = img?.naturalWidth ?? 1;
  const natH = img?.naturalHeight ?? 1;
  const turned = rotation % 180 !== 0;
  const w = turned ? natH : natW; // size after rotating
  const h = turned ? natW : natH;

  const aspect = shape === "circle" ? 1 : (fixedAspect ?? RECT_ASPECTS.find((a) => a.key === aspectKey)?.value ?? w / h);
  let frameW = Math.min(stageW - 24, 360);
  let frameH = frameW / aspect;
  if (frameH > 330) {
    frameH = 330;
    frameW = frameH * aspect;
  }
  const cover = Math.max(frameW / w, frameH / h); // scale at which the photo exactly fills the frame
  const scale = cover * zoom;
  const maxX = Math.max(0, (w * scale - frameW) / 2);
  const maxY = Math.max(0, (h * scale - frameH) / 2);
  const off = { x: clamp(offset.x, -maxX, maxX), y: clamp(offset.y, -maxY, maxY) };

  const imgStyle: React.CSSProperties = {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: natW,
    height: natH,
    maxWidth: "none",
    transformOrigin: "0 0",
    transform: `translate(${off.x}px, ${off.y}px) scale(${scale}) rotate(${rotation}deg) scaleX(${flip ? -1 : 1}) translate(${-natW / 2}px, ${-natH / 2}px)`,
    userSelect: "none",
    pointerEvents: "none",
  };

  // ---- gestures: drag to move, pinch / wheel / slider to zoom --------------
  const dist = () => {
    const [a, b] = Array.from(pointers.current.values());
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const beginGesture = (startX: number, startY: number) => {
    gesture.current = { startX, startY, startOffset: off, startDist: pointers.current.size === 2 ? dist() : 0, startZoom: zoom };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    beginGesture(e.clientX, e.clientY);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && gesture.current.startDist > 0) {
      setZoom(clamp(gesture.current.startZoom * (dist() / gesture.current.startDist), MIN_ZOOM, MAX_ZOOM));
    } else if (pointers.current.size === 1) {
      setOffset({ x: gesture.current.startOffset.x + (e.clientX - gesture.current.startX), y: gesture.current.startOffset.y + (e.clientY - gesture.current.startY) });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const rest = Array.from(pointers.current.values())[0];
    if (rest) beginGesture(rest.x, rest.y); // one finger left: carry on panning from here, no jump
    else gesture.current = null;
  };
  const onWheel = (e: React.WheelEvent) => setZoom((z) => clamp(z - e.deltaY * 0.0015, MIN_ZOOM, MAX_ZOOM));

  const rotate = (dir: 1 | -1) => {
    setRotation((r) => (r + dir * 90 + 360) % 360);
    setOffset({ x: 0, y: 0 });
  };
  const reset = () => {
    setRotation(0);
    setFlip(false);
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  };

  // ---- save ---------------------------------------------------------------
  const save = async () => {
    if (!img) return;
    setSaving(true);
    try {
      // Output size: capped, and never larger than the photo's real detail inside the frame.
      const detailW = Math.max(64, Math.round(frameW / scale));
      let outW: number;
      let outH: number;
      if (aspect >= 1) {
        outW = Math.min(outputLimit, detailW);
        outH = Math.round(outW / aspect);
      } else {
        outH = Math.min(outputLimit, Math.max(64, Math.round(frameH / scale)));
        outW = Math.round(outH * aspect);
      }
      const k = outW / frameW;

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas");
      ctx.imageSmoothingQuality = "high";

      const asPng = shape === "circle" || (!fixedAspect && file.type === "image/png");
      if (shape === "circle") {
        ctx.beginPath();
        ctx.arc(outW / 2, outH / 2, outW / 2, 0, Math.PI * 2);
        ctx.closePath();
        ctx.clip(); // outside the circle stays transparent
      } else if (!asPng) {
        ctx.fillStyle = "#ffffff"; // JPEG has no transparency
        ctx.fillRect(0, 0, outW, outH);
      }

      // Same transform order as the on-screen preview.
      ctx.translate(outW / 2 + off.x * k, outH / 2 + off.y * k);
      ctx.scale(scale * k, scale * k);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.scale(flip ? -1 : 1, 1);
      ctx.drawImage(img, -natW / 2, -natH / 2);

      const type = asPng ? "image/png" : "image/jpeg";
      const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
      if (!blob) throw new Error("export failed");
      const base = file.name.replace(/\.[^.]+$/, "") || "image";
      onDone(new File([blob], `${base}.${asPng ? "png" : "jpg"}`, { type }));
    } catch {
      setSaving(false);
      setLoadError(true);
    }
  };

  const btn = "flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 active:bg-white/25";

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/70 sm:items-center" onClick={saving ? undefined : onCancel}>
      <div className="flex max-h-[96vh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-[#17181B] text-white shadow-card-hover sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3">
          <h3 className="font-display text-[15px] font-semibold">{title ?? (shape === "circle" ? "Crop your logo" : "Edit photo")}</h3>
          <button type="button" onClick={onCancel} disabled={saving} aria-label="Close" className="text-white/60 hover:text-white">
            <X size={19} />
          </button>
        </div>

        {loadError ? (
          <div className="px-6 py-14 text-center text-[13.5px] text-white/70">
            We couldn't open that image. Try a different photo.
            <button type="button" onClick={onCancel} className="mt-5 block w-full rounded-lg bg-white/10 py-2.5 font-medium text-white">
              Close
            </button>
          </div>
        ) : (
          <>
            <div
              ref={stageRef}
              className="relative h-[372px] w-full touch-none select-none overflow-hidden bg-black"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onWheel={onWheel}
              style={{ cursor: "grab" }}
            >
              {img ? (
                <>
                  {/* the rest of the photo, dimmed, so you can see what you're leaving out */}
                  <div className="absolute inset-0 overflow-hidden opacity-35">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.src} alt="" draggable={false} style={imgStyle} />
                  </div>
                  {/* the part that's kept */}
                  <div
                    className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden ring-2 ring-white/80 ${shape === "circle" ? "rounded-full" : "rounded-sm"}`}
                    style={{ width: frameW, height: frameH }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.src} alt="" draggable={false} style={imgStyle} />
                  </div>
                </>
              ) : (
                <div className="flex h-full items-center justify-center text-white/50">
                  <Loader2 className="animate-spin" size={22} />
                </div>
              )}
            </div>

            <div className="space-y-3.5 px-4 pb-4 pt-3.5">
              <div className="flex items-center gap-3">
                <ZoomIn size={17} className="shrink-0 text-white/60" />
                <input
                  type="range"
                  min={MIN_ZOOM}
                  max={MAX_ZOOM}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  aria-label="Zoom"
                  className="h-1.5 w-full cursor-pointer accent-white"
                />
              </div>

              <div className="flex items-center justify-center gap-3">
                <button type="button" onClick={() => rotate(-1)} className={btn} aria-label="Rotate left">
                  <RotateCcw size={17} />
                </button>
                <button type="button" onClick={() => rotate(1)} className={btn} aria-label="Rotate right">
                  <RotateCw size={17} />
                </button>
                <button type="button" onClick={() => setFlip((f) => !f)} className={btn} aria-label="Flip">
                  <FlipHorizontal size={17} />
                </button>
                <button type="button" onClick={reset} className="rounded-full bg-white/10 px-3.5 py-2.5 text-[12px] font-medium text-white hover:bg-white/20">
                  Reset
                </button>
              </div>

              {shape === "rect" && !fixedAspect && (
                <div className="flex flex-wrap justify-center gap-1.5">
                  {RECT_ASPECTS.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      onClick={() => {
                        setAspectKey(a.key);
                        setOffset({ x: 0, y: 0 });
                      }}
                      className={`rounded-full px-3 py-1.5 text-[12px] font-medium ${aspectKey === a.key ? "bg-white text-black" : "bg-white/10 text-white/80 hover:bg-white/20"}`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}

              <p className="text-center text-[11.5px] text-white/45">{shape === "circle" ? "Drag to move, pinch or use the slider to zoom. Only the circle is kept." : "Drag to move, pinch or use the slider to zoom. Only the framed part is kept."}</p>

              <div className="flex gap-2.5">
                <button type="button" onClick={onCancel} disabled={saving} className="flex-1 rounded-lg bg-white/10 py-2.5 text-[13.5px] font-medium text-white hover:bg-white/15 disabled:opacity-50">
                  Cancel
                </button>
                <button type="button" onClick={save} disabled={!img || saving} className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-white py-2.5 text-[13.5px] font-semibold text-black disabled:opacity-60">
                  {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                  {saving ? "Saving…" : "Use photo"}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
