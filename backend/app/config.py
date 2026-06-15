import os
from dotenv import load_dotenv

# .env ファイルから環境変数をロード
load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
PORT = int(os.getenv("PORT", 8000))
HOST = os.getenv("HOST", "0.0.0.0")

# 問題IDと対応する正解方針・解説の定義（Geminiプロンプトのコンテキスト用）
QUESTION_METADATA = {
    "q_01": {
        "title": "直角三角形の面積",
        "description": "辺の長さが a=6, b=8, c=10 の三角形の面積を求めよ。",
        "solution_guide": (
            "1. 辺の長さが 6, 8, 10 であることから、6^2 + 8^2 = 36 + 64 = 100 = 10^2 が成り立ち、三平方の定理よりこの三角形は斜辺が10の直角三角形であると判定する。\n"
            "2. 直角を挟む2辺は 6 と 8 であるため、これらを底辺と高さとする。\n"
            "3. 面積公式 S = 底辺 * 高さ / 2 に当てはめて、6 * 8 / 2 = 24 が正解となる。\n"
            "4. よくある誤答や迷いとして、斜辺である10を底辺や高さに掛け合わせてしまうミスや、最後の『/ 2』を忘れて48としてしまうミスがある。"
        )
    }
}
