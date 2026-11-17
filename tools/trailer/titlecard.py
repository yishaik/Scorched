#!/usr/bin/env python3
"""Render the trailer title cards (landscape 1920x1080 and optional portrait 1080x1920).

Uses a captured gameplay still as a darkened, blurred backdrop, the existing
Play icon, and text set in fonts that already ship on the machine (Bebas Neue
+ Geist), matching marketing/COPY.md. 'Google Play' is drawn as plain text —
no official badge artwork.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageEnhance

BEBAS = "/usr/share/fonts/truetype/sand-box/google/Bebas Neue/BebasNeue-Regular.ttf"
GEIST = "/usr/share/fonts/truetype/sand-box/google/Geist/Geist-VariableFont_wght.ttf"
TAGLINE = "Aim. Fire. Scorch the earth."
TITLE = "SCORCHED TANKS"
STORE = "Google Play"


def font(path: str, size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(path, size)
    except OSError:
        return ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", size)


def backdrop(src: Path, size: tuple[int, int]) -> Image.Image:
    im = Image.open(src).convert("RGB")
    # Cover-scale, blur, darken so type stays readable.
    scale = max(size[0] / im.width, size[1] / im.height)
    im = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.Resampling.LANCZOS)
    l = (im.width - size[0]) // 2
    t = (im.height - size[1]) // 2
    im = im.crop((l, t, l + size[0], t + size[1]))
    im = im.filter(ImageFilter.GaussianBlur(radius=18))
    im = ImageEnhance.Brightness(im).enhance(0.38)
    im = ImageEnhance.Color(im).enhance(0.85)
    # Warm top-to-bottom veil in brand colours.
    veil = Image.new("RGB", size, (10, 8, 24))
    return Image.blend(im, veil, 0.35)


def draw_centered(draw: ImageDraw.ImageDraw, xy, text, font_, fill, stroke=None):
    x, y = xy
    bbox = draw.textbbox((0, 0), text, font=font_)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    kw = {"anchor": "ms"}
    if stroke:
        draw.text((x, y), text, font=font_, fill=fill, stroke_width=stroke[0], stroke_fill=stroke[1], **kw)
    else:
        draw.text((x, y), text, font=font_, fill=fill, **kw)
    return w, h


def compose(bg_path: Path, icon_path: Path, size: tuple[int, int], out: Path) -> None:
    canvas = backdrop(bg_path, size).convert("RGBA")
    W, H = size
    icon = Image.open(icon_path).convert("RGBA")
    icon_size = 200 if W > H else 220
    icon = icon.resize((icon_size, icon_size), Image.Resampling.LANCZOS)
    # Rounded square so it reads as a store icon, no official badge.
    mask = Image.new("L", icon.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, icon_size - 1, icon_size - 1), radius=int(icon_size * 0.22), fill=255)
    icon.putalpha(mask)
    if W > H:
        ix, iy = (W - icon_size) // 2, int(H * 0.14)
        title_y = iy + icon_size + int(H * 0.14)
        tag_y = title_y + int(H * 0.13)
        store_y = int(H * 0.86)
        title_size, tag_size, store_size = 118, 44, 36
    else:
        ix, iy = (W - icon_size) // 2, int(H * 0.20)
        title_y = iy + icon_size + int(H * 0.10)
        tag_y = title_y + int(H * 0.09)
        store_y = int(H * 0.84)
        title_size, tag_size, store_size = 108, 40, 34

    canvas.paste(icon, (ix, iy), icon)
    draw = ImageDraw.Draw(canvas)
    title_font = font(BEBAS, title_size)
    tag_font = font(GEIST, tag_size)
    store_font = font(GEIST, store_size)
    draw_centered(draw, (W / 2, title_y), TITLE, title_font, "#FFF3B0", stroke=(4, "#1A0E2A"))
    draw_centered(draw, (W / 2, tag_y), TAGLINE, tag_font, "#FFFFFF")
    # a thin gold rule between tagline and store text
    rule_y = (tag_y + store_y) // 2
    draw.rectangle((W * 0.38, rule_y, W * 0.62, rule_y + 3), fill="#FF8A2A")
    draw_centered(draw, (W / 2, store_y), STORE, store_font, "#D8D8E8")
    canvas.convert("RGB").save(out, "PNG")
    print("wrote", out, size)


def main() -> None:
    p = argparse.ArgumentParser()
    p.add_argument("--bg", required=True)
    p.add_argument("--icon", required=True)
    p.add_argument("--out", required=True)
    p.add_argument("--portrait-out")
    args = p.parse_args()
    compose(Path(args.bg), Path(args.icon), (1920, 1080), Path(args.out))
    if args.portrait_out:
        compose(Path(args.bg), Path(args.icon), (1080, 1920), Path(args.portrait_out))


if __name__ == "__main__":
    main()
