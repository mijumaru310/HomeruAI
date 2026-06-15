import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from .schemas import AnalysisRequest, AnalysisResponse
from .renderer import render_strokes
from .analyzer import analyze_process

app = FastAPI(
    title="HomeruAI Backend API",
    description="学習者の試行錯誤（筆記・消去・停止）プロセスを可視化・称賛するAI評価バックエンド",
    version="1.0.0"
)

# プロトタイプ開発のため、すべてのオリジンからのCORSリクエストを許可
# 本番環境ではフロントエンドのURLに制限することが推奨されます。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/analyze", response_model=AnalysisResponse)
async def analyze_strokes(request: AnalysisRequest):
    """
    手書きプロセス（ストロークログJSON）を受信し、Ghost Renderingと停止時間計算を行い、
    Gemini APIによるプロセス称賛フィードバックを生成・返却する。
    """
    if not request.strokes:
        raise HTTPException(
            status_code=400, 
            detail="手書きデータ（strokes）が空です。キャンバスに記述してから送信してください。"
        )
        
    try:
        # 1. Ghost Rendering による画像レンダリング (Pillow)
        rendered_image = render_strokes(request.strokes, request.questionId)
        
        # デバッグ用: サーバーが生成した直近の Ghost Rendering 画像を保存 (目視確認用)
        temp_dir = "temp_renders"
        os.makedirs(temp_dir, exist_ok=True)
        rendered_image.save(os.path.join(temp_dir, "last_render.png"))
        
        # 2. 停止時間分析と Gemini API 呼び出し
        feedback = analyze_process(request.strokes, request.questionId, rendered_image)
        
        return feedback
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=500, 
            detail=f"サーバー内部エラーが発生しました: {str(e)}"
        )

@app.get("/api/health")
async def health():
    """
    ヘルスチェックエンドポイント
    """
    return {
        "status": "healthy",
        "message": "HomeruAI Backend is running smoothly"
    }

if __name__ == "__main__":
    import uvicorn
    # 直接実行された場合は、config からポートをロードして起動
    from .config import PORT, HOST
    uvicorn.run("main:app", host=HOST, port=PORT, reload=True)
