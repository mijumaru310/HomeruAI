import io
import json
import base64
from typing import List
from google import genai
from google.genai import types
from openai import OpenAI

from .schemas import StrokeSchema, AnalysisResponse
from .config import GEMINI_API_KEY, NVIDIA_API_KEY, QUESTION_METADATA

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

def analyze_process(strokes: List[StrokeSchema], question_id: str, image_b64: str, model: str = "gemini") -> AnalysisResponse:
    """
    フロントエンドで生成されたGhost Rendered画像（Base64）とメタデータ（停止時間）をGemini APIまたはNVIDIA APIに送信し、
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

【最重要ルール２：印刷された問題文への丸付け禁止】
`annotations` で丸（circle）やテキスト（text）を入れる場所は、**必ず「生徒が手書きの黒い線で書いた途中式や答え」の上またはその直近**に限定してください。
あらかじめ印刷されている問題文や活字の上に丸をつけたりコメントを配置することは絶対に避けてください。

【AI分析への必須指示 — 全体レポート（summary）とアノテーションについて】
あなたは赤ペンを持つ情熱的で優しい先生です。最終的な答えの正誤だけでなく、「解答に至るまでのプロセス」を最も重視して採点・評価を行ってください。

採点と分析の手順：
1. **プロセスの読み取り**:
   - `【検知された思考時間】` から、どこで一番時間がかかったか（迷いや思考の深まり）を把握してください。
   - `【学習者の筆記プロセス】` から、一度書いて消した部分（`isErased`）を把握し、「最初は合っていたのに消してしまった」「ここで試行錯誤した」という努力を汲み取ってください。
2. **方針と計算ミスの分離**:
   - 答えが間違っていても、途中の考え方や式（方針）が合っている場合は「方針は完璧だよ！」「考え方は合ってる！」と大きく褒めてください。単なる計算ミスや見落としであれば、そこを優しく指摘してください。
3. **全体レポート（summary）の作成**:
   - 分析したプロセス（迷い、書き直し、方針の正しさ）を踏まえ、学習者が「どのようなタイプか（例：慎重に考えるタイプ、直感的に解くタイプなど）」「どこに気をつけるべきか」を解説し、とにかくたくさん褒める長文のテキストを作成してください。
4. **アノテーション（annotations）の配置**:
   - 各問に対して `circle` または `underline` + `text` を配置します。

以下の3種類の `type` を使い分けてください。

■ `type: "circle"` （正解マーク ○）：
  - **必ず「= の右に書かれた手書きの答えの数字・式のみ」にだけ使用**してください。計算過程には絶対につけないでください。
  - `box_2d` は答えの数字・式をピッタリと囲む正方形に近い形で指定してください（width と height の差を100以内に）。

■ `type: "underline"` （間違い・注目箇所の下線）：
  - **間違った答えの真下**に引くか、あるいは**間違えた計算過程の部分**（計算ミスをした箇所）に引いてください。

■ `type: "text"` （先生の赤ペン書き入れ）：
  - 答えの丸や下線の直近に配置するほか、**プロセスに対する具体的な褒め言葉**（例：「ここでじっくり考えたのが素晴らしい！」「方針は合ってるよ！」など）を、該当する途中式の近くの余白にたくさん配置してください。

■ 座標と出力の絶対ルール：
  - `box_2d` は必ず [ymin, xmin, ymax, xmax] の形式で、0から1000までの「整数」として出力してください。小数は使用不可です。

【レスポンス形式】
必ず指定のJSONスキーマ（AnalysisResponse）に従って出力してください。日本語で回答してください。
"""

    if model == "nvidia":
        if not NVIDIA_API_KEY:
            print("Warning: NVIDIA_API_KEY is not configured.")
            return AnalysisResponse(
                annotations=[{"type": "text", "box_2d": [100, 100, 200, 500], "comment": "NVIDIA API Key is not configured."}]
            )
        try:
            client = OpenAI(
              base_url="https://integrate.api.nvidia.com/v1",
              api_key=NVIDIA_API_KEY
            )
            
            b64_str = image_b64
            mime_type = 'image/png'
            if b64_str.startswith("data:"):
                header, b64_str = b64_str.split(",", 1)
                if ";base64" in header:
                    mime_part = header.split(";")[0]
                    mime_type = mime_part.split(":")[1]
            elif "," in b64_str:
                header, b64_str = b64_str.split(",", 1)

            prompt_for_nvidia = prompt + "\n\nOutput ONLY valid JSON matching the schema: {\"summary\": \"...\", \"annotations\": [{\"box_2d\": [ymin, xmin, ymax, xmax], \"type\": \"circle|underline|text\", \"comment\": \"...\"}]}."

            response = client.chat.completions.create(
              model="meta/llama-3.2-90b-vision-instruct",
              messages=[
                {
                  "role": "user",
                  "content": [
                    {"type": "text", "text": prompt_for_nvidia},
                    {
                      "type": "image_url",
                      "image_url": {
                        "url": f"data:{mime_type};base64,{b64_str}"
                      }
                    }
                  ]
                }
              ],
              temperature=0.2,
              max_tokens=1024,
            )
            
            content = response.choices[0].message.content
            # Llama 3 models sometimes wrap JSON in markdown code blocks
            if content.startswith("```json"):
                content = content[7:-3].strip()
            elif content.startswith("```"):
                content = content[3:-3].strip()
            
            data = json.loads(content)
            return AnalysisResponse(**data)
            
        except Exception as e:
            print(f"Error calling NVIDIA API: {e}")
            return AnalysisResponse(
                annotations=[{"type": "text", "box_2d": [100, 100, 200, 500], "comment": f"NVIDIA API Error: {str(e)}"}]
            )
    else:
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
                annotations=[
                    {"type": "circle", "box_2d": [300, 300, 500, 500], "comment": "◎ 素晴らしいプロセスです！"},
                    {"type": "underline", "box_2d": [600, 300, 650, 500], "comment": "もう一度確認！"},
                    {"type": "text", "box_2d": [650, 510, 700, 700], "comment": "惜しい！あと少し！"}
                ]
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
                        "あなたは赤ペンで丸付けをする情熱的な先生です。生徒の解答プロセス（迷いや書き直し）を深く分析してください。\n\n"
                        "重要な制約:\n"
                        "- 丸（circle）は必ず '= の右側に書かれた答えの数字・式' だけに使用。計算過程には絶対に使わない\n"
                        "- 答えが間違っていても、計算過程や方針が合っていれば大いに褒めること\n"
                        "- 迷った時間（思考時間）や消去履歴から、生徒の努力や弱点を読み取り、全体レポート（summary）を作成すること\n"
                        "- text コメントは circle または underline のすぐ近く、または褒めるべき計算過程の横に配置\n"
                        "- 各 box_2d は対象をタイトに囲むこと"
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
            return AnalysisResponse(
                annotations=[
                    {"type": "text", "box_2d": [100, 100, 200, 500], "comment": f"AI連携中にエラーが発生しました: {str(e)}"}
                ]
            )

