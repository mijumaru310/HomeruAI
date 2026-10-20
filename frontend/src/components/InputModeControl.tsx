"use client";

import { Hand, PenTool } from "lucide-react";
import type { CanvasInputMode } from "../utils/canvasInput";

export default function InputModeControl({ mode, notice, onChange }: {
  mode: CanvasInputMode | null;
  notice: string;
  onChange: (mode: CanvasInputMode) => void;
}) {
  return <section className="input-mode-control" aria-label="ノートの入力方法">
    <div className="input-mode-buttons" role="group" aria-label="入力モード">
      <button type="button" aria-pressed={mode === "finger"} onClick={() => onChange("finger")}><Hand size={17} />指で書く</button>
      <button type="button" aria-pressed={mode === "pen"} onClick={() => onChange("pen")}><PenTool size={17} />ペン専用</button>
    </div>
    <p aria-live="polite">{notice || (mode === "finger" ? "1本指で書く・消す／2本指で移動・拡大" : mode === "pen" ? "ペンで書く／指で移動・拡大。マウスも使えます" : "指・ペンで使う方は選択してください。マウスはそのまま書けます")}</p>
  </section>;
}
