import { useState, useCallback } from "react";

export interface Pan {
  x: number;
  y: number;
}

export function useCanvasTransform() {
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState<number>(1);

  // スクリーン座標（ピクセル）からキャンバスのワールド絶対座標への変換
  const toWorldCoords = useCallback(
    (screenX: number, screenY: number, rect: DOMRect) => {
      const x = (screenX - rect.left - pan.x) / zoom;
      const y = (screenY - rect.top - pan.y) / zoom;
      return { x, y };
    },
    [pan, zoom]
  );

  // キャンバスのワールド絶対座標からスクリーン座標（ピクセル）への逆変換
  const toScreenCoords = useCallback(
    (worldX: number, worldY: number, rect: DOMRect) => {
      const x = worldX * zoom + pan.x + rect.left;
      const y = worldY * zoom + pan.y + rect.top;
      return { x, y };
    },
    [pan, zoom]
  );

  // 平行移動（パン）の更新
  const updatePan = useCallback((dx: number, dy: number) => {
    setPan((prev) => ({ x: prev.x + dx, y: prev.y + dy }));
  }, []);

  // 特定のポインター座標を基準点（ピボット）としたズーム処理
  const updateZoom = useCallback(
    (zoomFactor: number, clientX: number, clientY: number, rect: DOMRect) => {
      setZoom((prevZoom) => {
        // ズーム倍率を 0.1倍〜10倍 にクランプ
        const nextZoom = Math.max(0.1, Math.min(10, prevZoom * zoomFactor));
        
        // ズーム比率が変わった際に基準点がズレないよう、パン（スクロール位置）を再計算
        const mouseWorldX = (clientX - rect.left - pan.x) / prevZoom;
        const mouseWorldY = (clientY - rect.top - pan.y) / prevZoom;

        setPan({
          x: clientX - rect.left - mouseWorldX * nextZoom,
          y: clientY - rect.top - mouseWorldY * nextZoom,
        });

        return nextZoom;
      });
    },
    [pan]
  );

  // トランスフォームのリセット
  const resetTransform = useCallback(() => {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }, []);

  return {
    pan,
    setPan,
    zoom,
    setZoom,
    toWorldCoords,
    toScreenCoords,
    updatePan,
    updateZoom,
    resetTransform,
  };
}
