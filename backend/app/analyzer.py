import io
import json
import base64
from typing import List
from google import genai
from google.genai import types

from .schemas import StrokeSchema, AnalysisResponse
from .config import GEMINI_API_KEY, QUESTION_METADATA

def calculate_pauses(strokes: List[StrokeSchema]) -> List[dict]:
    """
    連続するストローク間のタイムスタンプ差を計算し、10秒以上の思考停止（迷い）時間を検出する。
    """
    # 描画の開始順（startTime）でソート
    sorted_strokes = sorted(strokes, key=lambda s: s.startTime)
    pauses = []
    
    for i in range(1, len(sorted_strokes)):
        prev_end = sorted_strokes[i-1].endTime
        curr_start = sorted_strokes[i].startTime
        
        # タイムスタンプはミリ秒単位
        delta_ms = curr_start - prev_end
        delta_sec = delta_ms / 1000.0
        
        # 10秒以上の停止を「迷い/思考時間」として検出
        if delta_sec >= 10.0:
            pauses.append({
                "after_stroke_id": sorted_strokes[i-1].strokeId,
                "before_stroke_id": sorted_strokes[i].strokeId,
                "duration_seconds": round(delta_sec, 1)
            })
            
    return pauses

def analyze_process(strokes: List[StrokeSchema], question_id: str, image_b64: str) -> AnalysisResponse:
    """
    フロントエンドで生成されたGhost Rendered画像（Base64）とメタデータ（停止時間）をGemini APIに送信し、
    学習プロセスに特化したStructured Output JSONフィードバックを取得する。
    """
    # 1. 停止時間の分析
    pauses = calculate_pauses(strokes)
    
    # 2. 問題情報の取得
    q_meta = QUESTION_METADATA.get(question_id, {
        "title": "一般問題",
        "description": "手書きされた解答プロセスを評価してください。",
        "solution_guide": "一般的な解答ロジックに基づいてプロセスを評価してください。"
    })
    
    # 3. 停止時間情報のテキスト化
    if pauses:
        pause_details = "\n".join([
            f"- ストロークの間で {p['duration_seconds']} 秒間の思考停止（検討・迷い）を検知しました。"
            for p in pauses
        ])
        pause_text = f"【検知された思考時間】\n{pause_details}"
    else:
        pause_text = "【検知された思考時間】\n目立った長時間の思考停止（10秒以上）は検知されず、比較的スムーズに筆記が進められました。"
        
    # 4. プロンプトの構築
    prompt = f"""
【対象の問題情報】
問題タイトル: {q_meta['title']}
問題内容: {q_meta['description']}

【正しい解法アプローチ・正解方針】
{q_meta['solution_guide']}

{pause_text}

【送信された画像について】
添付画像は学習者の数学/算数の解答プロセスです。黒い線は最終的な回答、半透明の赤い線は『一度書いてから消しゴムで消した試行錯誤の痕跡』です。以下のJSONスキーマに厳密に従って、最終的な計算結果だけでなく、正しい方針や視点の切り替え（赤い線の部分）を積極的に抽出して褒める評価を出力してください。
"""

    # 5. Gemini API キーのチェックと呼び出し
    if not GEMINI_API_KEY or GEMINI_API_KEY.strip() == "" or GEMINI_API_KEY == "your_gemini_api_key_here":
        print("Warning: GEMINI_API_KEY is not configured. Falling back to simulated local AI evaluation.")
        # モック/シミュレーション用の結果を返す
        has_erased = any(s.isErased for s in strokes)
        has_pauses = len(pauses) > 0
        
        simulated_eval = "最後まで諦めずに解答を作り上げたプロセスが素晴らしいです！"
        simulated_praises = [
            "図や数式を書きながら、問題の構造を捉えようとしている姿勢が大変立派です。",
        ]
        
        if has_erased:
            simulated_eval += " 特に、一度書いたアプローチを消しゴムで消して再検討した形跡があり、自己分析能力が非常に高いです。"
            simulated_praises.append("一度書いた数値やアプローチの誤りに自分で気づき、消しゴムで消して素早く自己修正できた柔軟性。")
            
        if has_pauses:
            simulated_praises.append(f"ペンの動きが止まった時間（最大 {max(p['duration_seconds'] for p in pauses)}秒）がありましたが、そこから逃げずに考え抜いた粘り強さ。")
            
        return AnalysisResponse(
            overall_comment=simulated_eval + " (APIキー未設定のため、ローカルエンジンでプロセスログをシミュレート評価しています)",
            praise_points=simulated_praises,
            hint="直角を挟む2つの辺の長さ（底辺と高さ）の掛け算と、最後の「2で割る」処理の計算をもう一度ゆっくり見直してみましょう！",
            thinker_type="粘り強い探索者 🔍" if has_pauses else "直感的ひらめき型 💡"
        )

    try:
        # 最新の google-genai クライアントを初期化
        client = genai.Client(api_key=GEMINI_API_KEY)
        
        # Base64文字列からバイト列に変換
        b64_str = image_b64
        if "," in b64_str:
            b64_str = b64_str.split(",")[1]
        img_bytes = base64.b64decode(b64_str)
        
        # Structured Outputs (response_schema) を使って Gemini を呼び出し
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[
                types.Part.from_bytes(
                    data=img_bytes,
                    mime_type='image/png',
                ),
                prompt
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=AnalysisResponse,
                system_instruction=(
                    "あなたは学習者の最終的な答えの正誤ではなく、試行錯誤のプロセス（筆記、消去、停止）に焦点を当てて"
                    "全力で称賛し、自信を育てる情熱的なAI家庭教師です。学習者を深く観察した具体的で温かい日本語で回答してください。"
                ),
                temperature=0.2,
            )
        )
        
        # SDKが自動パースしたオブジェクト、またはJSONからの読み込み
        if hasattr(response, 'parsed') and response.parsed:
            return response.parsed
        else:
            data = json.loads(response.text)
            return AnalysisResponse(**data)
            
    except Exception as e:
        print(f"Error calling Gemini API: {e}")
        # APIエラー時の詳細なフォールバック
        return AnalysisResponse(
            overall_comment=f"手書きプロセスログは正常にサーバーに届きましたが、AI連携中にエラーが発生しました: {str(e)}",
            praise_points=[
                f"送信された総ストローク数 ({len(strokes)}件) をサーバーで正常に受信・処理できました。",
                "書いた後に消しゴムでオブジェクト消去されたプロセスがログに正しく蓄積されています。"
            ],
            hint="サーバー側の環境変数 GEMINI_API_KEY が正しく設定されているか確認してください。",
            thinker_type="システム確認中 🛠️"
        )
