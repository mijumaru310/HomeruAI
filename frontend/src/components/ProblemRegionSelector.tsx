"use client";

import React, { useMemo, useRef, useState } from "react";
import { Crop, X } from "lucide-react";

export interface NormalizedRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  imageUrl: string;
  initialRegion?: NormalizedRegion;
  onApply: (region: NormalizedRegion | undefined) => void;
  onClose: () => void;
}

const clamp = (value: number) => Math.max(0, Math.min(1, value));

export default function ProblemRegionSelector({ imageUrl, initialRegion, onApply, onClose }: Props) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [start, setStart] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<NormalizedRegion | undefined>(initialRegion);

  const selectionStyle = useMemo<React.CSSProperties | undefined>(() => draft ? ({
    position: "absolute",
    left: `${draft.x * 100}%`,
    top: `${draft.y * 100}%`,
    width: `${draft.width * 100}%`,
    height: `${draft.height * 100}%`,
    border: "3px solid #7c3aed",
    background: "rgba(124, 58, 237, 0.12)",
    boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.38)",
    pointerEvents: "none",
  }) : undefined, [draft]);

  const pointFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = frameRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: clamp((event.clientX - rect.left) / rect.width),
      y: clamp((event.clientY - rect.top) / rect.height),
    };
  };

  return (
    <div role="dialog" aria-modal="true" aria-label="分析する問題範囲を選択" style={{
      position: "fixed", inset: 0, zIndex: 120, background: "rgba(15, 23, 42, 0.62)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: "24px",
    }}>
      <div style={{ width: "min(920px, 96vw)", maxHeight: "92vh", background: "white", borderRadius: "18px", padding: "18px", boxShadow: "0 24px 70px rgba(0,0,0,.35)", display: "flex", flexDirection: "column", gap: "14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
          <div>
            <strong style={{ display: "flex", alignItems: "center", gap: "7px", color: "#4c1d95" }}><Crop size={19} />分析する問題を囲む</strong>
            <p style={{ margin: "5px 0 0", color: "#64748b", fontSize: "13px" }}>画像をドラッグして、今回解く問題だけを選んでください。選択外はGeminiへ送りません。</p>
          </div>
          <button aria-label="閉じる" onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", color: "#475569" }}><X size={22} /></button>
        </div>

        <div
          ref={frameRef}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            const point = pointFromPointer(event);
            setStart(point);
            setDraft({ ...point, width: 0, height: 0 });
          }}
          onPointerMove={(event) => {
            if (!start) return;
            const point = pointFromPointer(event);
            setDraft({
              x: Math.min(start.x, point.x),
              y: Math.min(start.y, point.y),
              width: Math.abs(point.x - start.x),
              height: Math.abs(point.y - start.y),
            });
          }}
          onPointerUp={() => setStart(null)}
          style={{ position: "relative", alignSelf: "center", maxHeight: "68vh", maxWidth: "100%", lineHeight: 0, overflow: "hidden", borderRadius: "10px", border: "1px solid #cbd5e1", cursor: "crosshair", touchAction: "none", userSelect: "none" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="取り込んだ問題" draggable={false} style={{ display: "block", maxWidth: "100%", maxHeight: "68vh", objectFit: "contain" }} />
          {selectionStyle && <div style={selectionStyle} />}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: "10px", flexWrap: "wrap" }}>
          <button onClick={() => setDraft(undefined)} style={{ border: "1px solid #cbd5e1", background: "white", borderRadius: "9px", padding: "9px 13px", cursor: "pointer" }}>画像全体を使う</button>
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={onClose} style={{ border: "1px solid #cbd5e1", background: "white", borderRadius: "9px", padding: "9px 13px", cursor: "pointer" }}>キャンセル</button>
            <button
              onClick={() => onApply(draft && draft.width >= 0.03 && draft.height >= 0.03 ? draft : undefined)}
              style={{ border: "none", background: "#6d28d9", color: "white", borderRadius: "9px", padding: "9px 15px", cursor: "pointer", fontWeight: 700 }}
            >
              この範囲を分析する
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
