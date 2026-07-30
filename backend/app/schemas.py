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
    boundingBox: Optional[List[float]] = None
    pointCount: Optional[int] = None
    color: Optional[str] = None
    width: Optional[float] = None
    isErased: Optional[bool] = False
    erasedAt: Optional[int] = None
    targetStrokeIds: Optional[List[str]] = None

class AnnotationSchema(BaseModel):
    box_2d: List[int] = Field(..., description="[ymin, xmin, ymax, xmax] 0-1000 normalized coordinates")
    type: str = Field(..., description="'circle', 'underline', 'text' etc.")
    comment: str = Field(..., description="Short praise or advice")

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
    
    # モデル選択用
    model: Optional[str] = "gemini"

class AnalysisResponse(BaseModel):
    summary: Optional[str] = Field(None, description="Detailed profile of the learner, praise for their process, and advice based on hesitation/erasures.")
    annotations: List[AnnotationSchema] = Field(..., description="List of spatial annotations with comments")
