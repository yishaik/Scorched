#!/usr/bin/env python3
"""Inline the local CSS/JS files that game/index.html links (hark.css, hark-hero.css, hark.js)
so the single-file game served at /play looks the same as the APK. Usage: inline_assets.py <game_dir> <out>"""
import re, sys, os
d, out = sys.argv[1], sys.argv[2]
h = open(os.path.join(d, "index.html"), encoding="utf-8").read()
def css(m):
    p = os.path.join(d, m.group(1))
    return "<style>\n" + open(p, encoding="utf-8").read() + "\n</style>" if os.path.exists(p) else m.group(0)
def js(m):
    p = os.path.join(d, m.group(1))
    return "<script>\n" + open(p, encoding="utf-8").read().replace("</script", "<\\/script") + "\n</script>" if os.path.exists(p) else m.group(0)
h = re.sub(r'<link rel="stylesheet" href="([\w.-]+\.css)"\s*/?>', css, h)
h = re.sub(r'<script src="([\w.-]+\.js)"></script>', js, h)
open(out, "w", encoding="utf-8").write(h)
