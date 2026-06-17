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
