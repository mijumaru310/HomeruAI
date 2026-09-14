import { Stroke } from "../types/canvas";

/**
 * 最後の筆記操作を履歴として残したまま取り消す。
 * 消しゴム操作では、対象の筆跡を復元して消しゴム軌跡だけを無効化する。
 */
export function undoLastStrokeAction(strokes: Stroke[], timestamp = Date.now()): Stroke[] {
  const lastAction = strokes
    .filter(stroke => !stroke.isErased)
    .reduce<Stroke | null>((latest, stroke) =>
      !latest || stroke.endTime > latest.endTime ? stroke : latest
    , null);

  if (!lastAction) return strokes;

  if (lastAction.type === "draw") {
    return strokes.map(stroke => stroke.strokeId === lastAction.strokeId
      ? { ...stroke, isErased: true, erasedAt: timestamp }
      : stroke
    );
  }

  const targetIds = new Set(lastAction.targetStrokeIds ?? []);
  return strokes.map(stroke => {
    if (stroke.strokeId === lastAction.strokeId) {
      return { ...stroke, isErased: true, erasedAt: timestamp };
    }
    if (lastAction.type === "erase" && targetIds.has(stroke.strokeId)) {
      return { ...stroke, isErased: false, erasedAt: undefined };
    }
    return stroke;
  });
}
