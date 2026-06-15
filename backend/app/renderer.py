import os
from PIL import Image, ImageDraw
from typing import List
from .schemas import StrokeSchema

CANVAS_WIDTH = 1024;
CANVAS_HEIGHT = 768;

def get_base_image(question_id: str) -> Image.Image:
    """
    問題IDに応じた背景画像を読み込み、1024x768のベースRGBA画像を生成する。
    """
    base = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), (255, 255, 255, 255))
    
    # Next.js の public フォルダから背景画像を探す
    # 様々なパス候補を試す（ローカル実行時のカレントディレクトリに対応するため）
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    img_candidates = [
        os.path.join(base_dir, "frontend", "public", "question.png"),
        os.path.join("frontend", "public", "question.png"),
        "../frontend/public/question.png",
        "question.png"
    ]
    
    img_path = None
    for path in img_candidates:
        if os.path.exists(path):
            img_path = path
            break
            
    if img_path:
        try:
            bg_img = Image.open(img_path).convert("RGBA")
            # CSSの contain に合わせてアスペクト比維持の拡大縮小と中央配置を行う
            bg_ratio = bg_img.width / bg_img.height
            target_ratio = CANVAS_WIDTH / CANVAS_HEIGHT
            
            if bg_ratio > target_ratio:
                # 画像の方が横長 -> 幅をキャンバス幅に合わせる
                w = CANVAS_WIDTH
                h = int(CANVAS_WIDTH / bg_ratio)
            else:
                # 画像の方が縦長 -> 高さをキャンバス高さに合わせる
                h = CANVAS_HEIGHT
                w = int(CANVAS_HEIGHT * bg_ratio)
                
            bg_resized = bg_img.resize((w, h), Image.Resampling.LANCZOS)
            
            # 中央揃えでペースト
            x = (CANVAS_WIDTH - w) // 2
            y = (CANVAS_HEIGHT - h) // 2
            
            base.paste(bg_resized, (x, y), bg_resized)
        except Exception as e:
            print(f"Warning: Failed to load background image: {e}")
            
    return base

def render_strokes(strokes: List[StrokeSchema], question_id: str) -> Image.Image:
    """
    ストロークの履歴をGhost Rendering手法で画像化する。
    - 残っている線（isErased=False）: 黒色 (30, 41, 59)
    - 消された線（isErased=True）: 半透明の赤色 (239, 68, 68, 70)
    """
    # ベースの背景画像を準備
    image = get_base_image(question_id)
    
    # 線を描画するための透明なオーバーレイレイヤーを作成 (半透明アルファ処理のため)
    overlay = Image.new("RGBA", (CANVAS_WIDTH, CANVAS_HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    
    # 描画開始時間順に並べ替えて再現
    sorted_strokes = sorted(strokes, key=lambda s: s.startTime)
    
    for stroke in sorted_strokes:
        # 描画ストロークのみ描画（消しゴムの軌跡自体は画像化しない）
        if stroke.type != "draw" or len(stroke.points) < 2:
            continue
            
        is_erased = stroke.isErased
        
        # 色と太さの決定
        if is_erased:
            # 消された思考プロセス（半透明の赤）
            line_color = (239, 68, 68, 70)  # RGBA
            line_width = int(stroke.width or 4)
        else:
            # 現在残っている思考プロセス（濃いダークグレー）
            line_color = (30, 41, 59, 255)  # RGBA
            line_width = int(stroke.width or 4)
            
        # ポイント配列の抽出
        points = [(pt.x, pt.y) for pt in stroke.points]
        
        # Pillow の line は関節が荒くなるため、round ジョイントを使用
        # さらに、各ポイントに関節球（ellipse）を置くことでより手書きらしくスムーズな線にする
        draw.line(points, fill=line_color, width=line_width, joint="round")
        
        radius = line_width / 2
        for pt in points:
            draw.ellipse(
                [pt[0] - radius, pt[1] - radius, pt[0] + radius, pt[1] + radius],
                fill=line_color
            )
            
    # 背景画像と手書きオーバーレイを重ね合わせて1枚のRGBA画像にする
    final_image = Image.alpha_composite(image, overlay)
    
    # Gemini API 送信用に RGB (背景白ベースの平坦化) または透明チャンネルを維持したPNGにする
    # 今回はマルチモーダル入力なので RGB に変換してJPEG/PNGで送信可能にする
    return final_image.convert("RGB")
