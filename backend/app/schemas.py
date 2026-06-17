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

class AnalysisRequest(BaseModel):
    questionId: str
    strokes: List[StrokeSchema]
    image: str = Field(..., description="Base64 encoded ghost rendered image from frontend")
    backgroundImage: Optional[str] = None  # Base64 encoded background image
    imageWidth: Optional[int] = None      # original background image width
    imageHeight: Optional[int] = None     # original background image height

class AnalysisResponse(BaseModel):
    overall_comment: str = Field(..., description="全体への熱い称賛コメント")
    praise_points: List[str] = Field(..., description="方針の正しさや粘り強さなどの具体的な褒めポイント（2〜3個）")
    hint: str = Field(..., description="計算ミスなどがあれば、答えを直接言わずに気づきを促す優しいヒント")
    thinker_type: str = Field(..., description="例：開拓者タイプ、粘り強さの職人、などのキャッチーな称号")
