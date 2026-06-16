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
    backgroundImage: Optional[str] = None  # Base64 encoded background image
    imageWidth: Optional[int] = None      # original background image width
    imageHeight: Optional[int] = None     # original background image height

class AnalysisResponse(BaseModel):
    総合評価: str = Field(..., description="最終的な正誤によらず、試行錯誤の過程や方針を肯定し、全体を総括する評価コメント")
    プロセスへの称賛ポイント: List[str] = Field(..., description="具体的な筆記の軌跡や自己修正、思考停止時間などから抽出した、良いアプローチや粘り強さを称える3〜4つの箇条書きポイント")
    惜しい点_ヒント: str = Field(..., alias="惜しい点（ヒント）", description="間違いがある場合はその修復のヒント、正解の場合はさらに発展的なアプローチへのヒント")
    思考タイプラベル: str = Field(..., description="学習者の解答プロセスから推測されるユニークでポジティブな二つ名（例:『粘り強い探索者 🔍』『直感的ひらめき型 💡』『慎重なステップ実行派 👣』）")

    class Config:
        # JSONシリアライズ/デシリアライズ時のalias許可
        populate_by_name = True
