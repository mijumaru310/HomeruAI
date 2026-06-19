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
) -> Image.Image:
    """
    Ghost Rendering: ストローク JSON から1枚の可視化画像を生成する。

    描画ルール:
    - type=draw かつ isErased=False の線 → 黒色 (思考の軌跡)
    - type=draw かつ isErased=True  の線 → 半透明の赤 (消された思考プロセス)
    - type=erase / pixel-erase       → 画像には描かず、「消去操作があった」証拠として無視
    """

    # ────────────────────────────────────────────────────────────────────────
    # 1. バウンディングボックス計算
    # ────────────────────────────────────────────────────────────────────────
    min_x, min_y = float("inf"),  float("inf")
    max_x, max_y = float("-inf"), float("-inf")

    has_bg = False
    bg_w = bg_h = 0
    bg_img = None

    if background_image_base64:
        try:
            data = background_image_base64
            if "," in data:
                data = data.split(",", 1)[1]
            img_bytes = base64.b64decode(data)
            bg_img = Image.open(io.BytesIO(img_bytes)).convert("RGBA")
            bg_w = image_width  or bg_img.width
            bg_h = image_height or bg_img.height
            min_x = min(min_x, 0);  min_y = min(min_y, 0)
            max_x = max(max_x, bg_w); max_y = max(max_y, bg_h)
            has_bg = True
        except Exception as exc:
            print(f"[renderer] background image decode error: {exc}")

    has_strokes = False
    for s in strokes:
        # draw ストロークのみ座標を考慮 (消去操作は無視)
        if s.type not in ("draw",) or not s.points:
            continue
        has_strokes = True
        for pt in s.points:
            min_x = min(min_x, pt.x); min_y = min(min_y, pt.y)
            max_x = max(max_x, pt.x); max_y = max(max_y, pt.y)

    if not has_bg and not has_strokes:
        min_x, min_y, max_x, max_y = 0, 0, 1024, 768

    # マージン
    margin = 60
    min_x -= margin; min_y -= margin
    max_x += margin; max_y += margin

    w = max(400, int(max_x - min_x))
    h = max(300, int(max_y - min_y))

    # ────────────────────────────────────────────────────────────────────────
    # 2. 白紙ベース RGBA キャンバス
    # ────────────────────────────────────────────────────────────────────────
    canvas = Image.new("RGBA", (w, h), (255, 255, 255, 255))

    # ────────────────────────────────────────────────────────────────────────
    # 3. 背景画像を貼り付け
    # ────────────────────────────────────────────────────────────────────────
    if has_bg and bg_img:
        paste_x = int(-min_x)
        paste_y = int(-min_y)
        if bg_img.width != bg_w or bg_img.height != bg_h:
            bg_img = bg_img.resize((bg_w, bg_h), Image.Resampling.LANCZOS)
        canvas.paste(bg_img, (paste_x, paste_y), bg_img)

    # ────────────────────────────────────────────────────────────────────────
    # 4. ストローク描画 (startTime 昇順)
    # ────────────────────────────────────────────────────────────────────────
    overlay = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    draw    = ImageDraw.Draw(overlay)

    sorted_strokes = sorted(strokes, key=lambda s: s.startTime)

    for stroke in sorted_strokes:
        # ── erase / pixel-erase は描画しない ─────────────────────────────
        # (Ghost Rendering は「書いた跡」を可視化するためのもので
        #  消去操作そのものは表示しない。isErased フラグで色分けする)
        if stroke.type != "draw":
            continue
        if not stroke.points or len(stroke.points) < 1:
            continue

        # ── 色の決定 ─────────────────────────────────────────────────────
        if stroke.isErased:
            # 消された思考プロセス → 半透明の赤
            fill = (239, 68, 68, 70)
        else:
            # 現在キャンバスに残っている線 → 黒 (濃いダークグレー)
            fill = (30, 41, 59, 255)

        line_width = max(1, int(stroke.width or 4))

        # ── ワールド座標 → キャンバス座標 ────────────────────────────────
        pts = [(pt.x - min_x, pt.y - min_y) for pt in stroke.points]

        if len(pts) == 1:
            # 点のみの場合は円で描く
            r = line_width / 2
            draw.ellipse(
                [pts[0][0] - r, pts[0][1] - r, pts[0][0] + r, pts[0][1] + r],
                fill=fill,
            )
        else:
            draw.line(pts, fill=fill, width=line_width, joint="round")
            # 線端・折れ点を円で滑らかに埋める
            r = line_width / 2
            for px, py in pts:
                draw.ellipse([px - r, py - r, px + r, py + r], fill=fill)

    # ────────────────────────────────────────────────────────────────────────
    # 5. 合成 → RGB 出力
    # ────────────────────────────────────────────────────────────────────────
    final = Image.alpha_composite(canvas, overlay)
    return final.convert("RGB")
