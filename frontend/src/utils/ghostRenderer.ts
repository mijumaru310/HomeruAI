import { Stroke, CanvasImage } from "../types/canvas";
import { getStroke } from "perfect-freehand";

export const generateGhostRender = async (
  strokes: Stroke[],
  refImage: CanvasImage | null
): Promise<{
  image: string;
  virtualBounds?: { x: number; y: number; width: number; height: number };
}> => {
  // 背景画像がない場合（白紙キャンバス）
  if (!refImage) {
    if (strokes.length === 0) {
      return { image: "" };
    }

    // ストロークのバウンディングボックスを算出
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const stroke of strokes) {
      if (stroke.points.length === 0) continue;
      for (const p of stroke.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }

    if (minX === Infinity || minY === Infinity) {
      return { image: "" };
    }

    const margin = 60;
    let width = maxX - minX + margin * 2;
    let height = maxY - minY + margin * 2;
    const origWidth = width;
    const origHeight = height;
    
    const offsetX = minX - margin;
    const offsetY = minY - margin;

    // 解像度制限（最大1200px: 鮮明さと高速通信・安定性を両立）
    const MAX_DIM = 1200;
    let scale = 1;
    if (width > MAX_DIM || height > MAX_DIM) {
      scale = Math.min(MAX_DIM / width, MAX_DIM / height);
      width = width * scale;
      height = height * scale;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(300, Math.floor(width));
    canvas.height = Math.max(300, Math.floor(height));

    const ctx = canvas.getContext("2d");
    if (!ctx) return { image: "" };

    // 背景を白で初期化
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    if (scale !== 1) {
      ctx.scale(scale, scale);
    }

    const sortedStrokes = [...strokes].sort((a, b) => a.startTime - b.startTime);

    for (const stroke of sortedStrokes) {
      if (stroke.points.length === 0) continue;

      const pts = stroke.points.map(p => [
        p.x - offsetX, 
        p.y - offsetY, 
        p.p
      ] as [number, number, number]);

      if (stroke.type === "pixel-erase") {
        if (stroke.isErased) continue;
        // ピクセル消しゴムは白で上書き（背景色）
        const outline = getStroke(pts, { 
          size: (stroke.width || 30) / scale, 
          thinning: 0, 
          smoothing: 0.5, 
          streamline: 0.5 
        });
        if (outline.length === 0) continue;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(outline[0][0], outline[0][1]);
        for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1]);
        ctx.closePath();
        ctx.fill();
        continue;
      }

      if (stroke.type !== "draw") continue;

      // 消去された線は高コントラストな鮮明赤、残っている線は濃い黒
      ctx.fillStyle = stroke.isErased ? "rgba(225, 29, 72, 0.75)" : (stroke.color || "#0f172a");

      const outline = getStroke(pts, { 
        size: Math.max(3, (stroke.width || 4) / scale), 
        thinning: 0.5, 
        smoothing: 0.5, 
        streamline: 0.5 
      });
      
      if (outline.length === 0) continue;

      ctx.beginPath();
      ctx.moveTo(outline[0][0], outline[0][1]);
      for (let i = 1; i < outline.length; i++) {
        ctx.lineTo(outline[i][0], outline[i][1]);
      }
      ctx.closePath();
      ctx.fill();
    }

    // 可逆圧縮の PNG で送信し、OCRと薄い赤線の認識精度を最大化
    return { 
      image: canvas.toDataURL("image/png"),
      virtualBounds: { x: offsetX, y: offsetY, width: origWidth, height: origHeight }
    };
  }

  // 背景画像がある場合
  const MAX_DIM = 1200;
  let renderWidth = refImage.width;
  let renderHeight = refImage.height;
  let bgScale = 1;

  if (renderWidth > MAX_DIM || renderHeight > MAX_DIM) {
    bgScale = Math.min(MAX_DIM / renderWidth, MAX_DIM / renderHeight);
    renderWidth = Math.max(300, Math.floor(renderWidth * bgScale));
    renderHeight = Math.max(300, Math.floor(renderHeight * bgScale));
  }

  const canvas = document.createElement("canvas");
  canvas.width = renderWidth;
  canvas.height = renderHeight;
  
  const ctx = canvas.getContext("2d");
  if (!ctx) return { image: "" };

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 背景画像を配置
  const img = new Image();
  img.src = refImage.url;
  await new Promise((resolve) => {
    img.onload = resolve;
    img.onerror = resolve;
  });
  ctx.drawImage(img, 0, 0, renderWidth, renderHeight);

  if (bgScale !== 1) {
    ctx.scale(bgScale, bgScale);
  }

  // 解像度に応じた線幅スケーリング
  const adaptiveScale = Math.max(1, (refImage.width / 900) * bgScale);

  const sortedStrokes = [...strokes].sort((a, b) => a.startTime - b.startTime);

  for (const stroke of sortedStrokes) {
    if (stroke.points.length === 0) continue;

    const pts = stroke.points.map(p => [
      p.x - refImage.x, 
      p.y - refImage.y, 
      p.p
    ] as [number, number, number]);

    if (stroke.type === "pixel-erase") {
      if (stroke.isErased) continue;
      const outline = getStroke(pts, { 
        size: (stroke.width || 30) * adaptiveScale, 
        thinning: 0, 
        smoothing: 0.5, 
        streamline: 0.5 
      });
      if (outline.length === 0) continue;
      // ピクセル消しゴム部分を背景再描画風に白、または半透明赤でマスク
      ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
      ctx.beginPath();
      ctx.moveTo(outline[0][0], outline[0][1]);
      for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i][0], outline[i][1]);
      ctx.closePath();
      ctx.fill();
      continue;
    }

    if (stroke.type !== "draw") continue;

    // 消された線は鮮明な赤、残っている線は黒
    ctx.fillStyle = stroke.isErased ? "rgba(225, 29, 72, 0.75)" : "#0f172a";
    
    const strokeWidth = Math.max(3, (stroke.width || 4) * adaptiveScale);
    const outline = getStroke(pts, { 
      size: strokeWidth, 
      thinning: 0.5, 
      smoothing: 0.5, 
      streamline: 0.5 
    });
    
    if (outline.length === 0) continue;

    ctx.beginPath();
    ctx.moveTo(outline[0][0], outline[0][1]);
    for (let i = 1; i < outline.length; i++) {
      ctx.lineTo(outline[i][0], outline[i][1]);
    }
    ctx.closePath();
    ctx.fill();
  }

  // 高画質 PNG で出力
  return { image: canvas.toDataURL("image/png") };
};
