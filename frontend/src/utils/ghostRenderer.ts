import { Stroke, CanvasImage } from "../types/canvas";

export interface GhostRenderResult {
  image: string;
  /** 基準となった画像の情報（AIマーク座標の基準） */
  referenceImage: {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

/**
 * 画像基準のGhost Render生成
 *
 * 問題画像を(0,0)に配置し、ストロークを画像相対座標でオーバーレイする。
 * これにより、Geminiが返す0-1000座標 = 画像相対座標となり、変換ロスがゼロになる。
 */
export const generateGhostRender = async (
  strokes: Stroke[],
  refImage: CanvasImage | null,
): Promise<GhostRenderResult> => {
  // 画像がない場合: ストロークのみからレンダリング
  if (!refImage) {
    return generateStrokeOnlyRender(strokes);
  }

  const imgW = refImage.width;
  const imgH = refImage.height;

  const canvas = document.createElement("canvas");
  canvas.width = imgW;
  canvas.height = imgH;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Failed to get 2D context for ghost rendering.");
  }

  // 背景を白で塗りつぶす
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, imgW, imgH);

  // 問題画像を(0,0)に描画
  await new Promise<void>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, imgW, imgH);
      resolve();
    };
    img.onerror = () => reject(new Error("Failed to load reference image"));
    img.src = refImage.url;
  });

  // ストロークを画像相対座標でオーバーレイ描画
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;
    if (stroke.type !== "draw") continue;

    ctx.beginPath();
    // ストロークのワールド座標 → 画像相対座標に変換
    ctx.moveTo(
      stroke.points[0].x - refImage.x,
      stroke.points[0].y - refImage.y
    );
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(
        stroke.points[i].x - refImage.x,
        stroke.points[i].y - refImage.y
      );
    }

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = stroke.width ? stroke.width * 1.5 : 4;

    if (stroke.isErased) {
      ctx.strokeStyle = "rgba(255, 0, 0, 0.3)";
    } else {
      ctx.strokeStyle = "#000000";
    }
    ctx.stroke();
  }

  return {
    image: canvas.toDataURL("image/png"),
    referenceImage: {
      id: refImage.id,
      x: refImage.x,
      y: refImage.y,
      width: refImage.width,
      height: refImage.height,
    },
  };
};

/** ストロークのみの場合のフォールバック */
async function generateStrokeOnlyRender(
  strokes: Stroke[]
): Promise<GhostRenderResult> {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const stroke of strokes) {
    if (stroke.type !== "draw" || stroke.points.length === 0) continue;
    for (const pt of stroke.points) {
      minX = Math.min(minX, pt.x);
      minY = Math.min(minY, pt.y);
      maxX = Math.max(maxX, pt.x);
      maxY = Math.max(maxY, pt.y);
    }
  }

  if (minX === Infinity) {
    minX = 0; minY = 0; maxX = 800; maxY = 600;
  }

  const margin = 40;
  minX -= margin; minY -= margin;
  maxX += margin; maxY += margin;

  const w = Math.max(400, Math.ceil(maxX - minX));
  const h = Math.max(300, Math.ceil(maxY - minY));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get 2D context");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);

  for (const stroke of strokes) {
    if (stroke.points.length === 0 || stroke.type !== "draw") continue;
    ctx.beginPath();
    ctx.moveTo(stroke.points[0].x - minX, stroke.points[0].y - minY);
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x - minX, stroke.points[i].y - minY);
    }
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = stroke.width ? stroke.width * 1.5 : 4;
    ctx.strokeStyle = stroke.isErased ? "rgba(255,0,0,0.3)" : "#000000";
    ctx.stroke();
  }

  return {
    image: canvas.toDataURL("image/png"),
    referenceImage: null,
  };
}
