from __future__ import annotations

from typing import Annotated, Any, Literal, Optional

from pydantic import BaseModel, Field, model_validator


NormalizedCoordinate = Annotated[int, Field(ge=0, le=1000)]
UnitScore = Annotated[float, Field(ge=0, le=1)]


class PointSchema(BaseModel):
    x: float = Field(ge=-100_000, le=100_000)
    y: float = Field(ge=-100_000, le=100_000)
    p: float = Field(ge=0, le=1)
    t: int = Field(ge=0, le=86_400_000)


class StrokeSchema(BaseModel):
    strokeId: str = Field(min_length=1, max_length=128)
    type: Literal["draw", "erase", "pixel-erase"]
    startTime: int = Field(ge=0)
    endTime: int = Field(ge=0)
    points: list[PointSchema] = Field(default_factory=list, max_length=20_000)
    boundingBox: Optional[tuple[float, float, float, float]] = None
    pointCount: Optional[int] = Field(None, ge=0, le=1_000_000)
    color: Optional[str] = Field(None, max_length=64)
    width: Optional[float] = Field(None, ge=0.1, le=500)
    isErased: bool = False
    erasedAt: Optional[int] = Field(None, ge=0)
    targetStrokeIds: Optional[list[str]] = Field(None, max_length=10_000)

    @model_validator(mode="after")
    def validate_timestamps(self):
        if self.endTime < self.startTime:
            raise ValueError("endTime must be greater than or equal to startTime")
        if self.erasedAt is not None and self.erasedAt < self.startTime:
            raise ValueError("erasedAt must be greater than or equal to startTime")
        return self


class CanvasBoundsSchema(BaseModel):
    min_x: float
    min_y: float
    width: float = Field(gt=0)
    height: float = Field(gt=0)


class AnnotationSchema(BaseModel):
    # A fixed tuple emits JSON Schema `prefixItems`, unsupported by GenAI.
    box_2d: Annotated[
        list[NormalizedCoordinate], Field(min_length=4, max_length=4)
    ] = Field(description="[ymin, xmin, ymax, xmax] normalized coordinates")
    type: Literal["circle", "underline", "text", "stamp"]
    comment: Optional[str] = Field(None, max_length=160)
    evidence_id: Optional[str] = Field(None, max_length=128)

    @model_validator(mode="after")
    def validate_box_order(self):
        ymin, xmin, ymax, xmax = self.box_2d
        if ymax <= ymin or xmax <= xmin:
            raise ValueError("box_2d must have a positive width and height")
        return self


class RecognizedContent(BaseModel):
    recognized_question: Optional[str] = Field(None, max_length=1_000)
    current_answer: Optional[str] = Field(None, max_length=1_000)
    erased_attempts: Optional[str] = Field(None, max_length=1_000)


class ProcessMetrics(BaseModel):
    stroke_count: int = Field(ge=0)
    erased_stroke_count: int = Field(ge=0)
    revision_count: int = Field(ge=0)
    pause_count: int = Field(ge=0)
    longest_pause_seconds: float = Field(ge=0)
    active_writing_seconds: float = Field(ge=0)
    session_seconds: float = Field(ge=0)
    productive_pause_count: int = Field(0, ge=0)
    unresolved_pause_count: int = Field(0, ge=0)
    restart_count: int = Field(0, ge=0)
    successful_revision_count: int = Field(0, ge=0)
    repeated_region_count: int = Field(0, ge=0)


class ProcessEvidence(BaseModel):
    evidence_id: str = Field(min_length=1, max_length=128)
    kind: Literal[
        "first_step", "writing", "pause", "productive_pause", "revision",
        "successful_revision", "restart", "persistence", "repeated_region",
    ]
    description: str = Field(min_length=1, max_length=300)
    start_time: int = Field(ge=0)
    end_time: int = Field(ge=0)
    duration_seconds: float = Field(0, ge=0)
    bounding_box: Optional[Annotated[list[float], Field(min_length=4, max_length=4)]] = None
    stroke_ids: list[str] = Field(default_factory=list, max_length=100)


class LearnerState(BaseModel):
    mastery: UnitScore
    autonomous_engagement: UnitScore
    support_need: UnitScore
    persistence: UnitScore
    confidence: UnitScore
    reasons: list[str] = Field(default_factory=list, max_length=8)
    model_version: str = "rules-v1"


class PraiseEvidence(BaseModel):
    evidence_id: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=500)


class Intervention(BaseModel):
    action: Literal["wait", "micro_praise", "offer_hint", "metacognitive_question", "challenge"]
    message: str = Field(min_length=1, max_length=500)
    hint_levels: list[str] = Field(default_factory=list, max_length=3)
    trigger_after_seconds: float = Field(ge=0)
    evidence_id: Optional[str] = Field(None, max_length=128)
    policy_version: str = "adaptive-rules-v1"


class AIRecognition(BaseModel):
    """Only facts that Gemini is responsible for reading from the image."""

    recognized_question: Optional[str] = Field(None, max_length=1_000)
    current_work: list[str] = Field(default_factory=list, max_length=12)
    erased_work: list[str] = Field(default_factory=list, max_length=12)
    observed_steps: list[str] = Field(default_factory=list, max_length=16)
    solution_outline: list[str] = Field(default_factory=list, max_length=10)
    skill_tags: list[str] = Field(default_factory=list, max_length=8)
    progress_quality: Literal["unknown", "starting", "partial", "mostly_correct"] = "unknown"
    confidence: UnitScore = 0
    uncertainties: list[str] = Field(default_factory=list, max_length=8)


