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
    image_height: Optional[int] = None,
    image_x: float = 0.0,  # 追加: 背景画像のX座標
    image_y: float = 0.0,  # 追加: 背景画像のY座標
) -> Image.Image:
    
    # 1. キャンバスサイズを「背景画像のサイズ」に完全固定
    w = image_width if image_width else 800
    h = image_height if image_height else 600
    canvas = Image.new("RGBA", (w, h), (255, 255, 255, 255))

    # 2. 背景画像を (0, 0) にピッタリ貼り付け
    if background_image_base64:
        try:
            data = background_image_base64
            if "," in data:
                data = data.split(",", 1)[1]
            img_bytes = base64.b64decode(data)
            bg_img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
            if bg_img.width != w or bg_img.height != h:
                bg_img = bg_img.resize((w, h), Image.Resampling.LANCZOS)
            canvas.paste(bg_img, (0, 0), bg_img)
        except Exception as exc:
            print(f"[renderer] background image decode error: {exc}")

    # 3. ストロークの描画
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    sorted_strokes = sorted(strokes, key=lambda s: s.startTime)

    for stroke in sorted_strokes:
        if stroke.type != "draw" or not stroke.points:
            continue

        fill = (239, 68, 68, 70) if stroke.isErased else (30, 41, 59, 255)
        line_width = max(1, int(stroke.width or 4))

        # 【重要】ワールド座標から背景画像の開始座標 (image_x, image_y) を引くことで、
        # 背景画像に対するローカル（相対）座標に変換する
        pts = [(pt.x - image_x, pt.y - image_y) for pt in stroke.points]

        if len(pts) == 1:
            r = line_width / 2
            draw.ellipse([pts[0][0] - r, pts[0][1] - r, pts[0][0] + r, pts[0][1] + r], fill=fill)
        else:
            draw.line(pts, fill=fill, width=line_width, joint="round")
            r = line_width / 2
            for px, py in pts:
                draw.ellipse([px - r, py - r, px + r, py + r], fill=fill)

    final = Image.alpha_composite(canvas, overlay)
    return final.convert("RGB")