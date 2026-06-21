"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { getStroke } from "perfect-freehand";
import { Stroke, CanvasImage, CanvasText, AIAnnotation } from "../types/canvas";

interface CanvasProps {
  strokes: Stroke[];
  setStrokes: React.Dispatch<React.SetStateAction<Stroke[]>>;
  images: CanvasImage[];
  setImages: React.Dispatch<React.SetStateAction<CanvasImage[]>>;
  texts: CanvasText[];
  setTexts: React.Dispatch<React.SetStateAction<CanvasText[]>>;
  aiAnnotations?: AIAnnotation[];

  tool: "pen" | "eraser" | "select" | "text" | "lasso";
  eraserMode: "stroke" | "pixel";
  brushColor: string;
  brushWidth: number;
  eraserWidth: number;

  textStyle: {
    fontSize: number;
    color: string;
    fontWeight: "normal" | "bold";
    fontStyle: "normal" | "italic";
    textDecoration: "none" | "underline";
  };

  isReplaying: boolean;
  initialPan: { x: number; y: number };
  initialZoom: number;
  onTransformChange?: (pan: { x: number; y: number }, zoom: number) => void;
}

/** レイの投射法による多角形内判定 */
const isPointInPolygon = (
  point: { x: number; y: number },
  polygon: { x: number; y: number }[]
): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > point.y) !== (yj > point.y)) &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
};

