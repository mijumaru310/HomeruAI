"use client";

import { useEffect, useState } from "react";
import { INPUT_MODE_STORAGE_KEY, parseInputMode, type CanvasInputMode } from "../utils/canvasInput";

export function useCanvasInputMode() {
  const [inputMode, setInputMode] = useState<CanvasInputMode | null>(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try { setInputMode(parseInputMode(localStorage.getItem(INPUT_MODE_STORAGE_KEY))); }
      catch { /* Private browsing/storage restrictions must not block drawing. */ }
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const changeInputMode = (mode: CanvasInputMode, fromPen = false) => {
    setInputMode(mode);
    let storageFailed = false;
    try { localStorage.setItem(INPUT_MODE_STORAGE_KEY, mode); }
    catch { storageFailed = true; }
    setNotice((fromPen ? "ペンを検出したため、誤描画を防ぐペン専用に切り替えました。" : "")
      + (storageFailed ? "設定を保存できないため、この画面でのみ適用します。" : ""));
  };
  return { inputMode, changeInputMode, notice, requestChoice: () => setNotice("指で書くか、ペンで書くかを選んでください。") };
}
