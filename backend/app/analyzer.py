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

【AI分析への必須指示】
1. 画像中の「黒色の線」だけでなく、「半透明の赤色の線（消した思考）」を非常に注意深く分析してください。
2. 正解している素晴らしい数式や図の箇所には、box_2d座標を指定して `type: "circle"` の `canvas_marks` を出力してください。キャンバス上で正解に「花丸」や「丸」を付ける役割を果たします。
3. 間違っている箇所やヒントを出したい箇所には、box_2d座標を指定して `type: "line"` の `canvas_marks` と共に、`comment` に簡潔なアドバイス（例：『ここを2で割る！』など、答えを直接言わない程度のヒント）を出力してください。
4. 最終結果（黒色の線）が間違っていても、赤い線や途中のプロセスに「正しいアプローチの芽」があれば、その部分を具体的に抽出して褒めてください。
5. 途中で手が止まった時間（思考時間メタデータ）があれば、それを「諦めずに粘り強く課題に立ち向かった時間」として称賛してください。
6. 一度書いた線を消しゴムで消した行為（自己修正）を肯定的に評価してください。
7. この学習者の筆記プロセスの特徴を総括する「思考タイプラベル」を決定してください。

【レスポンス形式】
必ず指定のJSONスキーマ（AnalysisResponse）に従って出力してください。日本語で回答してください。
`box_2d` は [ymin, xmin, ymax, xmax] 形式の 0-1000 スケール（画像全体に対する正規化座標）で指定してください。
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
            thinker_type="粘り強い探索者 🔍" if has_pauses else "直感的ひらめき型 💡",
            canvas_marks=[
                {"type": "circle", "box_2d": [300, 300, 500, 500], "comment": "ここが素晴らしい！"},
                {"type": "line", "box_2d": [600, 300, 800, 500], "comment": "惜しい！あと少し！"}
            ]
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
