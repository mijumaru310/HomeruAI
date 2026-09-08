import os

try:
    from dotenv import load_dotenv
except ImportError:
    def load_dotenv(*_args, **_kwargs):
        """環境変数のみで起動する最小構成では.env読み込みを省略する。"""
        return False

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
env_path = os.path.join(BASE_DIR, '.env')

# .env ファイルから環境変数をロード
load_dotenv(dotenv_path=env_path)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
GEMINI_FALLBACK_MODEL = os.getenv("GEMINI_FALLBACK_MODEL", "gemini-3.6-flash")
GEMINI_TIMEOUT_MS = int(os.getenv("GEMINI_TIMEOUT_MS", "25000"))
PORT = int(os.getenv("PORT", 8000))
HOST = os.getenv("HOST", "0.0.0.0")
MAX_REQUEST_BYTES = int(os.getenv("MAX_REQUEST_BYTES", 12_500_000))
_configured_data_dir = os.getenv("HOMERUAI_DATA_DIR", "data")
DATA_DIR = (
    _configured_data_dir
    if os.path.isabs(_configured_data_dir)
    else os.path.join(BASE_DIR, _configured_data_dir)
)
DATABASE_PATH = os.path.join(DATA_DIR, "homeruai.db")
SUPPORT_MODEL_PATH = os.getenv(
    "HOMERUAI_SUPPORT_MODEL",
    os.path.join(BASE_DIR, "models", "support_policy.json"),
)
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv(
        "ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if origin.strip()
]

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
    },
    "q_02": {
        "title": "一次方程式の計算",
        "description": "方程式 3x + 5 = 20 を解け。",
        "solution_guide": (
            "1. 両辺から5を引いて、3x = 15 とする（移項のプロセス）。\n"
            "2. 両辺を3で割って、x = 5 を導く。\n"
            "3. よくある誤答や迷いとして、移項の際の符号ミス（3x = 25としてしまう）や割り算ミスがある。"
        )
    },
    "q_03": {
        "title": "割合と割引の計算",
        "description": "定価 2,400円の品物が 30%引き で売られています。売値はいくらですか？",
        "solution_guide": (
            "1. 方針A: 割引額 2400 * 0.3 = 720円 を求めてから、2400 - 720 = 1680円 とする。\n"
            "2. 方針B: 30%引きなので定価の70% (0.7) と考え、2400 * 0.7 = 1680円 とする。\n"
            "3. どちらの方針をとっていても、その思考方針を大いに褒める。"
        )
    }
}

def get_question_metadata(question_id: str, question_text: str = None) -> dict:
    # ユーザーが直接問題文を指定している場合
    if question_text and question_text.strip():
        return {
            "title": question_id if question_id and question_id != "custom" else "指定された問題",
            "description": question_text.strip(),
            "solution_guide": (
                "指定された問題文・数式に基づき、AI自身が模範的な解法ステップと正解方針を自律的に導き出し、"
                "生徒の手書きアプローチや試行錯誤（黒線・赤線・停止時間）がその方針に沿っているかを温かく評価してください。"
            )
        }

    # プリセット完全一致
    if question_id in QUESTION_METADATA:
        return QUESTION_METADATA[question_id]
    
    # タイトル部分一致
    for k, v in QUESTION_METADATA.items():
        if k in question_id or v["title"] in question_id:
            return v
            
    # 自由問題・教材写真（画像内の問題文からAIが自律判断）
    return {
        "title": question_id if question_id and question_id != "custom" else "自由ノート・教材写真",
        "description": "画像内に印刷されている問題集・プリントの問題文、または手書きされた問題文をOCRで読み取って特定してください。",
        "solution_guide": (
            "1. まず画像全体から【生徒が解こうとしている問題・設問・数式】を正確に読み取り、`recognized_content.recognized_question` に記録してください。\n"
            "2. その問題に対する正解方針・解法プロセスを自律的に導出してください。\n"
            "3. 生徒の手書き文字（黒線＝現在の式、赤線＝消去した試行錯誤）と照合し、努力のプロセスを熱く称賛してください。"
        )
    }