export default function Canvas({
  strokes, setStrokes,
  images, setImages,
  texts, setTexts,
  aiAnnotations,
  tool, eraserMode,
  brushColor, brushWidth, eraserWidth,
  textStyle,
  isReplaying, initialPan, initialZoom, onTransformChange,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // ── Pan / Zoom (ref 管理) ──────────────────────────────────────────────────
  const panRef = useRef({ x: initialPan.x, y: initialPan.y });
  const zoomRef = useRef(initialZoom);
  const prevInitialPanRef = useRef(initialPan);
  const prevInitialZoomRef = useRef(initialZoom);
  if (
    initialPan.x !== prevInitialPanRef.current.x ||
    initialPan.y !== prevInitialPanRef.current.y ||
    initialZoom !== prevInitialZoomRef.current
  ) {
    panRef.current = { x: initialPan.x, y: initialPan.y };
    zoomRef.current = initialZoom;
    prevInitialPanRef.current = initialPan;
    prevInitialZoomRef.current = initialZoom;
  }

  // ── 描画中ストローク ────────────────────────────────────────────────────────
  const currentStrokeRef = useRef<Stroke | null>(null);
  const isDrawingRef = useRef(false);
  const pointerPosRef = useRef<{ x: number; y: number } | null>(null);

  // ── Props キャッシュ (ref) ─────────────────────────────────────────────────
  const toolRef = useRef(tool); toolRef.current = tool;
  const brushColorRef = useRef(brushColor); brushColorRef.current = brushColor;
  const brushWidthRef = useRef(brushWidth); brushWidthRef.current = brushWidth;
  const eraserModeRef = useRef(eraserMode); eraserModeRef.current = eraserMode;
  const eraserWidthRef = useRef(eraserWidth); eraserWidthRef.current = eraserWidth;
  const isReplayingRef = useRef(isReplaying); isReplayingRef.current = isReplaying;
  const strokesRef = useRef(strokes); strokesRef.current = strokes;
  const imagesRef = useRef(images); imagesRef.current = images;
  const textsRef = useRef(texts); textsRef.current = texts;
  const textStyleRef = useRef(textStyle); textStyleRef.current = textStyle;
  const aiAnnotationsRef = useRef(aiAnnotations || []); aiAnnotationsRef.current = aiAnnotations || [];

  // ── 画像キャッシュ ─────────────────────────────────────────────────────────
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());

  // ── テキスト入力オーバーレイ ───────────────────────────────────────────────
  // NOTE: position は containerRef に対する絶対座標 (rect.left/top を含まない)
  const [textInput, setTextInput] = useState<{
    id: string | null;
    text: string;
    worldX: number; // ワールド座標
    worldY: number;
  } | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);

  // ── 選択 / ドラッグ ────────────────────────────────────────────────────────
  const lassoPointsRef = useRef<{ x: number; y: number }[]>([]);
  const selectedIdsRef = useRef<{
    strokes: string[];
    images: string[];
    texts: string[];
  }>({ strokes: [], images: [], texts: [] });

  // ドラッグは「描画中はオフセットのみ更新」し、Up 時に state に commit する
  const isDraggingSelectionRef = useRef(false);
  const dragStartWorldRef = useRef<{ x: number; y: number } | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  type TransformMode = "translate" | "resize-nw" | "resize-ne" | "resize-sw" | "resize-se" | "rotate" | null;
  const transformModeRef = useRef<TransformMode>(null);
  const transformInitialRef = useRef<{ x: number; y: number; w: number; h: number; r: number; cx: number; cy: number; } | null>(null);
  const transformCurrentRef = useRef<{ x: number; y: number; w: number; h: number; r: number; } | null>(null);

  const rotatePoint = (px: number, py: number, cx: number, cy: number, angle: number) => {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return { x: cos * (px - cx) - sin * (py - cy) + cx, y: sin * (px - cx) + cos * (py - cy) + cy };
  };

  // ── タッチ / パン ──────────────────────────────────────────────────────────
  const activePointersRef = useRef<Map<number, { clientX: number; clientY: number }>>(new Map());
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number | null>(null);
  const isPanningRef = useRef(false);
  const lastPanPosRef = useRef<{ x: number; y: number } | null>(null);
  const spacePressedRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);

  // ── 座標変換 ───────────────────────────────────────────────────────────────
  const screenToWorld = (sx: number, sy: number, rect: DOMRect) => ({
    x: (sx - rect.left - panRef.current.x) / zoomRef.current,
    y: (sy - rect.top - panRef.current.y) / zoomRef.current,
  });

  /** コンテナ内の絶対座標 (CSS left/top に使う値) */
  const worldToContainer = (wx: number, wy: number) => ({
    x: wx * zoomRef.current + panRef.current.x,
    y: wy * zoomRef.current + panRef.current.y,
  });

  // ── 画像プリロード ─────────────────────────────────────────────────────────
  useEffect(() => {
    images.forEach(img => {
      if (!imageCacheRef.current.has(img.id)) {
        const el = new Image();
        el.src = img.url;
        el.onload = () => { imageCacheRef.current.set(img.id, el); requestDraw(); };
      }
    });
  }, [images]);

  // ── 描画メイン ─────────────────────────────────────────────────────────────
  const drawImmediate = () => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pan = panRef.current;
    const zoom = zoomRef.current;
    const curTool = toolRef.current;
    const offset = dragOffsetRef.current;

    ctx.clearRect(0, 0, dimensions.width, dimensions.height);

    // ── グリッド ────────────────────────────────────────────────────────────
    {
      const gs = 50;
      const l = -pan.x / zoom, t = -pan.y / zoom;
      const r = (dimensions.width - pan.x) / zoom;
      const b = (dimensions.height - pan.y) / zoom;
      ctx.save();
      ctx.setTransform(zoom, 0, 0, zoom, pan.x, pan.y);
      ctx.strokeStyle = "rgba(0,0,0,0.05)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.floor(l / gs) * gs; x <= r; x += gs) { ctx.moveTo(x, t); ctx.lineTo(x, b); }
      for (let y = Math.floor(t / gs) * gs; y <= b; y += gs) { ctx.moveTo(l, y); ctx.lineTo(r, y); }
      ctx.stroke();
      ctx.restore();
    }

    // ── 画像 ────────────────────────────────────────────────────────────────
    ctx.save();
    ctx.setTransform(zoom, 0, 0, zoom, pan.x, pan.y);
    imagesRef.current.forEach(img => {
      const el = imageCacheRef.current.get(img.id);
      const isSel = selectedIdsRef.current.images.includes(img.id);
      const isSoloTransforming = selectedIdsRef.current.images.length === 1 && selectedIdsRef.current.strokes.length === 0 && selectedIdsRef.current.texts.length === 0;
      const isTransforming = isSel && isSoloTransforming && transformModeRef.current !== null && transformModeRef.current !== "translate";
      const isTranslating = isSel && (transformModeRef.current === "translate" || (!transformModeRef.current && isDraggingSelectionRef.current));

      let x = img.x, y = img.y, w = img.width, h = img.height, r = img.rotation || 0;

      if (isTranslating) {
        x += offset.x; y += offset.y;
      } else if (isTransforming && transformCurrentRef.current) {
        x = transformCurrentRef.current.x; y = transformCurrentRef.current.y;
        w = transformCurrentRef.current.w; h = transformCurrentRef.current.h;
        r = transformCurrentRef.current.r;
      }

      const cx = x + w / 2;
      const cy = y + h / 2;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(r);

      if (el) ctx.drawImage(el, -w / 2, -h / 2, w, h);

      if (isSel) {
        ctx.strokeStyle = "#5c2d91";
        ctx.lineWidth = 2 / zoom;
        ctx.strokeRect(-w / 2, -h / 2, w, h);

        if (isSoloTransforming && curTool === "select") {
          ctx.fillStyle = "#ffffff";
          const hs = 8 / zoom;
          ctx.strokeRect(-w / 2 - hs / 2, -h / 2 - hs / 2, hs, hs); ctx.fillRect(-w / 2 - hs / 2, -h / 2 - hs / 2, hs, hs);
          ctx.strokeRect(w / 2 - hs / 2, -h / 2 - hs / 2, hs, hs); ctx.fillRect(w / 2 - hs / 2, -h / 2 - hs / 2, hs, hs);
          ctx.strokeRect(-w / 2 - hs / 2, h / 2 - hs / 2, hs, hs); ctx.fillRect(-w / 2 - hs / 2, h / 2 - hs / 2, hs, hs);
          ctx.strokeRect(w / 2 - hs / 2, h / 2 - hs / 2, hs, hs); ctx.fillRect(w / 2 - hs / 2, h / 2 - hs / 2, hs, hs);

          ctx.beginPath(); ctx.moveTo(0, -h / 2); ctx.lineTo(0, -h / 2 - 20 / zoom); ctx.stroke();
          ctx.beginPath(); ctx.arc(0, -h / 2 - 20 / zoom, hs / 2, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
      }
      ctx.restore();
    });
    ctx.restore();

    // ── ストローク (オフスクリーン経由で pixel-erase を正しく処理) ──────────
    const off = document.createElement("canvas");
    off.width = dimensions.width;
    off.height = dimensions.height;
    const offCtx = off.getContext("2d");
    if (offCtx) {
      offCtx.setTransform(zoom, 0, 0, zoom, pan.x, pan.y);

      const renderStroke = (stroke: Stroke, isCurrentStroke = false) => {
        // erase / pixel-erase タイプは描画しない (stroke eraser は state 側で isErased フラグ)
        if (stroke.type === "erase" || stroke.type === "pixel-erase") {
          // pixel-erase のみ destination-out で描く
          if (stroke.type === "pixel-erase") {
            const pts = stroke.points.map(p => [p.x, p.y, p.p] as [number, number, number]);
            const outline = getStroke(pts, { size: stroke.width || 30, thinning: 0, smoothing: 0.5, streamline: 0.5 });
            if (outline.length === 0) return;
            offCtx.globalCompositeOperation = "destination-out";
            offCtx.fillStyle = "rgba(0,0,0,1)";
            offCtx.beginPath();
            offCtx.moveTo(outline[0][0], outline[0][1]);
            for (let i = 1; i < outline.length; i++) offCtx.lineTo(outline[i][0], outline[i][1]);
            offCtx.closePath();
            offCtx.fill();
            offCtx.globalCompositeOperation = "source-over";
          }
          return;
        }
        if (stroke.isErased) return;

        const isSel = !isCurrentStroke && selectedIdsRef.current.strokes.includes(stroke.strokeId);
        const dx = isSel ? offset.x : 0;
        const dy = isSel ? offset.y : 0;
        const pts = stroke.points.map(p => [p.x + dx, p.y + dy, p.p] as [number, number, number]);
        const outline = getStroke(pts, { size: stroke.width || 4, thinning: 0.5, smoothing: 0.5, streamline: 0.5 });
        if (outline.length === 0) return;

        offCtx.globalCompositeOperation = "source-over";
        offCtx.fillStyle = stroke.color || "#000000";
        offCtx.beginPath();
        offCtx.moveTo(outline[0][0], outline[0][1]);
        for (let i = 1; i < outline.length; i++) offCtx.lineTo(outline[i][0], outline[i][1]);
        offCtx.closePath();
        offCtx.fill();

        if (isSel) {
          offCtx.strokeStyle = "rgba(92,45,145,0.45)";
          offCtx.lineWidth = (stroke.width || 4) + 6 / zoom;
          offCtx.beginPath();
          offCtx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) offCtx.lineTo(pts[i][0], pts[i][1]);
          offCtx.stroke();
        }
      };

      strokesRef.current.forEach(s => renderStroke(s));
      // 描画中の仮ストローク — ペンのみ (erase 系は renderStroke 内で処理済み)
      if (currentStrokeRef.current) renderStroke(currentStrokeRef.current, true);
    }
    ctx.drawImage(off, 0, 0);

    // ── テキスト ────────────────────────────────────────────────────────────
    ctx.save();
    ctx.setTransform(zoom, 0, 0, zoom, pan.x, pan.y);
    textsRef.current.forEach(txt => {
      if (textInput?.id === txt.id) return; // 編集中は HTML textarea が表示する
      const isSel = selectedIdsRef.current.texts.includes(txt.id);
      const dx = isSel ? offset.x : 0;
      const dy = isSel ? offset.y : 0;
      const tx = txt.x + dx, ty = txt.y + dy;
      ctx.font = `${txt.fontStyle} ${txt.fontWeight} ${txt.fontSize}px sans-serif`;
      ctx.fillStyle = txt.color;
      ctx.textBaseline = "top";
      const lines = txt.text.split("\n");
      const lineH = txt.fontSize * 1.2;
      lines.forEach((line, i) => ctx.fillText(line, tx, ty + i * lineH));
      if (txt.textDecoration === "underline") {
        ctx.strokeStyle = txt.color;
        ctx.lineWidth = Math.max(1, txt.fontSize * 0.05);
        lines.forEach((line, i) => {
          const w = ctx.measureText(line).width;
          const ly = ty + i * lineH + txt.fontSize;
          ctx.beginPath(); ctx.moveTo(tx, ly); ctx.lineTo(tx + w, ly); ctx.stroke();
        });
      }
      if (isSel) {
        ctx.strokeStyle = "#5c2d91";
        ctx.lineWidth = 1.5 / zoom;
        let mw = 0;
        lines.forEach(l => { mw = Math.max(mw, ctx.measureText(l).width); });
        ctx.strokeRect(tx - 2, ty - 2, mw + 4, lines.length * lineH + 4);
      }
    });

    // ── AIアノテーション（画像相対座標から動的に描画） ─────────────────────
    const annotations = aiAnnotationsRef.current;
    if (annotations.length > 0) {
      annotations.forEach(ann => {
        // 紐づく画像を検索
        const img = imagesRef.current.find(im => im.id === ann.imageId);
        if (!img) return;

        // 画像の現在のワールド座標を取得（選択移動中も考慮）
        const isSel = selectedIdsRef.current.images.includes(img.id);
        const imgX = img.x + (isSel ? offset.x : 0);
        const imgY = img.y + (isSel ? offset.y : 0);
        const imgW = img.width;
        const imgH = img.height;

        // 0-1000 スケールの box_2d → ワールド座標に変換
        const [ymin, xmin, ymax, xmax] = ann.box_2d;
        const x1 = imgX + (xmin / 1000) * imgW;
        const y1 = imgY + (ymin / 1000) * imgH;
        const x2 = imgX + (xmax / 1000) * imgW;
        const y2 = imgY + (ymax / 1000) * imgH;

        const color = ann.color || (ann.type === "circle" ? "#107c41" : "#e81123");

        if (ann.type === "circle") {
          // ○マーク（先生風の手書き感のある楕円）
          const cx = (x1 + x2) / 2;
          const cy = (y1 + y2) / 2;
          
          // ボックスの幅と高さを取得
          let width = Math.abs(x2 - x1);
          let height = Math.abs(y2 - y1);
          
          // 【追加】細長すぎる丸を防ぐための補正（最低でもきれいな楕円を保つ）
          const size = Math.max(width, height, 40); // 最低でも40pxの大きさ
          const rx = size / 2 + 10; // 少し大きめに囲む
          const ry = size / 2 + 10;

          ctx.beginPath();
          ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
          ctx.strokeStyle = color; // "#107c41" (Green)
          ctx.lineWidth = 4 / zoom; // 少し太くして見栄えを良くする
          ctx.stroke();

          // コメント（○の右上に表示）
          if (ann.comment) {
            const fontSize = Math.max(14, Math.min(20, imgH * 0.03)); // フォントも少し大きめ
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.fillStyle = color;
            ctx.textBaseline = "bottom";
            ctx.fillText(ann.comment, cx + rx, cy - ry + 10); // 丸の右上に配置
          }
        }else if (ann.type === "underline") {
          // 赤い波線下線
          const lineY = y2 + 2;
          ctx.beginPath();
          const segments = 12;
          for (let j = 0; j <= segments; j++) {
            const px = x1 + (x2 - x1) * (j / segments);
            const py = lineY + (j % 2 === 0 ? 3 : -3) / zoom;
            if (j === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.5 / zoom;
          ctx.stroke();

          // ヒントコメント（下線の右下に表示）
          if (ann.comment) {
            const fontSize = Math.max(11, Math.min(16, imgH * 0.022));
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.fillStyle = color;
            ctx.textBaseline = "top";
            ctx.fillText(ann.comment, x1, lineY + 6 / zoom);
          }
        } else if (ann.type === "text") {
          // 先生の赤ペン書き入れ
          if (ann.comment) {
            const fontSize = Math.max(12, Math.min(20, imgH * 0.028));
            ctx.font = `bold ${fontSize}px sans-serif`;
            ctx.fillStyle = color;
            ctx.textBaseline = "top";
            // テキストを複数行対応
            const lines = ann.comment.split("\n");
            const lineH = fontSize * 1.3;
            lines.forEach((line, li) => {
              ctx.fillText(line, x1, y1 + li * lineH);
            });
          }
        }
      });
    }

    // ── 投げ縄パス ─────────────────────────────────────────────────────────
    const lp = lassoPointsRef.current;
    if (curTool === "lasso" && lp.length > 1) {
      ctx.strokeStyle = "rgba(92,45,145,0.8)";
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([5 / zoom, 4 / zoom]);
      ctx.beginPath();
      ctx.moveTo(lp[0].x, lp[0].y);
      for (let i = 1; i < lp.length; i++) ctx.lineTo(lp[i].x, lp[i].y);
      if (!isDrawingRef.current) { ctx.closePath(); }
      ctx.stroke();
      ctx.setLineDash([]);
      if (!isDrawingRef.current) {
        ctx.fillStyle = "rgba(92,45,145,0.08)";
        ctx.fill();
      }
    }
    ctx.restore();

    // ── 消しゴムカーソル ────────────────────────────────────────────────────
    const cp = pointerPosRef.current;
    if (curTool === "eraser" && cp && !isReplayingRef.current && !isPanningRef.current) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cp.x, cp.y, eraserWidthRef.current / 2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(239,68,68,0.1)";
      ctx.strokeStyle = "rgba(239,68,68,0.8)";
      ctx.lineWidth = 1.5;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  };

  const requestDraw = () => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => {
      rafIdRef.current = null;
      drawImmediate();
    });
  };

  // ── ResizeObserver ─────────────────────────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => { requestDraw(); }, [dimensions, strokes, images, texts, tool, textInput]);

  // ── キーボード ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") { spacePressedRef.current = true; return; }
      if (e.code === "Escape") {
        commitTextInput(false);
        clearSelection();
        requestDraw();
        return;
      }
      if ((e.code === "Delete" || e.code === "Backspace") && !textInput) {
        const sel = selectedIdsRef.current;
        if (sel.strokes.length || sel.images.length || sel.texts.length) {
          setStrokes(prev => prev.map(s => sel.strokes.includes(s.strokeId) ? { ...s, isErased: true } : s));
          setImages(prev => prev.filter(img => !sel.images.includes(img.id)));
          setTexts(prev => prev.filter(txt => !sel.texts.includes(txt.id)));
          clearSelection();
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => { if (e.code === "Space") spacePressedRef.current = false; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); };
  });

  // ── ホイールズーム ─────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const prevZ = zoomRef.current;
      const nextZ = Math.max(0.1, Math.min(10, prevZ * (1 - e.deltaY * 0.001)));
      const mwx = (e.clientX - rect.left - panRef.current.x) / prevZ;
      const mwy = (e.clientY - rect.top - panRef.current.y) / prevZ;
      panRef.current = { x: e.clientX - rect.left - mwx * nextZ, y: e.clientY - rect.top - mwy * nextZ };
      zoomRef.current = nextZ;
      requestDraw();
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [dimensions]);

  // ── helpers ────────────────────────────────────────────────────────────────
  const clearSelection = () => {
    selectedIdsRef.current = { strokes: [], images: [], texts: [] };
    lassoPointsRef.current = [];
    dragOffsetRef.current = { x: 0, y: 0 };
    isDraggingSelectionRef.current = false;
    dragStartWorldRef.current = null;
    transformModeRef.current = null;
    transformInitialRef.current = null;
    transformCurrentRef.current = null;
  };

  /** テキスト入力を確定 / 破棄 */
  const commitTextInput = useCallback((save: boolean) => {
    setTextInput(prev => {
      if (!prev) return null;
      if (save && prev.text.trim().length > 0) {
        const style = textStyleRef.current;
        if (prev.id) {
          setTexts(ts => ts.map(t => t.id === prev.id ? { ...t, text: prev.text, ...style } : t));
        } else {
          setTexts(ts => [...ts, {
            id: `txt_${Date.now()}`,
            text: prev.text,
            x: prev.worldX, y: prev.worldY,
            ...style,
          }]);
        }
      }
      return null;
    });
  }, [setTexts]);

  const performObjectErasing = (worldPos: { x: number; y: number }, activeEraser: Stroke) => {
    const threshold = (eraserWidthRef.current / 2) / zoomRef.current + 8;
    const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    setStrokes(prev => prev.map(s => {
      if (s.type !== "draw" || s.isErased) return s;
      if (s.points.some(pt => dist2(worldPos, pt) < threshold)) {
        if (activeEraser.targetStrokeIds && !activeEraser.targetStrokeIds.includes(s.strokeId)) {
          activeEraser.targetStrokeIds.push(s.strokeId);
        }
        return { ...s, isErased: true, erasedAt: Date.now() };
      }
      return s;
    }));
  };

  // ── Pointer Down ──────────────────────────────────────────────────────────
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isReplayingRef.current) return;
    const canvas = canvasRef.current;
    if (canvas) canvas.setPointerCapture(e.pointerId);
    const rect = canvas?.getBoundingClientRect() ?? new DOMRect();
    const sx = e.clientX, sy = e.clientY;
    const wp = screenToWorld(sx, sy, rect);

    // ── タッチ ─────────────────────────────────────────────────────────────
    if (e.pointerType === "touch") {
      activePointersRef.current.set(e.pointerId, { clientX: sx, clientY: sy });
      if (activePointersRef.current.size === 1) {
        isPanningRef.current = true;
        lastPanPosRef.current = { x: sx, y: sy };
      } else if (activePointersRef.current.size === 2) {
        isPanningRef.current = false;
        const pts = Array.from(activePointersRef.current.values());
        pinchStartDistRef.current = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
        pinchStartZoomRef.current = zoomRef.current;
      }
      return;
    }

    // ── PC パン (右クリック or スペース) ──────────────────────────────────
    if (e.pointerType === "mouse" && (e.button === 2 || spacePressedRef.current)) {
      isPanningRef.current = true;
      lastPanPosRef.current = { x: sx, y: sy };
      e.preventDefault();
      return;
    }

    // ── 選択 / 投げ縄 ─────────────────────────────────────────────────────
    if (toolRef.current === "select" || toolRef.current === "lasso") {
      // テキスト入力中なら先に確定
      if (textInput) { commitTextInput(true); }

      let hitSomething = false;
      const isSoloTransforming = selectedIdsRef.current.images.length === 1 && selectedIdsRef.current.strokes.length === 0 && selectedIdsRef.current.texts.length === 0;

      // 画像ヒットテスト (変形ハンドル優先)
      if (isSoloTransforming && toolRef.current === "select") {
        const imgId = selectedIdsRef.current.images[0];
        const img = imagesRef.current.find(i => i.id === imgId);
        if (img) {
          const w = img.width, h = img.height;
          const cx = img.x + w / 2, cy = img.y + h / 2;
          const r = img.rotation || 0;
          const rotatedWP = rotatePoint(wp.x, wp.y, cx, cy, -r);
          const lx = rotatedWP.x - cx;
          const ly = rotatedWP.y - cy;
          const hs = 16 / zoomRef.current; // ヒット判定サイズ(少し広め)

          let hitMode: TransformMode = null;
          if (Math.hypot(lx, ly - (-h / 2 - 20 / zoomRef.current)) <= hs) hitMode = "rotate";
          else if (Math.abs(lx - (-w / 2)) <= hs && Math.abs(ly - (-h / 2)) <= hs) hitMode = "resize-nw";
          else if (Math.abs(lx - (w / 2)) <= hs && Math.abs(ly - (-h / 2)) <= hs) hitMode = "resize-ne";
          else if (Math.abs(lx - (-w / 2)) <= hs && Math.abs(ly - (h / 2)) <= hs) hitMode = "resize-sw";
          else if (Math.abs(lx - (w / 2)) <= hs && Math.abs(ly - (h / 2)) <= hs) hitMode = "resize-se";
          else if (lx >= -w / 2 && lx <= w / 2 && ly >= -h / 2 && ly <= h / 2) hitMode = "translate";

          if (hitMode) {
            transformModeRef.current = hitMode;
            transformInitialRef.current = { x: img.x, y: img.y, w: img.width, h: img.height, r: img.rotation || 0, cx, cy };
            transformCurrentRef.current = { ...transformInitialRef.current };
            isDraggingSelectionRef.current = true;
            dragStartWorldRef.current = wp;
            dragOffsetRef.current = { x: 0, y: 0 };
            requestDraw();
            return;
          }
        }
      }

      // 画像ヒットテスト (通常)
      if (!hitSomething) {
        for (const img of imagesRef.current) {
          const cx = img.x + img.width / 2;
          const cy = img.y + img.height / 2;
          const r = img.rotation || 0;
          const rotatedWP = rotatePoint(wp.x, wp.y, cx, cy, -r);
          const lx = rotatedWP.x - cx;
          const ly = rotatedWP.y - cy;
          if (lx >= -img.width / 2 && lx <= img.width / 2 && ly >= -img.height / 2 && ly <= img.height / 2) {
            if (toolRef.current === "select" && !selectedIdsRef.current.images.includes(img.id)) {
              selectedIdsRef.current = { strokes: [], images: [img.id], texts: [] };
            }
            hitSomething = true;
            break;
          }
        }
      }

      // テキストヒットテスト
      if (!hitSomething) {
        const tmpCtx = canvasRef.current?.getContext("2d");
        for (const txt of textsRef.current) {
          if (tmpCtx) tmpCtx.font = `${txt.fontStyle} ${txt.fontWeight} ${txt.fontSize}px sans-serif`;
          const lines = txt.text.split("\n");
          let mw = 0;
          lines.forEach(l => { mw = Math.max(mw, tmpCtx?.measureText(l).width ?? 100); });
          const th = lines.length * txt.fontSize * 1.2;
          if (wp.x >= txt.x && wp.x <= txt.x + mw && wp.y >= txt.y && wp.y <= txt.y + th) {
            if (toolRef.current === "select" && !selectedIdsRef.current.texts.includes(txt.id)) {
              selectedIdsRef.current = { strokes: [], images: [], texts: [txt.id] };
            }
            hitSomething = true;
            // ダブルクリックで編集
            if (toolRef.current === "select" && e.detail >= 2) {
              setTextInput({ id: txt.id, text: txt.text, worldX: txt.x, worldY: txt.y });
              return;
            }
            break;
          }
        }
      }

      const hasSel = selectedIdsRef.current.strokes.length > 0 ||
        selectedIdsRef.current.images.length > 0 ||
        selectedIdsRef.current.texts.length > 0;

      if (hitSomething) {
        isDraggingSelectionRef.current = true;
        dragStartWorldRef.current = wp;
        dragOffsetRef.current = { x: 0, y: 0 };
      } else if (toolRef.current === "lasso") {
        isDrawingRef.current = true;
        lassoPointsRef.current = [wp];
        if (hasSel) clearSelection(); // 投げ縄で新しく囲む時は以前の選択を解除
      } else {
        clearSelection();
      }
      requestDraw();
      return;
    }

    // ── テキストツール ────────────────────────────────────────────────────
    if (toolRef.current === "text") {
      commitTextInput(true);
      // 既存テキストのヒットテスト
      const tmpCtx = canvasRef.current?.getContext("2d");
      let found = false;
      for (const txt of textsRef.current) {
        if (tmpCtx) tmpCtx.font = `${txt.fontStyle} ${txt.fontWeight} ${txt.fontSize}px sans-serif`;
        const lines = txt.text.split("\n");
        let mw = 0;
        lines.forEach(l => { mw = Math.max(mw, tmpCtx?.measureText(l).width ?? 100); });
        const th = lines.length * txt.fontSize * 1.2;
        if (wp.x >= txt.x && wp.x <= txt.x + mw && wp.y >= txt.y && wp.y <= txt.y + th) {
          setTextInput({ id: txt.id, text: txt.text, worldX: txt.x, worldY: txt.y });
          found = true;
          break;
        }
      }
      if (!found) {
        setTextInput({ id: null, text: "", worldX: wp.x, worldY: wp.y });
      }
      return;
    }

    // ── ペン / 消しゴム ───────────────────────────────────────────────────
    if (e.button === 0) {
      commitTextInput(true);
      isDrawingRef.current = true;
      const pressure = e.pointerType === "pen" ? e.pressure : 0.5;
      const now = Date.now();
      let strokeType: "draw" | "erase" | "pixel-erase" = "draw";
      if (toolRef.current === "eraser") {
        strokeType = eraserModeRef.current === "pixel" ? "pixel-erase" : "erase";
      }
      const newStroke: Stroke = {
        strokeId: `${strokeType[0]}_${now}_${Math.random().toString(36).substr(2, 9)}`,
        type: strokeType,
        startTime: now,
        endTime: now,
        points: [{ x: wp.x, y: wp.y, p: pressure, t: 0 }],
        color: strokeType === "draw" ? brushColorRef.current : undefined,
        width: strokeType === "draw" ? brushWidthRef.current : eraserWidthRef.current,
        targetStrokeIds: strokeType === "erase" ? [] : undefined,
      };
      currentStrokeRef.current = newStroke;
      pointerPosRef.current = { x: sx - rect.left, y: sy - rect.top };
      if (strokeType === "erase") performObjectErasing(wp, newStroke);
      drawImmediate();
    }
  };

  // ── Pointer Move ──────────────────────────────────────────────────────────
  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const wp = screenToWorld(sx, sy, rect);

    pointerPosRef.current = { x: sx - rect.left, y: sy - rect.top };

    // タッチ
    if (e.pointerType === "touch" && activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { clientX: sx, clientY: sy });
      const ptList = Array.from(activePointersRef.current.values());
      if (ptList.length === 1 && isPanningRef.current && lastPanPosRef.current) {
        const dx = sx - lastPanPosRef.current.x, dy = sy - lastPanPosRef.current.y;
        panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
        lastPanPosRef.current = { x: sx, y: sy };
        requestDraw();
      } else if (ptList.length === 2 && pinchStartDistRef.current && pinchStartZoomRef.current !== null) {
        const cd = Math.hypot(ptList[0].clientX - ptList[1].clientX, ptList[0].clientY - ptList[1].clientY);
        const nz = Math.max(0.1, Math.min(10, pinchStartZoomRef.current * (cd / pinchStartDistRef.current)));
        const midX = (ptList[0].clientX + ptList[1].clientX) / 2;
        const midY = (ptList[0].clientY + ptList[1].clientY) / 2;
        const prevZ = zoomRef.current;
        const mwx = (midX - rect.left - panRef.current.x) / prevZ;
        const mwy = (midY - rect.top - panRef.current.y) / prevZ;
        panRef.current = { x: midX - rect.left - mwx * nz, y: midY - rect.top - mwy * nz };
        zoomRef.current = nz;
        requestDraw();
      }
      return;
    }

    // パン
    if (isPanningRef.current && lastPanPosRef.current) {
      const dx = sx - lastPanPosRef.current.x, dy = sy - lastPanPosRef.current.y;
      panRef.current = { x: panRef.current.x + dx, y: panRef.current.y + dy };
      lastPanPosRef.current = { x: sx, y: sy };
      requestDraw();
      return;
    }

    // ドラッグ選択移動・変形 (state は変えない → Up で commit)
    if (isDraggingSelectionRef.current && dragStartWorldRef.current) {
      if (transformModeRef.current && transformModeRef.current !== "translate" && transformInitialRef.current) {
        const initial = transformInitialRef.current;
        if (transformModeRef.current === "rotate") {
          const angle = Math.atan2(wp.y - initial.cy, wp.x - initial.cx);
          transformCurrentRef.current = { ...initial, r: angle + Math.PI / 2 };
        } else {
          // Resize
          const localStart = rotatePoint(dragStartWorldRef.current.x, dragStartWorldRef.current.y, initial.cx, initial.cy, -initial.r);
          const localCurrent = rotatePoint(wp.x, wp.y, initial.cx, initial.cy, -initial.r);
          const dx = localCurrent.x - localStart.x;
          const dy = localCurrent.y - localStart.y;

          const ux = initial.cx - initial.w / 2;
          const uy = initial.cy - initial.h / 2;
          let nuw = initial.w, nuh = initial.h, nux = ux, nuy = uy;

          if (transformModeRef.current === "resize-se") { nuw += dx; nuh += dy; }
          else if (transformModeRef.current === "resize-nw") { nuw -= dx; nuh -= dy; nux += dx; nuy += dy; }
          else if (transformModeRef.current === "resize-ne") { nuw += dx; nuh -= dy; nuy += dy; }
          else if (transformModeRef.current === "resize-sw") { nuw -= dx; nuh += dy; nux += dx; }
          
          if (nuw < 20) { nux -= (20 - nuw) * (nux > ux ? 1 : 0); nuw = 20; }
          if (nuh < 20) { nuy -= (20 - nuh) * (nuy > uy ? 1 : 0); nuh = 20; }

          const ncx = nux + nuw / 2;
          const ncy = nuy + nuh / 2;
          const ncw = rotatePoint(ncx, ncy, initial.cx, initial.cy, initial.r);

          transformCurrentRef.current = { ...initial, x: ncw.x - nuw / 2, y: ncw.y - nuh / 2, w: nuw, h: nuh };
        }
        drawImmediate();
        return;
      } else {
        dragOffsetRef.current = {
          x: wp.x - dragStartWorldRef.current.x,
          y: wp.y - dragStartWorldRef.current.y,
        };
        drawImmediate();
        return;
      }
    }

    // 投げ縄描画中
    if (toolRef.current === "lasso" && isDrawingRef.current) {
      lassoPointsRef.current.push(wp);
      drawImmediate();
      return;
    }

    // ペン / 消しゴム描画中
    if (!isDrawingRef.current || !currentStrokeRef.current || isReplayingRef.current) {
      if (toolRef.current === "eraser") requestDraw(); // カーソル更新のみ
      return;
    }
    const pressure = e.pointerType === "pen" ? e.pressure : 0.5;
    const elapsed = Date.now() - currentStrokeRef.current.startTime;
    currentStrokeRef.current.points.push({ x: wp.x, y: wp.y, p: pressure, t: elapsed });
    if (currentStrokeRef.current.type === "erase") performObjectErasing(wp, currentStrokeRef.current);
    drawImmediate();
  };

  // ── Pointer Up ────────────────────────────────────────────────────────────
  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas) canvas.releasePointerCapture(e.pointerId);

    if (e.pointerType === "touch") {
      activePointersRef.current.delete(e.pointerId);
      if (activePointersRef.current.size < 2) { pinchStartDistRef.current = null; pinchStartZoomRef.current = null; }
      if (activePointersRef.current.size === 0) {
        isPanningRef.current = false; lastPanPosRef.current = null;
        onTransformChange?.(panRef.current, zoomRef.current);
      }
      return;
    }

    if (isPanningRef.current) {
      isPanningRef.current = false; lastPanPosRef.current = null;
      onTransformChange?.(panRef.current, zoomRef.current);
      return;
    }

    // ── ドラッグ・変形選択 commit ──────────────────────────────────────────
    if (isDraggingSelectionRef.current) {
      if (transformModeRef.current && transformModeRef.current !== "translate" && transformCurrentRef.current) {
        const cur = transformCurrentRef.current;
        const imgId = selectedIdsRef.current.images[0];
        setImages(prev => prev.map(img => 
          img.id === imgId ? { ...img, x: cur.x, y: cur.y, width: cur.w, height: cur.h, rotation: cur.r } : img
        ));
        
        // 変形完了後も選択は維持する
        isDraggingSelectionRef.current = false;
        dragOffsetRef.current = { x: 0, y: 0 };
        dragStartWorldRef.current = null;
        transformModeRef.current = null;
        transformInitialRef.current = null;
        transformCurrentRef.current = null;
        requestDraw();
        return;
      }

      const dx = dragOffsetRef.current.x;
      const dy = dragOffsetRef.current.y;
      const now = Date.now();
      const sel = { ...selectedIdsRef.current }; // snapshot

      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
        // ストロークを「移動前を消去・移動後を追加」でタイムラプスに記録
        if (sel.strokes.length > 0) {
          setStrokes(prev => {
            const next: Stroke[] = [];
            const added: Stroke[] = [];
            for (const s of prev) {
              if (sel.strokes.includes(s.strokeId)) {
                // 元のストロークを消去扱い
                next.push({ ...s, isErased: true, erasedAt: now });
                // 移動後ストロークを新規追加
                added.push({
                  ...s,
                  strokeId: `s_${now}_${Math.random().toString(36).substr(2, 6)}`,
                  startTime: now,
                  endTime: now,
                  isErased: false,
                  erasedAt: undefined,
                  points: s.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy, t: 0 })),
                });
              } else {
                next.push(s);
              }
            }
            return [...next, ...added];
          });
        }
        if (sel.images.length > 0) {
          setImages(prev => prev.map(img =>
            sel.images.includes(img.id) ? { ...img, x: img.x + dx, y: img.y + dy } : img
          ));
        }
        if (sel.texts.length > 0) {
          setTexts(prev => prev.map(txt =>
            sel.texts.includes(txt.id) ? { ...txt, x: txt.x + dx, y: txt.y + dy } : txt
          ));
        }
      }

      // ドラッグ状態を解除するが、選択は維持する
      isDraggingSelectionRef.current = false;
      dragOffsetRef.current = { x: 0, y: 0 };
      dragStartWorldRef.current = null;
      transformModeRef.current = null;
      transformInitialRef.current = null;
      transformCurrentRef.current = null;
      
      requestDraw();
      return;
    }

    // ── 投げ縄選択確定 ────────────────────────────────────────────────────
    if (toolRef.current === "lasso" && isDrawingRef.current) {
      isDrawingRef.current = false;
      const poly = lassoPointsRef.current;
      if (poly.length > 2) {
        const selStrokes = strokesRef.current
          .filter(s => !s.isErased && s.points.length > 0 && s.points.some(pt => isPointInPolygon(pt, poly)))
          .map(s => s.strokeId);
        const selImages = imagesRef.current
          .filter(img => isPointInPolygon({ x: img.x + img.width / 2, y: img.y + img.height / 2 }, poly))
          .map(img => img.id);
        const selTexts = textsRef.current
          .filter(txt => isPointInPolygon({ x: txt.x + 10, y: txt.y + 10 }, poly))
          .map(txt => txt.id);
        selectedIdsRef.current = { strokes: selStrokes, images: selImages, texts: selTexts };
      }
      // 投げ縄のパスは消す (選択ハイライトのみ残す)
      lassoPointsRef.current = [];
      requestDraw();
      return;
    }

    // ── ストローク確定 ────────────────────────────────────────────────────
    if (!isDrawingRef.current || !currentStrokeRef.current || isReplayingRef.current) return;
    const final: Stroke = { ...currentStrokeRef.current, endTime: Date.now() };
    // pixel-erase はストローク配列に追加して描画時に destination-out 処理
    setStrokes(prev => [...prev, final]);
    isDrawingRef.current = false;
    currentStrokeRef.current = null;
    onTransformChange?.(panRef.current, zoomRef.current);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch") activePointersRef.current.delete(e.pointerId);
    isDrawingRef.current = false;
    isPanningRef.current = false;
    isDraggingSelectionRef.current = false;
    currentStrokeRef.current = null;
    lastPanPosRef.current = null;
    dragOffsetRef.current = { x: 0, y: 0 };
    drawImmediate();
  };

  // ── テキスト入力のフォーカス強制 ──────────────────────────────────────────
  useEffect(() => {
    if (textInput && textInputRef.current) {
      // 描画サイクル後に確実にフォーカスを当てる
      setTimeout(() => {
        textInputRef.current?.focus();
      }, 10);
    }
  }, [textInput]);

  // ── テキスト入力のコンテナ座標計算 ────────────────────────────────────────
  // worldToContainer は pan/zoom の ref から計算するため、render 時に呼ぶ
  const textInputPos = textInput
    ? worldToContainer(textInput.worldX, textInput.worldY)
    : null;

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute", top: 0, left: 0,
        width: "100%", height: "100%",
        overflow: "hidden",
        touchAction: "none",
        overscrollBehavior: "none",
        backgroundColor: "#ffffff",
      }}
    >
      <canvas
        ref={canvasRef}
        id="homeruai-canvas"
        width={dimensions.width}
        height={dimensions.height}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={e => e.preventDefault()}
        style={{
          position: "absolute", top: 0, left: 0,
          width: "100%", height: "100%",
          touchAction: "none", overscrollBehavior: "none",
          cursor:
            tool === "select" || tool === "lasso" ? "default" :
            tool === "text" ? "text" : "crosshair",
        }}
      />

      {/* ── テキスト入力オーバーレイ ── */}
      {textInput && textInputPos && (
        <textarea
          ref={textInputRef}
          autoFocus
          value={textInput.text}
          // canvas の pointer イベントが textarea に干渉しないよう伝播を止める
          onPointerDown={e => e.stopPropagation()}
          onPointerMove={e => e.stopPropagation()}
          onPointerUp={e => e.stopPropagation()}
          onMouseDown={e => e.stopPropagation()}
          onMouseUp={e => e.stopPropagation()}
          onClick={e => e.stopPropagation()}
          onChange={e => setTextInput(prev => prev ? { ...prev, text: e.target.value } : null)}
          onBlur={() => commitTextInput(true)}
          onKeyDown={e => {
            // Shift+Enter で確定、Escape で破棄
            if (e.key === "Escape") { e.preventDefault(); commitTextInput(false); }
          }}
          style={{
            position: "absolute",
            left: textInputPos.x,
            top: textInputPos.y,
            fontSize: `${textStyle.fontSize * zoomRef.current}px`,
            color: textStyle.color,
            fontWeight: textStyle.fontWeight,
            fontStyle: textStyle.fontStyle,
            textDecoration: textStyle.textDecoration,
            fontFamily: "sans-serif",
            lineHeight: 1.2,
            background: "rgba(255,255,255,0.85)",
            border: "1.5px dashed #5c2d91",
            borderRadius: "2px",
            outline: "none",
            resize: "none",
            padding: "2px 4px",
            whiteSpace: "pre",
            overflow: "hidden",
            minWidth: "80px",
            minHeight: `${textStyle.fontSize * 1.4 * zoomRef.current}px`,
            zIndex: 20,
            boxShadow: "0 2px 8px rgba(92,45,145,0.15)",
            userSelect: "text",
            WebkitUserSelect: "text",
            pointerEvents: "auto",
          }}
          onInput={e => {
            const t = e.target as HTMLTextAreaElement;
            t.style.height = "auto";
            t.style.height = t.scrollHeight + "px";
            t.style.width = "auto";
            t.style.width = Math.max(80, t.scrollWidth) + "px";
          }}
        />
      )}
    </div>
  );
}
