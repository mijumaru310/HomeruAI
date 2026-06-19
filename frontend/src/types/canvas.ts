export interface Point {
  x: number;
  y: number;
  p: number; // pressure (0.0 to 1.0)
  t: number; // relative time (ms) from the start of this stroke
}

export interface Stroke {
  strokeId: string;
  type: "draw" | "erase" | "pixel-erase";
  startTime: number; // absolute timestamp (ms)
  endTime: number;   // absolute timestamp (ms)
  points: Point[];
  color?: string;    // CSS color string (optional, defaults to black/white)
  width?: number;    // Brush width
  isErased?: boolean; // Logical deletion flag
  erasedAt?: number;  // Timestamp when it was erased
  targetStrokeIds?: string[]; // If type: "erase", records which stroke IDs this erase stroke deleted
}

export interface CanvasImage {
  id: string;
  url: string;
  x: number;
  y: number;
  width: number;
  height: number;
  name: string;
  rotation?: number;
}

export interface CanvasText {
  id: string;
  text: string;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  fontWeight: "normal" | "bold";
  fontStyle: "normal" | "italic";
  textDecoration: "none" | "underline";
  width?: number;
  height?: number;
}

/** AIが画像上に付けるアノテーション（画像相対座標で管理） */
export interface AIAnnotation {
  id: string;
  imageId: string;             // 紐づく画像のID
  type: "circle" | "underline" | "text";  // ○、下線、文字書き入れ
  // 画像相対座標 (0-1000 スケール) [ymin, xmin, ymax, xmax]
  box_2d: [number, number, number, number];
  comment?: string;            // 文字書き入れの内容
  color?: string;              // 色 (default: circle=#107c41, underline/text=#e81123)
}
