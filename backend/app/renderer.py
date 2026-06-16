import io
import base64
from PIL import Image, ImageDraw
from typing import List, Optional
from .schemas import StrokeSchema

def render_strokes(
    strokes: List[StrokeSchema],
    question_id: str,
    background_image_base64: Optional[str] = None,
    image_width: Optional[int] = None,
    image_height: Optional[int] = None
) -> Image.Image:
    """
    無限キャンバス上で描画されたストロークと背景画像を、バウンディングボックスを元に
    動的に切り出して Ghost Rendering を行い、Gemini API用のRGB画像を生成する。
    
    - background_image_base64: フロントエンドから送信された背景問題画像のBase64データ
    - image_width / image_height: 背景画像のワールド座標系での寸法 (0,0) -> (w,h)
    """
    
    # 1. バウンディングボックス (外接矩形) の算出
    min_x, min_y = float('inf'), float('inf')
    max_x, max_y = float('-inf'), float('-inf')
    
    has_bg = False
    bg_w, bg_h = 0, 0
    bg_img = None
    
    # 背景問題画像がある場合は、(0,0)〜(bg_w, bg_h) をバウンディングボックスの初期領域とする
    if background_image_base64:
        try:
            # Base64ヘッダー (data:image/png;base64, 等) があれば除去
            if "," in background_image_base64:
                background_image_base64 = background_image_base64.split(",")[1]
            
            img_data = base64.b64decode(background_image_base64)
            bg_img = Image.open(io.BytesIO(img_data)).convert("RGBA")
            bg_w = image_width or bg_img.width
            bg_h = image_height or bg_img.height
            
            min_x = min(min_x, 0)
            min_y = min(min_y, 0)
            max_x = max(max_x, bg_w)
            max_y = max(max_y, bg_h)
            has_bg = True
        except Exception as e:
            print(f"Error decoding background image: {e}")
            
    # 手書きストロークの最大・最小座標をマージ
    has_strokes = False
    for stroke in strokes:
        if stroke.type != "draw" or not stroke.points:
            continue
        # 消去されたストロークも試行錯誤プロセスとして可視化するため外接矩形計算に含める
        has_strokes = True
        for pt in stroke.points:
            min_x = min(min_x, pt.x)
            min_y = min(min_y, pt.y)
            max_x = max(max_x, pt.x)
            max_y = max(max_y, pt.y)
            
    # ストロークも背景もない場合のフォールバックサイズ (1024x768)
    if not has_bg and not has_strokes:
        min_x, min_y = 0, 0
        max_x, max_y = 1024, 768
        
    # クロップされた画像の余白 (マージン)
    margin = 50
    min_x -= margin
    min_y -= margin
    max_x += margin
    max_y += margin
    
    # 描画対象のキャンバス幅と高さを確定
    w = int(max_x - min_x)
    h = int(max_y - min_y)
    
    # 最低サイズ保証（細長すぎるアスペクト比でレンダリングされるのを防ぐ）
    if w < 400:
        diff = 400 - w
        min_x -= diff / 2
        max_x += diff / 2
        w = 400
    if h < 300:
        diff = 300 - h
        min_y -= diff / 2
        max_y += diff / 2
        h = 300
        
    # 2. 白紙ベースRGBA画像の生成
    canvas = Image.new("RGBA", (w, h), (255, 255, 255, 255))
    
    # 3. 背景画像の配置 (ワールドの原点 0,0 に配置)
    if has_bg and bg_img:
        # 新キャンバス内での相対座標: 原点(0,0) - 最小座標(min_x, min_y)
        paste_x = int(-min_x)
        paste_y = int(-min_y)
        # 実際にリサイズされていた場合はスケールを合わせてペースト
        if bg_img.width != bg_w or bg_img.height != bg_h:
            bg_img = bg_img.resize((bg_w, bg_h), Image.Resampling.LANCZOS)
        canvas.paste(bg_img, (paste_x, paste_y), bg_img)
        
    # 4. 手書きオーバーレイの生成と描画
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    
    # 描画順（startTime）でソート
    sorted_strokes = sorted(strokes, key=lambda s: s.startTime)
    
    for stroke in sorted_strokes:
        # 描画線のみ描画
        if stroke.type != "draw" or len(stroke.points) < 2:
            continue
            
        is_erased = stroke.isErased
        
        # 色と太さの決定
        if is_erased:
            # 消された線 (半透明の赤)
            line_color = (239, 68, 68, 70)  # RGBA
            line_width = int(stroke.width or 4)
        else:
            # 残っている線 (濃いダークグレー)
            line_color = (30, 41, 59, 255)  # RGBA
            line_width = int(stroke.width or 4)
            
        # ワールド座標を新しい切り出しキャンバス内の相対座標にシフト
        points = [(pt.x - min_x, pt.y - min_y) for pt in stroke.points]
        
        # 線を描画
        draw.line(points, fill=line_color, width=line_width, joint="round")
        
        # 端点や屈曲点を円で埋めて滑らかにする
        radius = line_width / 2
        for pt in points:
            draw.ellipse(
                [pt[0] - radius, pt[1] - radius, pt[0] + radius, pt[1] + radius],
                fill=line_color
            )
            
    # 背景と手書きをマージ
    final_image = Image.alpha_composite(canvas, overlay)
    
    # RGB に平坦化して出力
    return final_image.convert("RGB")
