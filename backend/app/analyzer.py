import io
import json
import base64
from typing import List
from google import genai
from google.genai import types

from .schemas import StrokeSchema, AnalysisResponse, StepAnalysis
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

def build_stroke_sequence_text(strokes: List[StrokeSchema]) -> str:
    """
    ストロークの書き順（時系列）情報をテキスト化し、Geminiに学習者の解答手順を伝える。
    """
    draw_strokes = [s for s in strokes if s.type == "draw"]
    sorted_strokes = sorted(draw_strokes, key=lambda s: s.startTime)
    
    if not sorted_strokes:
        return "（描画ストロークなし）"
    
    base_time = sorted_strokes[0].startTime
    lines = []
    
    for i, s in enumerate(sorted_strokes):
        elapsed_sec = round((s.startTime - base_time) / 1000.0, 1)
        duration_sec = round((s.endTime - s.startTime) / 1000.0, 1)
        
        # ストロークの大まかな位置と範囲を計算
        point_count = s.pointCount if s.pointCount is not None else len(s.points)
        if s.boundingBox and len(s.boundingBox) == 4:
            min_x, max_x, min_y, max_y = s.boundingBox
            extent = f"位置({int(min_x)},{int(min_y)})→({int(max_x)},{int(max_y)})"
        elif s.points:
            xs = [p.x for p in s.points]
            ys = [p.y for p in s.points]
            min_x, max_x = min(xs), max(xs)
            min_y, max_y = min(ys), max(ys)
            extent = f"位置({int(min_x)},{int(min_y)})→({int(max_x)},{int(max_y)})"
        else:
            extent = "位置不明"
        
        erased_info = "【後に消去】" if s.isErased else ""
        
        lines.append(
            f"  手順{i+1}: 開始{elapsed_sec}秒後, 筆記時間{duration_sec}秒, "
            f"{extent}, 点数{point_count} {erased_info}"
        )
    
    return "\n".join(lines)

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
    
    # 4. ストロークの書き順情報をテキスト化
    stroke_sequence = build_stroke_sequence_text(strokes)
    
    # 5. プロンプトの構築
    prompt = f"""
【対象の問題情報】
問題タイトル: {q_meta['title']}
問題内容: {q_meta['description']}

【正しい解法アプローチ・正解方針】
{q_meta['solution_guide']}

{pause_text}

【学習者の筆記プロセス（時系列順）】
以下は学習者がキャンバスに描いたストロークの時系列記録です。手順番号が若いほど先に描かれたものです。
「後に消去」と記載のあるストロークは、学習者が一度書いた後に消しゴムで消した思考です。
{stroke_sequence}

【最重要ルール１：現在と過去の区別（採点対象）】
画像には2種類の線が描かれています。絶対に混同しないでください。
1. 「黒い線」＝ 現在の最終的な回答です。丸付けや正誤判定は**必ず黒い線に対してのみ**行ってください。
2. 「半透明の赤い線」＝ すでに消しゴムで消された過去の回答です。これに対してバツをつけたり、正誤判定の対象にしたりしないでください。赤い線は「間違いに気づいて修正した試行錯誤の証」としてテキストで褒めるためだけに観察してください。

【最重要ルール２：図形への丸付け禁止】
`canvas_marks` で丸（circle）や下線（underline）をつける場所は、**必ず右側の「青い解答枠」または「生徒が黒い線で書いた数字」の上**に限定してください。左側にある問題の図形（円グラフなど）には絶対にマークを配置しないでください。

【AI分析への必須指示 — 正答判定と詳細な解説について】
1. 画像内にある全ての問題について、まずはあなた自身が正解を導き出し、生徒の書いた「黒い線の答え」と厳密に比較してください。
2. 全問正解ではないのに「全問正解」と褒めるのは絶対にやめてください。
3. 間違い（黒い線の解答ミス）を見つけたら、`hint` や `step_analysis` の中で、「(6)の問題は〜」のように具体的な問題番号と理由を明記して解説してください。
4. もし学習者がまだ明確な回答を書いていない（白紙に近い）場合は、無理に canvas_marks を出力せず、全体コメントで「まずは君の考えを書いてみてね！」と促してください。

【AI分析への必須指示 — canvas_marks（先生の丸付け）について】
一番重要なのは回答の過程を重視することです。以下の3種類の `type` を使い分けてください。

■ `type: "circle"` （正解マーク ○）：
  - 正しい答え（黒い線）が書かれた解答枠に対して使用してください。
  - 丸が小さすぎたり細長くなるのを防ぐため、`box_2d` は「解答枠（青い四角）全体」をすっぽりと大きく囲むように、余裕を持った広い範囲を指定してください。数字の左端など一部だけを指定しないでください。

■ `type: "underline"` （間違い・注目箇所の下線）：
  - 間違っている「黒い線」の答えの下に赤い下線を引いてください。

■ `type: "text"` （先生の赤ペン書き入れ）：
  - 先生がノートの余白に赤ペンで書くように、添削コメントを画像上に配置してください。
  - 正解には「◎」、間違いの近くにはヒントを書いてください。

■ 座標と出力の絶対ルール：
  - `box_2d` は必ず [ymin, xmin, ymax, xmax] の形式で、0から1000までの「整数 (Integer)」の配列として出力してください。小数は使用不可です。

【AI分析への必須指示 — 解答手順とプロセス称賛について】
1. `solving_approach`: 学習者の解法アプローチを1〜2文で要約。
2. `step_analysis`: 学習者の解答プロセス（消しゴムでの修正も含める）を手順ごとに分解し記述。
3. `strategy_evaluation`: 全体的な解法戦略を2〜3文で評価。
4. 赤い線（消した痕跡）や思考の停止時間を見つけたら、結果が間違っていても「粘り強さ」や「修正する柔軟性」として全力で肯定し、称賛してください。

【レスポンス形式】
必ず指定のJSONスキーマ（AnalysisResponse）に従って出力してください。日本語で回答してください。
一番最初の `teacher_internal_reasoning` で、あなた自身の計算と答え合わせの思考プロセスを必ず言語化してから、その他のフィールドを出力してください。
"""

    # 6. Gemini API キーのチェックと呼び出し
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
                {"type": "circle", "box_2d": [300, 300, 500, 500], "comment": "◎"},
                {"type": "underline", "box_2d": [600, 300, 650, 500], "comment": "もう一度確認！"},
                {"type": "text", "box_2d": [650, 510, 700, 700], "comment": "惜しい！あと少し！"}
            ],
            solving_approach="三角形の面積公式を適用しようとした（シミュレーション）",
            step_analysis=[
                StepAnalysis(step_number=1, description="辺の長さの確認", is_correct=True, observation="問題の条件を正しく読み取れています。"),
                StepAnalysis(step_number=2, description="面積計算の適用", is_correct=True, observation="面積公式を知っている点が素晴らしいです。")
            ],
            strategy_evaluation="面積公式を使おうとする方針は正しいです。直角三角形の判定から底辺と高さを特定するステップを意識すると、さらに精度が上がるでしょう。（シミュレーション）"
        )

    try:
        # 最新の google-genai クライアントを初期化
        client = genai.Client(api_key=GEMINI_API_KEY)
        
        # Base64文字列からバイト列に変換
        mime_type = 'image/png'  # デフォルトのフォールバック値
        b64_str = image_b64
        if b64_str.startswith("data:"):
            header, b64_str = b64_str.split(",", 1)
            if ";base64" in header:
                mime_part = header.split(";")[0]
                mime_type = mime_part.split(":")[1]
        elif "," in b64_str:
            header, b64_str = b64_str.split(",", 1)
            
        img_bytes = base64.b64decode(b64_str)
        
        # マジックバイトによる MIME タイプの動的検証（フォールバック）
        if img_bytes.startswith(b'\x89PNG\r\n\x1a\n'):
            mime_type = 'image/png'
        elif img_bytes.startswith(b'\xff\xd8'):
            mime_type = 'image/jpeg'
        elif img_bytes.startswith(b'GIF87a') or img_bytes.startswith(b'GIF89a'):
            mime_type = 'image/gif'
        elif img_bytes.startswith(b'RIFF') and len(img_bytes) > 12 and img_bytes[8:12] == b'WEBP':
            mime_type = 'image/webp'
        
        # Structured Outputs (response_schema) を使って Gemini を呼び出し
        contents = []
        if img_bytes:
            contents.append(
                types.Part.from_bytes(
                    data=img_bytes,
                    mime_type=mime_type,
                )
            )
        contents.append(prompt)

        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=AnalysisResponse,
                system_instruction=(
                    "あなたは学習者のノートに赤ペンで直接書き込みをする情熱的な先生です。"
                    "試行錯誤のプロセス（筆記、消去、停止）を深く観察し、温かく具体的な日本語で添削してください。\n\n"
                    "重要な制約:\n"
                    "- canvas_marks の type: 'circle' は正しい答えにのみ使用\n"
                    "- type: 'underline' は間違っている箇所に使用\n"
                    "- type: 'text' は先生の赤ペンコメントとして画像上に直接配置\n"
                    "- 全ての問題の回答を一つずつ確認し、漏れなくマークをつけてください\n"
                    "- 間違った箇所に circle を絶対につけないでください"
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
            teacher_internal_reasoning=f"AIとの連携中にエラーが発生しました: {str(e)}",
            overall_comment=f"手書きプロセスログは正常にサーバーに届きましたが、AI連携中にエラーが発生しました: {str(e)}",
            praise_points=[
                f"送信された総ストローク数 ({len(strokes)}件) をサーバーで正常に受信・処理できました。",
                "書いた後に消しゴムでオブジェクト消去されたプロセスがログに正しく蓄積されています。"
            ],
            hint="サーバー側の環境変数 GEMINI_API_KEY が正しく設定されているか確認してください。",
            thinker_type="システム確認中 🛠️",
            canvas_marks=[],
            solving_approach="",
            step_analysis=[],
            strategy_evaluation=""
        )

