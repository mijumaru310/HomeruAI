"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { getStroke } from "perfect-freehand";
import { Stroke, Point } from "../types/canvas";

interface CanvasProps {
  strokes: Stroke[];
  setStrokes: React.Dispatch<React.SetStateAction<Stroke[]>>;
  tool: "pen" | "eraser";
  brushColor: string;
  brushWidth: number;
  eraserWidth: number;
  bgImageUrl: string;
  isReplaying: boolean;
}

// 描画座標系を 1024x768 で統一（マルチデバイス間・バックエンド連携のため）
export const CANVAS_WIDTH = 1024;
export const CANVAS_HEIGHT = 768;

export default function Canvas({
  strokes,
  setStrokes,
  tool,
  brushColor,
  brushWidth,
  eraserWidth,
  bgImageUrl,
  isReplaying,
}: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentStroke, setCurrentStroke] = useState<Stroke | null>(null);
  const [eraserPosition, setEraserPosition] = useState<{ x: number; y: number } | null>(null);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 0, height: 0 });

  // コンテナのサイズに応じて4:3のアスペクト比を保ちつつ、はみ出さないサイズを動的計算
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries || entries.length === 0) return;
      const { width, height } = entries[0].contentRect;

      const targetRatio = CANVAS_WIDTH / CANVAS_HEIGHT;
      const containerRatio = width / height;

      let finalWidth = 0;
      let finalHeight = 0;

      if (containerRatio > targetRatio) {
        // 親コンテナが横長 -> 高さいっぱいにフィット
        finalHeight = height;
        finalWidth = height * targetRatio;
      } else {
        // 親コンテナが縦長 -> 幅いっぱいにフィット
        finalWidth = width;
        finalHeight = width / targetRatio;
      }

      setCanvasDimensions({ width: finalWidth, height: finalHeight });
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  // スクリーン座標からCanvas論理座標（1024x768）への変換
  const getCanvasCoords = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    
    // スケーリング比率を考慮して変換
    const x = ((e.clientX - rect.left) / rect.width) * CANVAS_WIDTH;
    const y = ((e.clientY - rect.top) / rect.height) * CANVAS_HEIGHT;
    return { x, y };
  }, []);

  // 2点間の距離を計算
  const getDistance = (p1: { x: number; y: number }, p2: { x: number; y: number }) => {
    return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
  };

  // 描画処理
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // キャンバスをクリア
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // 保存されているストロークを描画
    strokes.forEach((stroke) => {
      // 消去されている、または描画以外のストロークは描画しない（消しゴム軌跡自体は表示しない）
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

    // 消しゴムツールの時に、消しゴムのガイドライン（円）を表示
    if (tool === "eraser" && eraserPosition && !isReplaying) {
      ctx.beginPath();
      ctx.arc(eraserPosition.x, eraserPosition.y, eraserWidth / 2, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(239, 68, 68, 0.8)";
      ctx.lineWidth = 2;
      ctx.fillStyle = "rgba(239, 68, 68, 0.15)";
      ctx.fill();
      ctx.stroke();
    }
  }, [strokes, currentStroke, tool, eraserPosition, eraserWidth, brushColor, brushWidth, isReplaying]);

  // strokes または currentStroke が変わったときに再描画
  useEffect(() => {
    draw();
  }, [draw]);

  // Pointer Events ハンドラ
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isReplaying) return;
    
    // タッチデバイスのジェスチャー誤動作を防止するため、ブラウザ既定の挙動をブロックする
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.setPointerCapture(e.pointerId);
    }

    const { x, y } = getCanvasCoords(e);
    const pressure = e.pointerType === "touch" || e.pointerType === "pen" ? e.pressure : 0.5;
    const now = Date.now();

    setIsDrawing(true);

    const newStroke: Stroke = {
      strokeId: `${tool === "pen" ? "s" : "e"}_${now}_${Math.random().toString(36).substr(2, 9)}`,
      type: tool === "pen" ? "draw" : "erase",
      startTime: now,
      endTime: now,
      points: [{ x, y, p: pressure, t: 0 }],
      color: tool === "pen" ? brushColor : undefined,
      width: tool === "pen" ? brushWidth : eraserWidth,
      targetStrokeIds: tool === "eraser" ? [] : undefined,
    };

    setCurrentStroke(newStroke);

    if (tool === "eraser") {
      setEraserPosition({ x, y });
      performObjectErasing({ x, y }, newStroke);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !currentStroke || isReplaying) {
      // 描画中ではないが消しゴムツールの場合、ガイド円を動かすために位置更新
      if (tool === "eraser" && !isReplaying) {
        const { x, y } = getCanvasCoords(e);
        setEraserPosition({ x, y });
      } else {
        setEraserPosition(null);
      }
      return;
    }

    const { x, y } = getCanvasCoords(e);
    const pressure = e.pointerType === "touch" || e.pointerType === "pen" ? e.pressure : 0.5;
    const elapsed = Date.now() - currentStroke.startTime;

    const newPoint: Point = { x, y, p: pressure, t: elapsed };
    const updatedStroke = {
      ...currentStroke,
      points: [...currentStroke.points, newPoint],
    };

    setCurrentStroke(updatedStroke);

    if (tool === "eraser") {
      setEraserPosition({ x, y });
      performObjectErasing({ x, y }, updatedStroke);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !currentStroke || isReplaying) return;

    const canvas = canvasRef.current;
    if (canvas) {
      canvas.releasePointerCapture(e.pointerId);
    }

    const now = Date.now();
    const finalStroke: Stroke = {
      ...currentStroke,
      endTime: now,
    };

    setStrokes((prev) => [...prev, finalStroke]);
    setIsDrawing(false);
    setCurrentStroke(null);
    setEraserPosition(null);
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDrawing(false);
    setCurrentStroke(null);
    setEraserPosition(null);
  };

  // オブジェクト消しゴムの消去処理
  const performObjectErasing = (
    eraserPt: { x: number; y: number },
    activeEraserStroke: Stroke
  ) => {
    const threshold = eraserWidth / 2 + 10; // 消しゴム半径 + マージン
    let strokeErased = false;

    // 現在のstrokesの中で、まだ消去されていない "draw" ストロークを対象に判定
    setStrokes((prevStrokes) => {
      const newStrokes = prevStrokes.map((stroke) => {
        if (stroke.type !== "draw" || stroke.isErased) return stroke;

        // 消しゴムポインターと、ストローク内の全ポイントとの距離をチェック
        const isClose = stroke.points.some(
          (point) => getDistance(eraserPt, point) < threshold
        );

        if (isClose) {
          strokeErased = true;
          
          // 消しゴムストロークの消去対象IDリストに追加
          if (activeEraserStroke.targetStrokeIds && !activeEraserStroke.targetStrokeIds.includes(stroke.strokeId)) {
            activeEraserStroke.targetStrokeIds.push(stroke.strokeId);
          }

          // 論理消去フラグと消去時間を付与してコピーを返す
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
      className="no-scroll-touch relative w-full h-full flex items-center justify-center bg-slate-900 overflow-hidden"
      style={{
        touchAction: "none",
        overscrollBehavior: "none",
      }}
    >
      {/* 描画キャンバスのコンテナ (アスペクト比 4:3 フィット) */}
      <div
        className="no-scroll-touch relative rounded-lg overflow-hidden shadow-2xl border border-slate-700 bg-slate-800"
        style={{
          width: canvasDimensions.width > 0 ? `${canvasDimensions.width}px` : "100%",
          height: canvasDimensions.height > 0 ? `${canvasDimensions.height}px` : "auto",
          aspectRatio: canvasDimensions.width > 0 ? undefined : "4/3",
          backgroundImage: `url(${bgImageUrl})`,
          backgroundSize: "contain",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
          touchAction: "none",
          overscrollBehavior: "none",
        }}
      >
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          className="no-scroll-touch absolute top-0 left-0 w-full h-full cursor-crosshair z-10"
          style={{
            touchAction: "none",
            overscrollBehavior: "none",
          }}
        />
      </div>
    </div>
  );
}