class AIPraisePoint(BaseModel):
    evidence_id: str = Field(min_length=1, max_length=128)
    message: str = Field(min_length=1, max_length=500)


class AIFeedback(BaseModel):
    """Small text-only schema generated after recognition and state estimation."""

    thought_type_badge: str = Field(min_length=1, max_length=80)
    praise_points: list[AIPraisePoint] = Field(min_length=3, max_length=3)
    encouragement_message: str = Field(min_length=1, max_length=1_000)
    summary: str = Field(min_length=1, max_length=2_000)
    hint_levels: list[str] = Field(default_factory=list, max_length=3)


class AnalysisRequest(BaseModel):
    questionId: str = Field(min_length=1, max_length=200)
    questionText: Optional[str] = Field(None, max_length=5_000)
    praiseMode: Literal["super_praise", "support", "challenge"] = "support"
    feedbackCondition: Literal["process_praise", "neutral_summary"] = "process_praise"
    strokes: list[StrokeSchema] = Field(min_length=1, max_length=10_000)
    image: str = Field(min_length=1, max_length=12_000_000)
    sourceImage: Optional[str] = Field(None, max_length=12_000_000)
    sourceType: Literal["typed", "photo", "pdf", "blank", "preset"] = "blank"
    analysisBounds: Optional[CanvasBoundsSchema] = None
    learnerId: str = Field("anonymous", min_length=1, max_length=128)
    sessionId: str = Field("session", min_length=1, max_length=128)
    problemDifficulty: Optional[UnitScore] = None
    hintCount: int = Field(0, ge=0, le=100)
    model: Literal["gemini"] = "gemini"


class AnalysisResponse(BaseModel):
    thought_type_badge: str = Field(default="粘り強いチャレンジャー型", min_length=1, max_length=80)
    feedback_condition: Literal["process_praise", "neutral_summary"] = "process_praise"
    praise_points: list[str] = Field(default_factory=list, max_length=5)
    praise_evidence: list[PraiseEvidence] = Field(default_factory=list, max_length=5)
    encouragement_message: Optional[str] = Field(None, max_length=1_000)
    recognized_content: Optional[RecognizedContent] = None
    recognition_confidence: Optional[UnitScore] = None
    recognition_uncertainties: list[str] = Field(default_factory=list, max_length=8)
    skill_tags: list[str] = Field(default_factory=list, max_length=8)
    summary: Optional[str] = Field(None, max_length=2_000)
    annotations: list[AnnotationSchema] = Field(default_factory=list, max_length=20)
    source: Literal["ai", "local_fallback", "hybrid"] = "ai"
    provider_error_category: Optional[Literal[
        "configuration", "auth", "quota", "model", "schema",
        "timeout", "temporary", "network", "unknown",
    ]] = None
    notice: Optional[str] = Field(None, max_length=500)
    process_metrics: Optional[ProcessMetrics] = None
    process_evidence: list[ProcessEvidence] = Field(default_factory=list, max_length=100)
    learner_state: Optional[LearnerState] = None
    intervention: Optional[Intervention] = None
    analysis_id: Optional[str] = Field(None, max_length=128)


class AssistRequest(BaseModel):
    learnerId: str = Field(min_length=1, max_length=128)
    sessionId: str = Field(min_length=1, max_length=128)
    problemId: str = Field(min_length=1, max_length=200)
    questionText: Optional[str] = Field(None, max_length=5_000)
    strokes: list[StrokeSchema] = Field(default_factory=list, max_length=10_000)
    idleSeconds: float = Field(ge=0, le=86_400)
    pageVisible: bool = True
    hintCount: int = Field(0, ge=0, le=100)


class AssistResponse(BaseModel):
    learner_state: LearnerState
    intervention: Intervention
    process_metrics: ProcessMetrics


class StudyEventRequest(BaseModel):
    eventId: str = Field(min_length=1, max_length=128)
    learnerId: str = Field(min_length=1, max_length=128)
    sessionId: str = Field(min_length=1, max_length=128)
    problemId: Optional[str] = Field(None, max_length=200)
    eventType: Literal[
        "session_started", "analysis_completed", "intervention_offered",
        "intervention_dismissed", "hint_opened", "writing_resumed",
        "next_problem_started", "session_completed", "feedback_rating",
    ]
    timestamp: int = Field(ge=0)
    payload: dict[str, Any] = Field(default_factory=dict)
    interventionProbability: Optional[UnitScore] = None


class LearnerProfileResponse(BaseModel):
    learner_id: str
    state: LearnerState
    sample_count: int = Field(ge=0)
    updated_at: str


class GrowthPoint(BaseModel):
    timestamp: str
    mastery: UnitScore
    autonomous_engagement: UnitScore
    support_need: UnitScore
    persistence: UnitScore
    confidence: UnitScore
    model_version: str


class LearnerDashboardResponse(BaseModel):
    learner_id: str
    state: LearnerState
    sample_count: int = Field(ge=0)
    updated_at: str
    level: int = Field(ge=1)
    total_xp: int = Field(ge=0)
    level_xp: int = Field(ge=0)
    xp_to_next_level: int = Field(gt=0)
    total_analyses: int = Field(ge=0)
    total_sessions: int = Field(ge=0)
    total_strokes: int = Field(ge=0)
    total_revisions: int = Field(ge=0)
    total_restarts: int = Field(ge=0)
    streak_days: int = Field(ge=0)
    achievements: list[str] = Field(default_factory=list, max_length=20)
    history: list[GrowthPoint] = Field(default_factory=list, max_length=60)
