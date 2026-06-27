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

const isPointInPolygon = (point: { x: number; y: number }, polygon: { x: number; y: number }[]): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x, yi = polygon[i].y;
    const xj = polygon[j].x, yj = polygon[j].y;
    if (((yi > point.y) !== (yj > point.y)) && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
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
  const [dimensions, setDimensions] = useState({ width: 1024, height: 768 });
  const [dpr, setDpr] = useState(1);

  const panRef = useRef({ x: initialPan.x, y: initialPan.y });
  const zoomRef = useRef(initialZoom);
  const prevInitialPanRef = useRef(initialPan);
  const prevInitialZoomRef = useRef(initialZoom);
  
  if (initialPan.x !== prevInitialPanRef.current.x || initialPan.y !== prevInitialPanRef.current.y || initialZoom !== prevInitialZoomRef.current) {
    panRef.current = { x: initialPan.x, y: initialPan.y };
    zoomRef.current = initialZoom;
    prevInitialPanRef.current = initialPan;
    prevInitialZoomRef.current = initialZoom;
  }

  const currentStrokeRef = useRef<Stroke | null>(null);
  const isDrawingRef = useRef(false);
  const pointerPosRef = useRef<{ x: number; y: number } | null>(null);

  const toolRef = useRef(tool); toolRef.current = tool;
  const brushColorRef = useRef(brushColor); brushColorRef.current = brushColor;
  const brushWidthRef = useRef(brushWidth); brushWidthRef.current = brushWidth;
  const eraserModeRef = useRef(eraserMode); eraserModeRef.current = eraserMode;
  const eraserWidthRef = useRef(eraserWidth); eraserWidthRef.current = eraserWidth;
  const isReplayingRef = useRef(isReplaying); isReplayingRef.current = isReplaying;
  
  const strokesRef = useRef(strokes); 
  useEffect(() => { strokesRef.current = strokes; requestDraw(); }, [strokes]);
  
  const imagesRef = useRef(images); imagesRef.current = images;
  const textsRef = useRef(texts); textsRef.current = texts;
  const textStyleRef = useRef(textStyle); textStyleRef.current = textStyle;
  const aiAnnotationsRef = useRef(aiAnnotations || []); aiAnnotationsRef.current = aiAnnotations || [];

  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [textInput, setTextInput] = useState<{ id: string | null; text: string; worldX: number; worldY: number; } | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement | null>(null);

  const lassoPointsRef = useRef<{ x: number; y: number }[]>([]);
  const selectedIdsRef = useRef<{ strokes: string[]; images: string[]; texts: string[]; }>({ strokes: [], images: [], texts: [] });
  const isDraggingSelectionRef = useRef(false);
  const dragStartWorldRef = useRef<{ x: number; y: number } | null>(null);
  const dragOffsetRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  type TransformMode = "translate" | "resize-nw" | "resize-ne" | "resize-sw" | "resize-se" | "rotate" | null;
  const transformModeRef = useRef<TransformMode>(null);
  const transformInitialRef = useRef<{ x: number; y: number; w: number; h: number; r: number; cx: number; cy: number; } | null>(null);
  const transformCurrentRef = useRef<{ x: number; y: number; w: number; h: number; r: number; } | null>(null);

  const activePointersRef = useRef<Map<number, { clientX: number; clientY: number }>>(new Map());
  const pinchStartDistRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number | null>(null);
  const isPanningRef = useRef(false);
  const lastPanPosRef = useRef<{ x: number; y: number } | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  
  const spacePressedRef = useRef(false);
  const rafIdRef = useRef<number | null>(null);

  const rotatePoint = (px: number, py: number, cx: number, cy: number, angle: number) => {
    const cos = Math.cos(angle); const sin = Math.sin(angle);
    return { x: cos * (px - cx) - sin * (py - cy) + cx, y: sin * (px - cx) + cos * (py - cy) + cy };
  };

  const screenToWorld = (sx: number, sy: number, rect: DOMRect) => ({
    x: (sx - rect.left - panRef.current.x) / zoomRef.current,
    y: (sy - rect.top - panRef.current.y) / zoomRef.current,
  });

  const worldToContainer = (wx: number, wy: number) => ({
    x: wx * zoomRef.current + panRef.current.x,
    y: wy * zoomRef.current + panRef.current.y,
  });

  // 🌟 キーボードショートカット（Undo / Space移動）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return;

      if (e.code === "Space") {
        spacePressedRef.current = true;
        e.preventDefault();
      }
      
      // Undo: Ctrl+Z (Windows) / Cmd+Z (Mac/iPad)
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        setStrokes(prev => {
          let latestTime = 0;
          let actionType: "draw" | "erase" = "draw";
          let latestStrokeId = "";
          
          prev.forEach(s => {
            if (!s.isErased && s.endTime > latestTime) {
              latestTime = s.endTime;
              actionType = "draw";
              latestStrokeId = s.strokeId;
            }
            if (s.isErased && s.erasedAt && s.erasedAt > latestTime) {
              latestTime = s.erasedAt;
              actionType = "erase";
            }
          });

          if (latestTime === 0) return prev;

          if (actionType === "draw") {
            // 書いたものを戻す（AIログには消去痕跡として残る！）
            return prev.map(s => s.strokeId === latestStrokeId ? { ...s, isErased: true, erasedAt: Date.now() } : s);
          } else {
            // 消したものを戻す
            return prev.map(s => s.erasedAt === latestTime ? { ...s, isErased: false, erasedAt: undefined } : s);
          }
        });
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") spacePressedRef.current = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [setStrokes]);

  useEffect(() => { setDpr(window.devicePixelRatio || 1); }, []);

  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const blockTouch = (e: TouchEvent) => { if (e.touches.length < 2) e.preventDefault(); };
    el.addEventListener("touchstart", blockTouch, { passive: false });
    el.addEventListener("touchmove", blockTouch, { passive: false });
    return () => { el.removeEventListener("touchstart", blockTouch); el.removeEventListener("touchmove", blockTouch); };
  }, []);

  useEffect(() => {
    images.forEach(img => {
      if (!imageCacheRef.current.has(img.id)) {
        const el = new Image(); el.src = img.url;
        el.onload = () => { imageCacheRef.current.set(img.id, el); requestDraw(); };
      }
    });
  }, [images]);

  const drawImmediate = () => {
    const canvas = canvasRef.current; if (!canvas || dimensions.width === 0) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;

    const pan = panRef.current; const zoom = zoomRef.current;
    const curTool = toolRef.current; const offset = dragOffsetRef.current;
    const currentDpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, dimensions.width * currentDpr, dimensions.height * currentDpr);

    {
      const gs = 50; const l = -pan.x / zoom, t = -pan.y / zoom;
      const r = (dimensions.width - pan.x) / zoom; const b = (dimensions.height - pan.y) / zoom;
      ctx.save(); ctx.setTransform(zoom * currentDpr, 0, 0, zoom * currentDpr, pan.x * currentDpr, pan.y * currentDpr);
      ctx.strokeStyle = "rgba(0,0,0,0.05)"; ctx.lineWidth = 1; ctx.beginPath();
      for (let x = Math.floor(l / gs) * gs; x <= r; x += gs) { ctx.moveTo(x, t); ctx.lineTo(x, b); }
      for (let y = Math.floor(t / gs) * gs; y <= b; y += gs) { ctx.moveTo(l, y); ctx.lineTo(r, y); }
      ctx.stroke(); ctx.restore();
    }

    ctx.save(); ctx.setTransform(zoom * currentDpr, 0, 0, zoom * currentDpr, pan.x * currentDpr, pan.y * currentDpr);
    imagesRef.current.forEach(img => {
      const el = imageCacheRef.current.get(img.id);
      const isSel = selectedIdsRef.current.images.includes(img.id);
      const isSoloTransforming = selectedIdsRef.current.images.length === 1 && selectedIdsRef.current.strokes.length === 0 && selectedIdsRef.current.texts.length === 0;
      const isTransforming = isSel && isSoloTransforming && transformModeRef.current !== null && transformModeRef.current !== "translate";
      const isTranslating = isSel && (transformModeRef.current === "translate" || (!transformModeRef.current && isDraggingSelectionRef.current));

      let x = img.x, y = img.y, w = img.width, h = img.height, r = img.rotation || 0;
      if (isTranslating) { x += offset.x; y += offset.y; } 
      else if (isTransforming && transformCurrentRef.current) {
        x = transformCurrentRef.current.x; y = transformCurrentRef.current.y;
        w = transformCurrentRef.current.w; h = transformCurrentRef.current.h; r = transformCurrentRef.current.r;
      }
      const cx = x + w / 2; const cy = y + h / 2;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(r);
      if (el) ctx.drawImage(el, -w / 2, -h / 2, w, h);
      if (isSel) {
        ctx.strokeStyle = "#5c2d91"; ctx.lineWidth = 2 / zoom; ctx.strokeRect(-w / 2, -h / 2, w, h);
        if (isSoloTransforming && curTool === "select") {
          ctx.fillStyle = "#ffffff"; const hs = 8 / zoom;
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

    const off = document.createElement("canvas");
    off.width = dimensions.width * currentDpr; off.height = dimensions.height * currentDpr;
    const offCtx = off.getContext("2d");
    if (offCtx) {
      offCtx.setTransform(zoom * currentDpr, 0, 0, zoom * currentDpr, pan.x * currentDpr, pan.y * currentDpr);
      const renderStroke = (stroke: Stroke, isCurrentStroke = false) => {
        if (!stroke || !stroke.points || !Array.isArray(stroke.points)) return;
        if (stroke.type === "erase" || stroke.type === "pixel-erase") {
          if (stroke.type === "pixel-erase") {
            const pts = stroke.points.map(p => [p.x, p.y, p.p] as [number, number, number]);
            const outline = getStroke(pts, { size: stroke.width || 30, thinning: 0, smoothing: 0.5, streamline: 0.5 });
            if (outline.length === 0) return;
            offCtx.globalCompositeOperation = "destination-out"; offCtx.fillStyle = "rgba(0,0,0,1)";
            offCtx.beginPath(); offCtx.moveTo(outline[0][0], outline[0][1]);
            for (let i = 1; i < outline.length; i++) offCtx.lineTo(outline[i][0], outline[i][1]);
            offCtx.closePath(); offCtx.fill(); offCtx.globalCompositeOperation = "source-over";
          }
          return;
        }
        if (stroke.isErased) return;
        const isSel = !isCurrentStroke && selectedIdsRef.current.strokes.includes(stroke.strokeId);
        const dx = isSel ? offset.x : 0; const dy = isSel ? offset.y : 0;
        const pts = stroke.points.map(p => [p.x + dx, p.y + dy, p.p] as [number, number, number]);
        const outline = getStroke(pts, { size: stroke.width || 4, thinning: 0.5, smoothing: 0.5, streamline: 0.5 });
        if (outline.length === 0) return;
        offCtx.globalCompositeOperation = "source-over"; offCtx.fillStyle = stroke.color || "#000000";
        offCtx.beginPath(); offCtx.moveTo(outline[0][0], outline[0][1]);
        for (let i = 1; i < outline.length; i++) offCtx.lineTo(outline[i][0], outline[i][1]);
        offCtx.closePath(); offCtx.fill();
        if (isSel) {
          offCtx.strokeStyle = "rgba(92,45,145,0.45)"; offCtx.lineWidth = (stroke.width || 4) + 6 / zoom;
          offCtx.beginPath(); offCtx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) offCtx.lineTo(pts[i][0], pts[i][1]);
          offCtx.stroke();
        }
      };
      strokesRef.current.forEach(s => renderStroke(s));
      if (currentStrokeRef.current) renderStroke(currentStrokeRef.current, true);
    }
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(off, 0, 0); ctx.restore();

    ctx.save(); ctx.setTransform(zoom * currentDpr, 0, 0, zoom * currentDpr, pan.x * currentDpr, pan.y * currentDpr);
    textsRef.current.forEach(txt => {
      if (textInput?.id === txt.id) return;
      const isSel = selectedIdsRef.current.texts.includes(txt.id);
      const tx = txt.x + (isSel ? offset.x : 0), ty = txt.y + (isSel ? offset.y : 0);
      ctx.font = `${txt.fontStyle} ${txt.fontWeight} ${txt.fontSize}px sans-serif`; ctx.fillStyle = txt.color; ctx.textBaseline = "top";
      const lines = txt.text.split("\n"); const lineH = txt.fontSize * 1.2;
      lines.forEach((line, i) => ctx.fillText(line, tx, ty + i * lineH));
      if (txt.textDecoration === "underline") {
        ctx.strokeStyle = txt.color; ctx.lineWidth = Math.max(1, txt.fontSize * 0.05);
        lines.forEach((line, i) => {
          const w = ctx.measureText(line).width; const ly = ty + i * lineH + txt.fontSize;
          ctx.beginPath(); ctx.moveTo(tx, ly); ctx.lineTo(tx + w, ly); ctx.stroke();
        });
      }
      if (isSel) {
        ctx.strokeStyle = "#5c2d91"; ctx.lineWidth = 1.5 / zoom; let mw = 0;
        lines.forEach(l => { mw = Math.max(mw, ctx.measureText(l).width); });
        ctx.strokeRect(tx - 2, ty - 2, mw + 4, lines.length * lineH + 4);
      }
    });

    const annotations = aiAnnotationsRef.current;
    if (annotations.length > 0) {
      annotations.forEach(ann => {
        const img = imagesRef.current.find(im => im.id === ann.imageId); if (!img) return;
        const isSel = selectedIdsRef.current.images.includes(img.id);
        const imgX = img.x + (isSel ? offset.x : 0); const imgY = img.y + (isSel ? offset.y : 0);
        const [ymin, xmin, ymax, xmax] = ann.box_2d;
        const x1 = imgX + (xmin / 1000) * img.width; const y1 = imgY + (ymin / 1000) * img.height;
        const x2 = imgX + (xmax / 1000) * img.width; const y2 = imgY + (ymax / 1000) * img.height;
        const color = ann.color || (ann.type === "circle" ? "#107c41" : "#e81123");

        if (ann.type === "circle") {
          const cx = (x1 + x2) / 2; const cy = (y1 + y2) / 2;
          const size = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1), 40);
          ctx.beginPath(); ctx.ellipse(cx, cy, size / 2 + 10, size / 2 + 10, 0, 0, Math.PI * 2);
          ctx.strokeStyle = color; ctx.lineWidth = 4 / zoom; ctx.stroke();
          if (ann.comment) { ctx.font = `bold ${Math.max(14, Math.min(20, img.height * 0.03))}px sans-serif`; ctx.fillStyle = color; ctx.textBaseline = "bottom"; ctx.fillText(ann.comment, cx + size / 2 + 10, cy - size / 2 + 10); }
        } else if (ann.type === "underline") {
          ctx.beginPath(); const segments = 12;
          for (let j = 0; j <= segments; j++) {
            const px = x1 + (x2 - x1) * (j / segments); const py = y2 + 2 + (j % 2 === 0 ? 3 : -3) / zoom;
            if (j === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
          }
          ctx.strokeStyle = color; ctx.lineWidth = 2.5 / zoom; ctx.stroke();
          if (ann.comment) { ctx.font = `bold ${Math.max(11, Math.min(16, img.height * 0.022))}px sans-serif`; ctx.fillStyle = color; ctx.textBaseline = "top"; ctx.fillText(ann.comment, x1, y2 + 2 + 6 / zoom); }
        } else if (ann.type === "text" && ann.comment) {
          ctx.font = `bold ${Math.max(12, Math.min(20, img.height * 0.028))}px sans-serif`; ctx.fillStyle = color; ctx.textBaseline = "top";
          ann.comment.split("\n").forEach((line, li) => ctx.fillText(line, x1, y1 + li * (Math.max(12, Math.min(20, img.height * 0.028)) * 1.3)));
        }
      });
    }

    const lp = lassoPointsRef.current;
    if (curTool === "lasso" && lp.length > 1) {
      ctx.strokeStyle = "rgba(92,45,145,0.8)"; ctx.lineWidth = 1.5 / zoom; ctx.setLineDash([5 / zoom, 4 / zoom]);
      ctx.beginPath(); ctx.moveTo(lp[0].x, lp[0].y);
      for (let i = 1; i < lp.length; i++) ctx.lineTo(lp[i].x, lp[i].y);
      if (!isDrawingRef.current) ctx.closePath();
      ctx.stroke(); ctx.setLineDash([]);
      if (!isDrawingRef.current) { ctx.fillStyle = "rgba(92,45,145,0.08)"; ctx.fill(); }
    }
    ctx.restore();

    const cp = pointerPosRef.current;
    if (curTool === "eraser" && cp && !isReplayingRef.current && !isPanningRef.current) {
      ctx.save(); ctx.setTransform(currentDpr, 0, 0, currentDpr, 0, 0);
      ctx.beginPath(); ctx.arc(cp.x, cp.y, eraserWidthRef.current / 2, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(239,68,68,0.1)"; ctx.strokeStyle = "rgba(239,68,68,0.8)"; ctx.lineWidth = 1.5; ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  };

  const requestDraw = () => {
    if (rafIdRef.current !== null) return;
    rafIdRef.current = requestAnimationFrame(() => { rafIdRef.current = null; drawImmediate(); });
  };

  useEffect(() => {
    const el = containerRef.current; if (!el) return;
    const updateSize = () => { const rect = el.getBoundingClientRect(); if (rect.width > 0 && rect.height > 0) setDimensions({ width: rect.width, height: rect.height }); };
    updateSize(); const ro = new ResizeObserver(updateSize); ro.observe(el); return () => ro.disconnect();
  }, []);

  useEffect(() => { requestDraw(); }, [dimensions, images, texts, tool, textInput]);

  const clearSelection = () => {
    selectedIdsRef.current = { strokes: [], images: [], texts: [] }; lassoPointsRef.current = []; dragOffsetRef.current = { x: 0, y: 0 };
    isDraggingSelectionRef.current = false; dragStartWorldRef.current = null; transformModeRef.current = null; transformInitialRef.current = null; transformCurrentRef.current = null;
  };

  const commitTextInput = useCallback((save: boolean) => {
    setTextInput(prev => {
      if (!prev) return null;
      if (save && prev.text.trim().length > 0) {
        const style = textStyleRef.current;
        if (prev.id) setTexts(ts => ts.map(t => t.id === prev.id ? { ...t, text: prev.text, ...style } : t));
        else setTexts(ts => [...ts, { id: `txt_${Date.now()}`, text: prev.text, x: prev.worldX, y: prev.worldY, ...style }]);
      }
      return null;
    });
  }, [setTexts]);

  const performObjectErasing = (worldPos: { x: number; y: number }, activeEraser: Stroke) => {
    const threshold = (eraserWidthRef.current / 2) / zoomRef.current + 8;
    const dist2 = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
    
    const nextStrokes = strokesRef.current.map(s => {
      if (s.type !== "draw" || s.isErased) return s;
      if (s.points.some(pt => dist2(worldPos, pt) < threshold)) {
        if (activeEraser.targetStrokeIds && !activeEraser.targetStrokeIds.includes(s.strokeId)) activeEraser.targetStrokeIds.push(s.strokeId);
        return { ...s, isErased: true, erasedAt: Date.now() };
      }
      return s;
    });
    strokesRef.current = nextStrokes;
    setStrokes(nextStrokes);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isReplayingRef.current) return;
    const canvas = canvasRef.current;
    try { if (canvas) canvas.setPointerCapture(e.pointerId); } catch(err) {}

    const rect = canvas?.getBoundingClientRect() ?? new DOMRect();
    const sx = e.clientX, sy = e.clientY;
    const wp = screenToWorld(sx, sy, rect);

    // 🌟 iPadの指は「必ず」移動・拡大縮小になる
    if (e.pointerType === "touch") {
      activePointersRef.current.set(e.pointerId, { clientX: sx, clientY: sy });
      
      // 描画中に指が触れたら、描画を強制セーブして中断する
      if (isDrawingRef.current && currentStrokeRef.current) {
        const finalStroke = { ...currentStrokeRef.current, endTime: Date.now() };
        strokesRef.current = [...strokesRef.current, finalStroke];
        setStrokes(prev => [...prev, finalStroke]);
        isDrawingRef.current = false; currentStrokeRef.current = null; activePointerIdRef.current = null;
      }
      
      if (activePointersRef.current.size === 2) {
        isPanningRef.current = false;
        const pts = Array.from(activePointersRef.current.values());
        pinchStartDistRef.current = Math.hypot(pts[0].clientX - pts[1].clientX, pts[0].clientY - pts[1].clientY);
        pinchStartZoomRef.current = zoomRef.current;
        return;
      }
      
      if (activePointersRef.current.size === 1) {
        isPanningRef.current = true;
        lastPanPosRef.current = { x: sx, y: sy };
        return;
      }
      return; // 指の場合はここで完全終了（ツールを使わせない）
    }

    // 🌟 PCの「スペースキー＋クリック」「右クリック」「中クリック」で移動
    if (spacePressedRef.current || (e.pointerType === "mouse" && (e.button === 1 || e.button === 2))) {
      isPanningRef.current = true; 
      lastPanPosRef.current = { x: sx, y: sy }; 
      return;
    }

    if (toolRef.current === "select" || toolRef.current === "lasso") {
      if (textInput) commitTextInput(true);
      let hitSomething = false;
      const isSoloTransforming = selectedIdsRef.current.images.length === 1 && selectedIdsRef.current.strokes.length === 0 && selectedIdsRef.current.texts.length === 0;
      if (isSoloTransforming && toolRef.current === "select") {
        const imgId = selectedIdsRef.current.images[0];
        const img = imagesRef.current.find(i => i.id === imgId);
        if (img) {
          const cx = img.x + img.width / 2, cy = img.y + img.height / 2;
          const rotatedWP = rotatePoint(wp.x, wp.y, cx, cy, -(img.rotation || 0));
          const lx = rotatedWP.x - cx, ly = rotatedWP.y - cy;
          const hs = 16 / zoomRef.current;
          let hitMode: TransformMode = null;
          if (Math.hypot(lx, ly - (-img.height / 2 - 20 / zoomRef.current)) <= hs) hitMode = "rotate";
          else if (Math.abs(lx - (-img.width / 2)) <= hs && Math.abs(ly - (-img.height / 2)) <= hs) hitMode = "resize-nw";
          else if (Math.abs(lx - (img.width / 2)) <= hs && Math.abs(ly - (-img.height / 2)) <= hs) hitMode = "resize-ne";
          else if (Math.abs(lx - (-img.width / 2)) <= hs && Math.abs(ly - (img.height / 2)) <= hs) hitMode = "resize-sw";
          else if (Math.abs(lx - (img.width / 2)) <= hs && Math.abs(ly - (img.height / 2)) <= hs) hitMode = "resize-se";
          if (hitMode) {
            transformModeRef.current = hitMode;
            transformInitialRef.current = { x: img.x, y: img.y, w: img.width, h: img.height, r: img.rotation || 0, cx, cy };
            transformCurrentRef.current = { ...transformInitialRef.current };
            isDraggingSelectionRef.current = true; dragStartWorldRef.current = wp; dragOffsetRef.current = { x: 0, y: 0 };
            requestDraw(); return;
          }
        }
      }
      if (!hitSomething) {
        for (const img of imagesRef.current) {
          const cx = img.x + img.width / 2, cy = img.y + img.height / 2;
          const rotatedWP = rotatePoint(wp.x, wp.y, cx, cy, -(img.rotation || 0));
          const lx = rotatedWP.x - cx, ly = rotatedWP.y - cy;
          if (lx >= -img.width / 2 && lx <= img.width / 2 && ly >= -img.height / 2 && ly <= img.height / 2) {
            if (toolRef.current === "select" && !selectedIdsRef.current.images.includes(img.id)) selectedIdsRef.current = { strokes: [], images: [img.id], texts: [] };
            hitSomething = true; break;
          }
        }
      }
      if (!hitSomething) {
        const tmpCtx = canvasRef.current?.getContext("2d");
        for (const txt of textsRef.current) {
          if (tmpCtx) tmpCtx.font = `${txt.fontStyle} ${txt.fontWeight} ${txt.fontSize}px sans-serif`;
          const lines = txt.text.split("\n"); let mw = 0; lines.forEach(l => { mw = Math.max(mw, tmpCtx?.measureText(l).width ?? 100); });
          if (wp.x >= txt.x && wp.x <= txt.x + mw && wp.y >= txt.y && wp.y <= txt.y + lines.length * txt.fontSize * 1.2) {
            if (toolRef.current === "select" && !selectedIdsRef.current.texts.includes(txt.id)) selectedIdsRef.current = { strokes: [], images: [], texts: [txt.id] };
            hitSomething = true;
            if (toolRef.current === "select" && e.detail >= 2) { setTextInput({ id: txt.id, text: txt.text, worldX: txt.x, worldY: txt.y }); return; }
            break;
          }
        }
      }
      const hasSel = selectedIdsRef.current.strokes.length > 0 || selectedIdsRef.current.images.length > 0 || selectedIdsRef.current.texts.length > 0;
      if (hitSomething) { isDraggingSelectionRef.current = true; dragStartWorldRef.current = wp; dragOffsetRef.current = { x: 0, y: 0 }; } 
      else if (toolRef.current === "lasso") { isDrawingRef.current = true; activePointerIdRef.current = e.pointerId; lassoPointsRef.current = [wp]; if (hasSel) clearSelection(); } 
      else clearSelection();
      requestDraw(); return;
    }

    if (toolRef.current === "text") {
      commitTextInput(true);
      const tmpCtx = canvasRef.current?.getContext("2d"); let found = false;
      for (const txt of textsRef.current) {
        if (tmpCtx) tmpCtx.font = `${txt.fontStyle} ${txt.fontWeight} ${txt.fontSize}px sans-serif`;
        const lines = txt.text.split("\n"); let mw = 0; lines.forEach(l => { mw = Math.max(mw, tmpCtx?.measureText(l).width ?? 100); });
        if (wp.x >= txt.x && wp.x <= txt.x + mw && wp.y >= txt.y && wp.y <= txt.y + lines.length * txt.fontSize * 1.2) {
          setTextInput({ id: txt.id, text: txt.text, worldX: txt.x, worldY: txt.y }); found = true; break;
        }
      }
      if (!found) setTextInput({ id: null, text: "", worldX: wp.x, worldY: wp.y });
      return;
    }

    // ★ マウスの左クリック、またはApple Pencilのみ描画できる
    if (e.button === 0 || e.pointerType === "pen") {
      commitTextInput(true);

      if (isDrawingRef.current && currentStrokeRef.current) {
        const finalStroke = { ...currentStrokeRef.current, endTime: Date.now() };
        strokesRef.current = [...strokesRef.current, finalStroke];
        setStrokes(prev => [...prev, finalStroke]);
      }

      isDrawingRef.current = true;
      activePointerIdRef.current = e.pointerId;
      
      const pressure = e.pointerType === "pen" ? e.pressure : 0.5;
      const now = Date.now();
      let strokeType: "draw" | "erase" | "pixel-erase" = "draw";
      if (toolRef.current === "eraser") strokeType = eraserModeRef.current === "pixel" ? "pixel-erase" : "erase";
      
      currentStrokeRef.current = { strokeId: `${strokeType[0]}_${now}_${Math.random().toString(36).substr(2, 9)}`, type: strokeType, startTime: now, endTime: now, points: [{ x: wp.x, y: wp.y, p: pressure, t: 0 }], color: strokeType === "draw" ? brushColorRef.current : undefined, width: strokeType === "draw" ? brushWidthRef.current : eraserWidthRef.current, targetStrokeIds: strokeType === "erase" ? [] : undefined };
      pointerPosRef.current = { x: sx - rect.left, y: sy - rect.top };
      
      if (strokeType === "erase") performObjectErasing(wp, currentStrokeRef.current);
      requestDraw();
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect() ?? new DOMRect();
    const sx = e.clientX, sy = e.clientY; const wp = screenToWorld(sx, sy, rect);
    pointerPosRef.current = { x: sx - rect.left, y: sy - rect.top };

    if (e.pointerType === "touch" && activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { clientX: sx, clientY: sy });
      if (activePointersRef.current.size === 2 && pinchStartDistRef.current && pinchStartZoomRef.current !== null) {
        const ptList = Array.from(activePointersRef.current.values());
        const cd = Math.hypot(ptList[0].clientX - ptList[1].clientX, ptList[0].clientY - ptList[1].clientY);
        const nz = Math.max(0.1, Math.min(10, pinchStartZoomRef.current * (cd / pinchStartDistRef.current)));
        const midX = (ptList[0].clientX + ptList[1].clientX) / 2, midY = (ptList[0].clientY + ptList[1].clientY) / 2;
        const prevZ = zoomRef.current; const mwx = (midX - rect.left - panRef.current.x) / prevZ, mwy = (midY - rect.top - panRef.current.y) / prevZ;
        panRef.current = { x: midX - rect.left - mwx * nz, y: midY - rect.top - mwy * nz }; zoomRef.current = nz;
        requestDraw(); return;
      }
      if (activePointersRef.current.size === 1 && isPanningRef.current && lastPanPosRef.current) {
        panRef.current = { x: panRef.current.x + (sx - lastPanPosRef.current.x), y: panRef.current.y + (sy - lastPanPosRef.current.y) };
        lastPanPosRef.current = { x: sx, y: sy }; requestDraw(); return;
      }
    }

    if (isPanningRef.current && lastPanPosRef.current && e.pointerType !== "touch") {
      panRef.current = { x: panRef.current.x + (sx - lastPanPosRef.current.x), y: panRef.current.y + (sy - lastPanPosRef.current.y) };
      lastPanPosRef.current = { x: sx, y: sy }; requestDraw(); return;
    }

    if (isDraggingSelectionRef.current && dragStartWorldRef.current) {
      if (transformModeRef.current && transformModeRef.current !== "translate" && transformInitialRef.current) {
        const initial = transformInitialRef.current;
        if (transformModeRef.current === "rotate") { transformCurrentRef.current = { ...initial, r: Math.atan2(wp.y - initial.cy, wp.x - initial.cx) + Math.PI / 2 }; } 
        else {
          const localStart = rotatePoint(dragStartWorldRef.current.x, dragStartWorldRef.current.y, initial.cx, initial.cy, -initial.r);
          const localCurrent = rotatePoint(wp.x, wp.y, initial.cx, initial.cy, -initial.r);
          const dx = localCurrent.x - localStart.x, dy = localCurrent.y - localStart.y;
          const ux = initial.cx - initial.w / 2, uy = initial.cy - initial.h / 2;
          let nuw = initial.w, nuh = initial.h, nux = ux, nuy = uy;
          if (transformModeRef.current === "resize-se") { nuw += dx; nuh += dy; } else if (transformModeRef.current === "resize-nw") { nuw -= dx; nuh -= dy; nux += dx; nuy += dy; } else if (transformModeRef.current === "resize-ne") { nuw += dx; nuh -= dy; nuy += dy; } else if (transformModeRef.current === "resize-sw") { nuw -= dx; nuh += dy; nux += dx; }
          if (nuw < 20) { nux -= (20 - nuw) * (nux > ux ? 1 : 0); nuw = 20; } if (nuh < 20) { nuy -= (20 - nuh) * (nuy > uy ? 1 : 0); nuh = 20; }
          const ncw = rotatePoint(nux + nuw / 2, nuy + nuh / 2, initial.cx, initial.cy, initial.r);
          transformCurrentRef.current = { ...initial, x: ncw.x - nuw / 2, y: ncw.y - nuh / 2, w: nuw, h: nuh };
        }
        drawImmediate(); return;
      } else { dragOffsetRef.current = { x: wp.x - dragStartWorldRef.current.x, y: wp.y - dragStartWorldRef.current.y }; drawImmediate(); return; }
    }

    if (!isDrawingRef.current || e.pointerId !== activePointerIdRef.current || isReplayingRef.current) {
      if (toolRef.current === "eraser") requestDraw(); return;
    }

    if (toolRef.current === "lasso") { lassoPointsRef.current.push(wp); drawImmediate(); return; }
    
    if (currentStrokeRef.current) {
      currentStrokeRef.current.points.push({ x: wp.x, y: wp.y, p: e.pointerType === "pen" ? e.pressure : 0.5, t: Date.now() - currentStrokeRef.current.startTime });
      if (currentStrokeRef.current.type === "erase") performObjectErasing(wp, currentStrokeRef.current);
      drawImmediate();
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current; 
    try { if (canvas) canvas.releasePointerCapture(e.pointerId); } catch(err) {}
    
    if (e.pointerType === "touch") {
      activePointersRef.current.delete(e.pointerId);
      if (activePointersRef.current.size < 2) { pinchStartDistRef.current = null; pinchStartZoomRef.current = null; }
      if (activePointersRef.current.size === 0) { isPanningRef.current = false; lastPanPosRef.current = null; onTransformChange?.(panRef.current, zoomRef.current); }
    }
    
    if (isPanningRef.current && e.pointerType !== "touch") { 
      isPanningRef.current = false; lastPanPosRef.current = null; 
      onTransformChange?.(panRef.current, zoomRef.current); return; 
    }

    if (isDraggingSelectionRef.current) {
      if (transformModeRef.current && transformModeRef.current !== "translate" && transformCurrentRef.current) {
        const cur = transformCurrentRef.current; const imgId = selectedIdsRef.current.images[0];
        setImages(prev => prev.map(img => img.id === imgId ? { ...img, x: cur.x, y: cur.y, width: cur.w, height: cur.h, rotation: cur.r } : img));
      } else {
        const dx = dragOffsetRef.current.x, dy = dragOffsetRef.current.y, now = Date.now(), sel = { ...selectedIdsRef.current };
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
          if (sel.strokes.length > 0) setStrokes(prev => { const next: Stroke[] = [], added: Stroke[] = []; for (const s of prev) { if (sel.strokes.includes(s.strokeId)) { next.push({ ...s, isErased: true, erasedAt: now }); added.push({ ...s, strokeId: `s_${now}_${Math.random().toString(36).substr(2, 6)}`, startTime: now, endTime: now, isErased: false, erasedAt: undefined, points: s.points.map(p => ({ ...p, x: p.x + dx, y: p.y + dy, t: 0 })) }); } else next.push(s); } return [...next, ...added]; });
          if (sel.images.length > 0) setImages(prev => prev.map(img => sel.images.includes(img.id) ? { ...img, x: img.x + dx, y: img.y + dy } : img));
          if (sel.texts.length > 0) setTexts(prev => prev.map(txt => sel.texts.includes(txt.id) ? { ...txt, x: txt.x + dx, y: txt.y + dy } : txt));
        }
      }
      isDraggingSelectionRef.current = false; dragOffsetRef.current = { x: 0, y: 0 }; dragStartWorldRef.current = null; transformModeRef.current = null; transformInitialRef.current = null; transformCurrentRef.current = null; requestDraw(); return;
    }

    if (isDrawingRef.current && e.pointerId === activePointerIdRef.current) {
      if (toolRef.current === "lasso") {
        const poly = lassoPointsRef.current;
        if (poly.length > 2) {
          selectedIdsRef.current = { strokes: strokesRef.current.filter(s => !s.isErased && s.points.some(pt => isPointInPolygon(pt, poly))).map(s => s.strokeId), images: imagesRef.current.filter(img => isPointInPolygon({ x: img.x + img.width / 2, y: img.y + img.height / 2 }, poly)).map(img => img.id), texts: textsRef.current.filter(txt => isPointInPolygon({ x: txt.x + 10, y: txt.y + 10 }, poly)).map(txt => txt.id) };
        }
        lassoPointsRef.current = [];
      } else if (currentStrokeRef.current) {
        const finalStroke = { ...currentStrokeRef.current, endTime: Date.now() };
        strokesRef.current = [...strokesRef.current, finalStroke];
        setStrokes(prev => [...prev, finalStroke]);
      }
      isDrawingRef.current = false; currentStrokeRef.current = null; activePointerIdRef.current = null;
      onTransformChange?.(panRef.current, zoomRef.current);
      requestDraw();
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch") activePointersRef.current.delete(e.pointerId);

    if (isDrawingRef.current && e.pointerId === activePointerIdRef.current) {
      if (currentStrokeRef.current) {
        const finalStroke = { ...currentStrokeRef.current, endTime: Date.now() };
        strokesRef.current = [...strokesRef.current, finalStroke];
        setStrokes(prev => [...prev, finalStroke]);
      }
      isDrawingRef.current = false; currentStrokeRef.current = null; activePointerIdRef.current = null;
      requestDraw();
    }
  };

  useEffect(() => { if (textInput && textInputRef.current) setTimeout(() => textInputRef.current?.focus(), 10); }, [textInput]);
  const textInputPos = textInput ? worldToContainer(textInput.worldX, textInput.worldY) : null;

  return (
    <div
      ref={containerRef}
      style={{
        position: "absolute", top: 0, left: 0,
        width: "100%", height: "100%",
        minHeight: "100%",           
        overflow: "hidden",
        touchAction: "none",         
        overscrollBehavior: "none",
        userSelect: "none",          
        WebkitUserSelect: "none",    
        backgroundColor: "#ffffff",
      }}
    >
      <canvas
        ref={canvasRef}
        id="homeruai-canvas"
        width={dimensions.width * dpr}
        height={dimensions.height * dpr}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={e => e.preventDefault()}
        style={{
          position: "absolute", top: 0, left: 0,
          width: `${dimensions.width}px`,
          height: `${dimensions.height}px`,
          touchAction: "none", overscrollBehavior: "none",
          userSelect: "none", WebkitUserSelect: "none",
          cursor: tool === "select" || tool === "lasso" ? "default" : tool === "text" ? "text" : "crosshair",
        }}
      />
      {textInput && textInputPos && (
        <textarea
          ref={textInputRef} autoFocus value={textInput.text}
          onPointerDown={e => e.stopPropagation()} onPointerMove={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()} onMouseUp={e => e.stopPropagation()} onClick={e => e.stopPropagation()}
          onChange={e => setTextInput(prev => prev ? { ...prev, text: e.target.value } : null)}
          onBlur={() => commitTextInput(true)}
          onKeyDown={e => { if (e.key === "Escape") { e.preventDefault(); commitTextInput(false); } }}
          style={{ position: "absolute", left: textInputPos.x, top: textInputPos.y, fontSize: `${textStyle.fontSize * zoomRef.current}px`, color: textStyle.color, fontWeight: textStyle.fontWeight, fontStyle: textStyle.fontStyle, textDecoration: textStyle.textDecoration, fontFamily: "sans-serif", lineHeight: 1.2, background: "rgba(255,255,255,0.85)", border: "1.5px dashed #5c2d91", borderRadius: "2px", outline: "none", resize: "none", padding: "2px 4px", whiteSpace: "pre", overflow: "hidden", minWidth: "80px", minHeight: `${textStyle.fontSize * 1.4 * zoomRef.current}px`, zIndex: 20, boxShadow: "0 2px 8px rgba(92,45,145,0.15)", userSelect: "text", WebkitUserSelect: "text", pointerEvents: "auto" }}
          onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = "auto"; t.style.height = t.scrollHeight + "px"; t.style.width = "auto"; t.style.width = Math.max(80, t.scrollWidth) + "px"; }}
        />
      )}
    </div>
  );
}