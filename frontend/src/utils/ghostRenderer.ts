import { Stroke } from "../types/canvas";

export const generateGhostRender = async (
  strokes: Stroke[],
  dimensions: { width: number; height: number },
  backgroundImageBase64: string | null
): Promise<string> => {
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Failed to get 2D context for ghost rendering.");
  }

  // 背景を白で塗りつぶす（透過PNG対策）
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 背景画像がある場合は描画
  if (backgroundImageBase64) {
    await new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        ctx.drawImage(img, 0, 0, dimensions.width, dimensions.height);
        resolve();
      };
      img.onerror = () => reject(new Error("Failed to load background image"));
      img.src = backgroundImageBase64;
    });
  }

  // ストロークの描画（Ghost Rendering）
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;

    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
    for (let i = 1; i < stroke.points.length; i++) {
      // 曲線補間なしのシンプルな直線連結で描画（Geminiへの解析目的なので十分）
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
    }

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    // ペンの太さを少し太めにして認識しやすくする
    ctx.lineWidth = stroke.width ? stroke.width * 1.5 : 4;

    if (stroke.type === "draw") {
      if (stroke.isErased) {
        // 消去された線：半透明の赤色
        ctx.strokeStyle = "rgba(255, 0, 0, 0.3)";
      } else {
        // 現在残っている線：黒色
        ctx.strokeStyle = "#000000";
      }
      ctx.stroke();
    }
  }

  // Base64 PNG を返す
  return canvas.toDataURL("image/png");
};
