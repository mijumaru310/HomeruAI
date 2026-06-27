import { Stroke, CanvasImage } from "../types/canvas";
import { getStroke } from "perfect-freehand";

export const generateGhostRender = async (strokes: Stroke[], refImage: CanvasImage | null): Promise<{ image: string }> => {
  // 背景画像がない場合は、ストローク情報のみを白いキャンバスに描画して送信する
  if (!refImage) {
    console.warn("背景画像が設定されていません。ストロークデータのみで画像を生成します。");
    if (strokes.length === 0) {
      return { image: "" };
    }

    // ストロークのバウンディングボックスを算出
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const stroke of strokes) {
      if (stroke.type !== "draw" || stroke.points.length === 0) continue;
      for (const p of stroke.points) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
      }
    }

    // ストロークの座標が得られなかった場合は空を返す
    if (minX === Infinity || minY === Infinity) {
      return { image: "" };
    }

    // 余白（マージン）の設定
    const margin = 40;
    let width = maxX - minX + margin * 2;
    let height = maxY - minY + margin * 2;
    
    // オフセット（左上の座標）
    const offsetX = minX - margin;
    const offsetY = minY - margin;

    // 最大サイズの制限 (大きすぎる画像によるペイロードエラーやメモリ不足を防止)
    const MAX_DIM = 2000;
    let scale = 1;
    if (width > MAX_DIM || height > MAX_DIM) {
      scale = Math.min(MAX_DIM / width, MAX_DIM / height);
      width = width * scale;
      height = height * scale;
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(width);
    canvas.height = Math.floor(height);

    const ctx = canvas.getContext("2d");
    if (!ctx) return { image: "" };

    // 背景を白で初期化
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // スケール適用
    if (scale !== 1) {
      ctx.scale(scale, scale);
    }

    const sortedStrokes = [...strokes].sort((a, b) => a.startTime - b.startTime);

    for (const stroke of sortedStrokes) {
      if (stroke.type !== "draw" || stroke.points.length === 0) continue;

      ctx.fillStyle = stroke.isErased ? "rgba(239, 68, 68, 0.3)" : (stroke.color || "#000000");

      const pts = stroke.points.map(p => [
        p.x - offsetX, 
        p.y - offsetY, 
        p.p
      ] as [number, number, number]);
      
      const outline = getStroke(pts, { 
        size: (stroke.width || 4) / scale, 
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

    return { image: canvas.toDataURL("image/jpeg", 0.8) };
  }

  const canvas = document.createElement("canvas");
  
  // ① キャンバスのサイズを「背景画像」と完全にピッタリ同じサイズにする
  canvas.width = refImage.width;
  canvas.height = refImage.height;
  
  const ctx = canvas.getContext("2d");
  if (!ctx) return { image: "" };

  // 背景を白で初期化
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ② 背景画像をキャンバスの(0, 0)にピッタリ配置
  const img = new Image();
  img.src = refImage.url;
  await new Promise((resolve) => {
    img.onload = resolve;
  });
  ctx.drawImage(img, 0, 0, refImage.width, refImage.height);

  // ③ ストロークの描画（時系列順）
  const sortedStrokes = [...strokes].sort((a, b) => a.startTime - b.startTime);

  for (const stroke of sortedStrokes) {
    if (stroke.type !== "draw" || stroke.points.length === 0) continue;

    // 消された線は半透明の赤、残っている線は黒
    ctx.fillStyle = stroke.isErased ? "rgba(239, 68, 68, 0.3)" : "#000000";
    
    // 【重要】ストロークのワールド座標から、背景画像の座標(refImage.x, refImage.y)を引いて
    // 背景画像の左上を(0,0)としたローカル座標に変換する
    const pts = stroke.points.map(p => [
      p.x - refImage.x, 
      p.y - refImage.y, 
      p.p
    ] as [number, number, number]);
    
    const outline = getStroke(pts, { 
      size: stroke.width || 4, 
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

  // AIに送りやすいように軽量なJPEGとして出力
  return { image: canvas.toDataURL("image/jpeg", 0.8) };
};