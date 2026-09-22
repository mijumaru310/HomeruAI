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

/** 筆記プロセスの位置、または通常モードで検証済みの正解位置。 */
export interface AIAnnotation {
  id: string;
  imageId: string;             // 紐づく画像のID
  type: "process_marker" | "correct_mark" | "circle" | "underline" | "text" | "stamp";  // 後半は過去の保存データとの互換用
  // 画像相対座標 (0-1000 スケール) [ymin, xmin, ymax, xmax]
  box_2d: [number, number, number, number];
  comment?: string;            // 文字書き入れの内容
  color?: string;              // 過去の保存データとの互換用。表示時は過程マークの紫色に統一する
  virtualBounds?: { x: number; y: number; width: number; height: number };
  evidenceId?: string;
}

export interface RecognizedContent {
  recognized_question?: string;
  current_answer?: string;
  erased_attempts?: string;
  observed_steps?: string[];
  solution_outline?: string[];
}

export interface AnswerEvaluation {
  status: "correct" | "incorrect" | "partial" | "unknown";
  learner_answer?: string;
  expected_answer?: string;
  explanation?: string;
  confidence: number;
}

export interface AnalysisResponseData {
  thought_type_badge: string;
  feedback_condition?: "process_praise" | "neutral_summary";
  praise_points: string[];
  encouragement_message?: string;
  recognized_content?: RecognizedContent;
  answer_evaluation?: AnswerEvaluation;
  summary?: string;
  source?: "ai" | "hybrid" | "local_fallback";
  provider_error_category?: "configuration" | "auth" | "quota" | "model" | "schema" | "timeout" | "temporary" | "network" | "unknown";
  notice?: string;
  process_metrics?: ProcessMetrics;
  process_evidence?: ProcessEvidence[];
  praise_evidence?: PraiseEvidence[];
  learner_state?: LearnerState;
  intervention?: AdaptiveIntervention;
  recognition_confidence?: number;
  recognition_uncertainties?: string[];
  skill_tags?: string[];
  analysis_id?: string;
  annotations: {
    box_2d: [number, number, number, number];
    type: "process_marker" | "correct_mark" | "circle" | "underline" | "text" | "stamp";
    comment?: string;
    evidence_id?: string;
  }[];
}

export interface ProcessMetrics {
  stroke_count: number;
  erased_stroke_count: number;
  revision_count: number;
  pause_count: number;
  longest_pause_seconds: number;
  active_writing_seconds: number;
  session_seconds: number;
  productive_pause_count?: number;
  unresolved_pause_count?: number;
  restart_count?: number;
  successful_revision_count?: number;
  repeated_region_count?: number;
}

export interface ProcessEvidence {
  evidence_id: string;
  kind: string;
  description: string;
  start_time: number;
  end_time: number;
  duration_seconds: number;
  bounding_box?: number[];
  stroke_ids: string[];
}

export interface PraiseEvidence {
  evidence_id: string;
  message: string;
}

export interface LearnerState {
  mastery: number;
  autonomous_engagement: number;
  support_need: number;
  persistence: number;
  confidence: number;
  reasons: string[];
  model_version: string;
}

export interface AdaptiveIntervention {
  action: "wait" | "micro_praise" | "offer_hint" | "metacognitive_question" | "challenge";
  message: string;
  hint_levels: string[];
  trigger_after_seconds: number;
  evidence_id?: string;
  policy_version: string;
}

export interface AssistResponseData {
  learner_state: LearnerState;
  intervention: AdaptiveIntervention;
  process_metrics: ProcessMetrics;
}

export interface GrowthPoint {
  timestamp: string;
  mastery: number;
  autonomous_engagement: number;
  support_need: number;
  persistence: number;
  confidence: number;
  model_version: string;
}

export interface LearnerDashboardData {
  learner_id: string;
  state: LearnerState;
  sample_count: number;
  updated_at: string;
  level: number;
  total_xp: number;
  level_xp: number;
  xp_to_next_level: number;
  total_analyses: number;
  total_sessions: number;
  total_strokes: number;
  total_revisions: number;
  total_restarts: number;
  streak_days: number;
  achievements: string[];
  history: GrowthPoint[];
}

export interface PointerDiagnostics {
  pointerType: "pen" | "touch" | "mouse" | "unknown";
  pressure: number;
  tiltX: number;
  tiltY: number;
  width: number;
  height: number;
  coalescedSamples: number;
  palmTouchesIgnored: number;
  updatedAt: number;
}
