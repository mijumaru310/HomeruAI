"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { getStroke } from "perfect-freehand";
import { Stroke, Point } from "../types/canvas";
import { Pan } from "../hooks/useCanvasTransform";

interface CanvasProps {
  strokes: Stroke[];
  setStrokes: React.Dispatch<React.SetStateAction<Stroke[]>>;
  tool: "pen" | "eraser";
  brushColor: string;
  brushWidth: number;
  eraserWidth: number;
  bgImageUrl: string | null;
  isReplaying: boolean;
  pan: Pan;
  setPan: React.Dispatch<React.SetStateAction<Pan>>;
  zoom: number;
  setZoom: React.Dispatch<React.SetStateAction<number>>;
  resetTransform: () => void;
}

export default function Canvas({
  strokes,
  setStrokes,
  tool,
  brushColor,
  brushWidth,
  eraserWidth,
  bgImageUrl,
  isReplaying,
  pan,
  setPan,
  zoom,
  setZoom,
  resetTransform,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  
  // キャンバスのリアルタイムピクセルサイズ
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);
  
  // マウス/ペン位置（消しゴムガイド表示などのためスクリーン座標）
  const [pointerPos, setPointerPos] = useState<{ x: number; y: number } | null>(null);
  
  // 背景イメージオブジェクトのキャッシュ
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  
  // マルチタッチ（ピンチズーム）追跡用
  const activePointersRef = useRef<Map<number, { clientX: number; clientY: number }>>(new Map());
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef<number | null>(null);
  
  // PCパン操作追跡用 (右ドラッグ or スペースキー押下中)
  const [isPanning, setIsPanning] = useState(false);
  const lastPanPosRef = useRef<{ x: number; y: number } | null>(null);
  const spacePressedRef = useRef(false);

  // スクリーン座標からワールド（無限キャンバス）座標への変換
  const screenToWorld = useCallback((screenX: number, screenY: number, rect: DOMRect) => {
    const x = (screenX - rect.left - pan.x) / zoom;
    const y = (screenY - rect.top - pan.y) / zoom;
    return { x, y };
  }, [pan, zoom]);

  // 背景イメージのキャッシュ参照 (手書き中の再レンダーでの点滅を防止)
  const loadedBgUrlRef = useRef<string | null>(null);

  // 背景画像の読み込み
  useEffect(() => {
    if (!bgImageUrl) {
      setBgImage(null);
      loadedBgUrlRef.current = null;
      return;
    }
    
    // すでにロード済みの画像と同一のURLならリロード（クリア）を行わない
    if (loadedBgUrlRef.current === bgImageUrl) {
      return;
    }
    
    const img = new Image();
    img.src = bgImageUrl;
    img.onload = () => {
      setBgImage(img);
      loadedBgUrlRef.current = bgImageUrl;
    };
    img.onerror = () => {
      console.error("Failed to load background image:", bgImageUrl);
      setBgImage(null);
      loadedBgUrlRef.current = null;
    };
  }, [bgImageUrl]);

  // 手書きコンテンツと背景画像の境界ボックス (ワールド座標系) を計算
  const getContentsBounds = useCallback(() => {
    let minX = 0;
    let minY = 0;
    let maxX = dimensions.width || 1024;
    let maxY = dimensions.height || 768;

    let hasContent = false;

    // 背景画像がある場合
    if (bgImage) {
      maxX = bgImage.width;
      maxY = bgImage.height;
      hasContent = true;
    }

    // 手書きストロークがある場合
    if (strokes.length > 0) {
      let strokeMinX = Infinity;
      let strokeMinY = Infinity;
      let strokeMaxX = -Infinity;
      let strokeMaxY = -Infinity;

      strokes.forEach((stroke) => {
        if (stroke.isErased || stroke.type !== "draw") return;
        stroke.points.forEach((pt) => {
          hasContent = true;
          if (pt.x < strokeMinX) strokeMinX = pt.x;
          if (pt.y < strokeMinY) strokeMinY = pt.y;
          if (pt.x > strokeMaxX) strokeMaxX = pt.x;
          if (pt.y > strokeMaxY) strokeMaxY = pt.y;
        });
      });

      if (hasContent && strokeMinX !== Infinity) {
        minX = Math.min(minX, strokeMinX);
        minY = Math.min(minY, strokeMinY);
        maxX = Math.max(maxX, strokeMaxX);
        maxY = Math.max(maxY, strokeMaxY);
      }
    }

    return { minX, minY, maxX, maxY };
  }, [strokes, bgImage, dimensions]);

  // パン位置をクランプ (Appleメモアプリのように、書いた範囲＋マージンでのみスクロール可能にする)
  const clampPan = useCallback(
    (targetPanX: number, targetPanY: number, currentZoom: number) => {
      if (dimensions.width === 0 || dimensions.height === 0) {
        return { x: targetPanX, y: targetPanY };
      }
      
      const bounds = getContentsBounds();
      // 余白マージン。画面サイズ程度スクロールアウトできるゆとりを持たせる
      const marginX = dimensions.width * 0.4;
      const marginY = dimensions.height * 0.4;

      const contentMinX = bounds.minX - marginX;
      const contentMinY = bounds.minY - marginY;
      const contentMaxX = bounds.maxX + marginX;
      const contentMaxY = bounds.maxY + marginY;

      // 表示画面がコンテンツ範囲外へ完全に飛び出さないようにパンをクランプ
      const minPanX = dimensions.width - contentMaxX * currentZoom;
      const maxPanX = -contentMinX * currentZoom;
      const minPanY = dimensions.height - contentMaxY * currentZoom;
      const maxPanY = -contentMinY * currentZoom;

      const clampedX = Math.min(Math.max(targetPanX, Math.min(minPanX, maxPanX)), Math.max(minPanX, maxPanX));
      const clampedY = Math.min(Math.max(targetPanY, Math.min(minPanY, maxPanY)), Math.max(minPanY, maxPanY));

      return { x: clampedX, y: clampedY };
    },
    [getContentsBounds, dimensions]
  );

  // コンテナサイズに応じたキャンバスサイズのリサイズ処理
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // PC用スペースキー押下判定
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spacePressedRef.current = true;
        // スペースキーによるブラウザデフォルトのスクロールを防止
        if (e.target === document.body || e.target === canvasRef.current) {
          e.preventDefault();
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spacePressedRef.current = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, []);

  // マウスホイールによるズーム (キャンバス要素へ直接passive: falseでアタッチ)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault(); // 画面全体のスクロール・ズームを防ぐ

      const rect = canvas.getBoundingClientRect();
      const clientX = e.clientX;
      const clientY = e.clientY;

      // ズーム感度の設定
      const zoomFactor = 1 - e.deltaY * 0.001;
      
      setZoom((prevZoom) => {
        const nextZoom = Math.max(0.1, Math.min(10, prevZoom * zoomFactor));
        
        // カーソル位置を基準（ピボット）としてズームするようパンを再計算
        const mouseWorldX = (clientX - rect.left - pan.x) / prevZoom;
        const mouseWorldY = (clientY - rect.top - pan.y) / prevZoom;

        const targetPanX = clientX - rect.left - mouseWorldX * nextZoom;
        const targetPanY = clientY - rect.top - mouseWorldY * nextZoom;

        setPan(clampPan(targetPanX, targetPanY, nextZoom));

        return nextZoom;
      });
    };

    canvas.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      canvas.removeEventListener("wheel", handleWheel);
    };
  }, [pan, setPan, setZoom, clampPan]);

  // 描画処理
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || dimensions.width === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // 物理ピクセルクリア
    ctx.clearRect(0, 0, dimensions.width, dimensions.height);

    // 1. 無限方眼グリッドの描画 (パン・ズームに追従)
    ctx.save();
    ctx.strokeStyle = "rgba(0, 0, 0, 0.06)"; // 白紙に合う薄いグレー
    ctx.lineWidth = 1;
    
    // グリッド線の間隔 (ワールド座標系で50pxごと)
    const gridSize = 50;
    
    // 現在の画面に表示されているワールド座標の範囲を逆算
    const left = -pan.x / zoom;
    const top = -pan.y / zoom;
    const right = (dimensions.width - pan.x) / zoom;
    const bottom = (dimensions.height - pan.y) / zoom;

    // グリッド描画の開始・終了インデックス
    const startX = Math.floor(left / gridSize) * gridSize;
    const endX = Math.ceil(right / gridSize) * gridSize;
    const startY = Math.floor(top / gridSize) * gridSize;
    const endY = Math.ceil(bottom / gridSize) * gridSize;

    // 2Dトランスフォームを適用してグリッドを描く
    ctx.setTransform(zoom, 0, 0, zoom, pan.x, pan.y);

    ctx.beginPath();
    for (let x = startX; x <= endX; x += gridSize) {
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
    }
    for (let y = startY; y <= endY; y += gridSize) {
      ctx.moveTo(left, y);
      ctx.lineTo(right, y);
    }
    ctx.stroke();
    
    // ワールドの原点 (0,0) を示す薄い十字軸（白紙時のガイド用）
    ctx.strokeStyle = "rgba(99, 102, 241, 0.25)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(startX, 0);
    ctx.lineTo(endX, 0);
    ctx.moveTo(0, startY);
    ctx.lineTo(0, endY);
    ctx.stroke();
    ctx.restore();

    // 2. パン・ズーム変換の適用（コンテンツの描画用）
    ctx.save();
    ctx.setTransform(zoom, 0, 0, zoom, pan.x, pan.y);

    // 背景画像 (問題画像) を (0,0) 基準に等倍で描画
    if (bgImage) {
      ctx.drawImage(bgImage, 0, 0);
    }

    // 保存されているストロークを描画
    strokes.forEach((stroke) => {
      if (stroke.isErased || stroke.type !== "draw") return;

      const strokePoints = stroke.points.map((p) => [p.x, p.y, p.p]);
      const options = {
        size: stroke.width || 4,
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
      };
      const outlinePoints = getStroke(strokePoints, options);

      if (outlinePoints.length === 0) return;

      ctx.fillStyle = stroke.color || "#000000";
      ctx.beginPath();
      ctx.moveTo(outlinePoints[0][0], outlinePoints[0][1]);
      for (let i = 1; i < outlinePoints.length; i++) {
        ctx.lineTo(outlinePoints[i][0], outlinePoints[i][1]);
      }
      ctx.closePath();
      ctx.fill();
    });

    // 現在描画中のストロークを描画 (ペンツールのみ)
    if (currentStroke && currentStroke.type === "draw" && currentStroke.points.length > 0) {
      const strokePoints = currentStroke.points.map((p) => [p.x, p.y, p.p]);
      const options = {
        size: brushWidth,
        thinning: 0.5,
        smoothing: 0.5,
        streamline: 0.5,
      };
      const outlinePoints = getStroke(strokePoints, options);

      if (outlinePoints.length > 0) {
        ctx.fillStyle = brushColor;
        ctx.beginPath();
        ctx.moveTo(outlinePoints[0][0], outlinePoints[0][1]);
        for (let i = 1; i < outlinePoints.length; i++) {
          ctx.lineTo(outlinePoints[i][0], outlinePoints[i][1]);
        }
        ctx.closePath();
        ctx.fill();
      }
    }
    
    ctx.restore();

    // 3. 物理スクリーン座標での装飾描画（ズームの影響を受けないHUD等）
    // 消しゴムツール使用時のガイドライン（円）を表示
    if (tool === "eraser" && pointerPos && !isReplaying && !isPanning) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(pointerPos.x, pointerPos.y, eraserWidth / 2, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(239, 68, 68, 0.8)";
      ctx.lineWidth = 1.5;
      ctx.fillStyle = "rgba(239, 68, 68, 0.12)";
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }, [strokes, currentStroke, tool, pointerPos, eraserWidth, brushColor, brushWidth, isReplaying, pan, zoom, dimensions, bgImage, isPanning]);

  // strokes, transform 等の変化時に再描画
  useEffect(() => {
    draw();
  }, [draw]);

  // Pointer Events ハンドラ
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isReplaying) return;
    
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.setPointerCapture(e.pointerId);
    }
    
    const rect = canvas?.getBoundingClientRect() || new DOMRect();
    const screenX = e.clientX;
    const screenY = e.clientY;
    
    // タッチデバイスでのジェスチャー操作 (指でのマルチタッチ)
    if (e.pointerType === "touch") {
      activePointersRef.current.set(e.pointerId, { clientX: screenX, clientY: screenY });
      
      if (activePointersRef.current.size === 1) {
        // 1本指タッチはスクロール（パン）の開始
        setIsPanning(true);
        lastPanPosRef.current = { x: screenX, y: screenY };
      } else if (activePointersRef.current.size === 2) {
        // 2本指タッチはピンチズームの開始
        setIsPanning(false);
        const pts = Array.from(activePointersRef.current.values());
        const d = Math.sqrt(Math.pow(pts[0].clientX - pts[1].clientX, 2) + Math.pow(pts[0].clientY - pts[1].clientY, 2));
        pinchStartDistanceRef.current = d;
        pinchStartZoomRef.current = zoom;
      }
      return;
    }

    // PCでの右クリックドラッグ または スペースキー押しながらの左ドラッグはパンとして処理
    const isPcPan = e.pointerType === "mouse" && (e.button === 2 || e.buttons === 2 || spacePressedRef.current);
    if (isPcPan) {
      setIsPanning(true);
      lastPanPosRef.current = { x: screenX, y: screenY };
      e.preventDefault();
      return;
    }

    // それ以外 (Apple Pencil 描画、または通常のマウス左クリック描画)
    if (e.button === 0) { // 左ボタンのみ
      setIsDrawing(true);
      const worldPos = screenToWorld(screenX, screenY, rect);
      const pressure = e.pointerType === "pen" ? e.pressure : 0.5;
      const now = Date.now();

      const newStroke: Stroke = {
        strokeId: `${tool === "pen" ? "s" : "e"}_${now}_${Math.random().toString(36).substr(2, 9)}`,
        type: tool === "pen" ? "draw" : "erase",
        startTime: now,
        endTime: now,
        points: [{ x: worldPos.x, y: worldPos.y, p: pressure, t: 0 }],
        color: tool === "pen" ? brushColor : undefined,
        width: tool === "pen" ? brushWidth : eraserWidth,
        targetStrokeIds: tool === "eraser" ? [] : undefined,
      };

      setCurrentStroke(newStroke);
      setPointerPos({ x: screenX - rect.left, y: screenY - rect.top });

      if (tool === "eraser") {
        performObjectErasing(worldPos, newStroke);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const screenX = e.clientX;
    const screenY = e.clientY;

    // 現在のHUD表示用座標の更新
    setPointerPos({ x: screenX - rect.left, y: screenY - rect.top });

    // 指でのパン＆ズーム処理
    if (e.pointerType === "touch" && activePointersRef.current.has(e.pointerId)) {
      activePointersRef.current.set(e.pointerId, { clientX: screenX, clientY: screenY });

      if (activePointersRef.current.size === 1 && isPanning && lastPanPosRef.current) {
        // 1本指パン
        const dx = screenX - lastPanPosRef.current.x;
        const dy = screenY - lastPanPosRef.current.y;
        setPan((prev) => clampPan(prev.x + dx, prev.y + dy, zoom));
        lastPanPosRef.current = { x: screenX, y: screenY };
      } else if (activePointersRef.current.size === 2 && pinchStartDistanceRef.current && pinchStartZoomRef.current !== null) {
        // 2本指ピンチズーム & パン
        const pts = Array.from(activePointersRef.current.values());
        const currentDist = Math.sqrt(Math.pow(pts[0].clientX - pts[1].clientX, 2) + Math.pow(pts[0].clientY - pts[1].clientY, 2));
        
        // ズーム倍率の計算
        const zoomFactor = currentDist / pinchStartDistanceRef.current;
        const nextZoom = Math.max(0.1, Math.min(10, pinchStartZoomRef.current * zoomFactor));

        // 2点の中点 (ピボット)
        const midX = (pts[0].clientX + pts[1].clientX) / 2;
        const midY = (pts[0].clientY + pts[1].clientY) / 2;

        // ピボット基準のズームとパン
        setZoom((prevZoom) => {
          const mouseWorldX = (midX - rect.left - pan.x) / prevZoom;
          const mouseWorldY = (midY - rect.top - pan.y) / prevZoom;
          
          const targetPanX = midX - rect.left - mouseWorldX * nextZoom;
          const targetPanY = midY - rect.top - mouseWorldY * nextZoom;

          setPan(clampPan(targetPanX, targetPanY, nextZoom));
          return nextZoom;
        });
      }
      return;
    }

    // PC用ドラッグによるパン処理
    if (isPanning && lastPanPosRef.current) {
      const dx = screenX - lastPanPosRef.current.x;
      const dy = screenY - lastPanPosRef.current.y;
      setPan((prev) => clampPan(prev.x + dx, prev.y + dy, zoom));
      lastPanPosRef.current = { x: screenX, y: screenY };
      return;
    }

    // ペン/マウス描画処理
    if (!isDrawing || !currentStroke || isReplaying) return;

    const worldPos = screenToWorld(screenX, screenY, rect);
    const pressure = e.pointerType === "pen" ? e.pressure : 0.5;
    const elapsed = Date.now() - currentStroke.startTime;

    const newPoint: Point = { x: worldPos.x, y: worldPos.y, p: pressure, t: elapsed };
    const updatedStroke = {
      ...currentStroke,
      points: [...currentStroke.points, newPoint],
    };

    setCurrentStroke(updatedStroke);

    if (tool === "eraser") {
      performObjectErasing(worldPos, updatedStroke);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.releasePointerCapture(e.pointerId);
    }

    if (e.pointerType === "touch") {
      activePointersRef.current.delete(e.pointerId);
      if (activePointersRef.current.size < 2) {
        pinchStartDistanceRef.current = null;
        pinchStartZoomRef.current = null;
      }
      if (activePointersRef.current.size === 0) {
        setIsPanning(false);
        lastPanPosRef.current = null;
      }
      return;
    }

    if (isPanning) {
      setIsPanning(false);
      lastPanPosRef.current = null;
      return;
    }

    if (!isDrawing || !currentStroke || isReplaying) return;

    const now = Date.now();
    const finalStroke: Stroke = {
      ...currentStroke,
      endTime: now,
    };

    setStrokes((prev) => [...prev, finalStroke]);
    setIsDrawing(false);
    setCurrentStroke(null);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === "touch") {
      activePointersRef.current.delete(e.pointerId);
    }
    setIsDrawing(false);
    setIsPanning(false);
    setCurrentStroke(null);
    lastPanPosRef.current = null;
  };

  // 右クリックメニューの無効化 (PC用パン操作と競合するため)
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  // ワールド座標系でのオブジェクト消しゴム判定
  const performObjectErasing = (worldPos: { x: number; y: number }, activeEraserStroke: Stroke) => {
    // ズームに応じたワールド座標系での消しゴムサイズ閾値
    // ズームアウトしているほど、画面上の消しゴムの見かけの物理サイズは大きくなるため
    // ワールド座標系では (eraserWidth / 2) / zoom に比例させる
    const worldThreshold = (eraserWidth / 2) / zoom + 10;
    
    const getDistance = (p1: { x: number; y: number }, p2: { x: number; y: number }) => {
      return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
    };

    setStrokes((prevStrokes) => {
      const newStrokes = prevStrokes.map((stroke) => {
        if (stroke.type !== "draw" || stroke.isErased) return stroke;

        // ワールド座標同士での近接判定
        const isClose = stroke.points.some(
          (point) => getDistance(worldPos, point) < worldThreshold
        );

        if (isClose) {
          if (activeEraserStroke.targetStrokeIds && !activeEraserStroke.targetStrokeIds.includes(stroke.strokeId)) {
            activeEraserStroke.targetStrokeIds.push(stroke.strokeId);
          }

          return {
            ...stroke,
            isErased: true,
            erasedAt: Date.now(),
          };
        }
        return stroke;
      });

      return newStrokes;
    });
  };

  return (
    <div
      ref={containerRef}
      className="no-scroll-touch relative w-full h-full flex items-center justify-center bg-slate-100 overflow-hidden"
      style={{
        touchAction: "none",
        overscrollBehavior: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        width={dimensions.width}
        height={dimensions.height}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onContextMenu={handleContextMenu}
        className="no-scroll-touch absolute top-0 left-0 w-full h-full cursor-crosshair z-10 bg-white shadow-inner"
        style={{
          touchAction: "none",
          overscrollBehavior: "none",
        }}
      />
    </div>
  );
}
