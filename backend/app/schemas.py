from pydantic import BaseModel, Field
from typing import List, Optional

class PointSchema(BaseModel):
    x: float
    y: float
    p: float  # pressure
    t: int    # relative time (ms) from stroke start

class StrokeSchema(BaseModel):
    strokeId: str
    type: str  # "draw" | "erase"
    startTime: int  # absolute timestamp (ms)
    endTime: int    # absolute timestamp (ms)
    points: List[PointSchema]
    color: Optional[str] = None
    width: Optional[float] = None
    isErased: Optional[bool] = False
    erasedAt: Optional[int] = None
    targetStrokeIds: Optional[List[str]] = None

class CanvasMark(BaseModel):
    type: str = Field(..., description="'circle' for correct answers (○), 'underline' for mistakes/attention areas, 'text' for teacher's handwritten comments")
    box_2d: List[int] = Field(..., description="[ymin, xmin, ymax, xmax] in 0-1000 normalized coordinates relative to the problem image, indicating the bounding box of the target area")
    comment: Optional[str] = Field(None, description="Text content: for 'text' type this is the written comment, for 'underline' type this is the hint, for 'circle' type this is optional praise")

class AnalysisRequest(BaseModel):
    questionId: str
    strokes: List[StrokeSchema]
    image: str = Field(..., description="Base64 encoded ghost rendered image from frontend")
    backgroundImage: Optional[str] = None  # Base64 encoded background image
    imageWidth: Optional[int] = None      # original background image width
    imageHeight: Optional[int] = None     # original background image height
    #新しく追加 @0621
    imageX: Optional[float] = 0.0
    imageY: Optional[float] = 0.0

class StepAnalysis(BaseModel):
    step_number: int = Field(..., description="ステップ番号（書き順に基づく）")
    description: str = Field(..., description="このステップで学習者が行ったことの説明")
    is_correct: bool = Field(..., description="このステップが正しいかどうか")
    observation: str = Field(..., description="このステップに対する所見（良い点や改善点）")

class AnalysisResponse(BaseModel):
    overall_comment: str = Field(..., description="全体への熱い称賛コメント")
    praise_points: List[str] = Field(..., description="方針の正しさや粘り強さなどの具体的な褒めポイント（2〜3個）")
    hint: str = Field(..., description="計算ミスなどがあれば、答えを直接言わずに気づきを促す優しいヒント")
    thinker_type: str = Field(..., description="例：開拓者タイプ、粘り強さの職人、などのキャッチーな称号")
    canvas_marks: List[CanvasMark] = Field(default_factory=list, description="List of marks to draw on the canvas. Use [ymin, xmin, ymax, xmax] in 0-1000 scale.")
    solving_approach: str = Field(default="", description="回答者の解法アプローチの要約（例：三平方の定理を使った直角三角形の判定から面積公式へ）")
    step_analysis: List[StepAnalysis] = Field(default_factory=list, description="手順ごとの分析リスト（各ステップの内容・正誤・所見）")
    strategy_evaluation: str = Field(default="", description="戦略・方針の総合評価（良い点・改善点を含む）")
