"""Adapt the approved Twitter artwork to YouTube's 2560×1440 canvas."""
from pathlib import Path
from PIL import Image, ImageDraw
ROOT=Path(__file__).resolve().parents[3]
OUT=ROOT/'brand/bondrail/social'
canvas=Image.new('RGB',(2560,1440),'#202A27')
# All original wording and artwork sit in a 1260×420 central panel,
# inside the common 1546×423 all-device safe area.
art=Image.open(OUT/'bondrail-twitter-header-2x.png').convert('RGB')
art=art.resize((1260,420),Image.Resampling.LANCZOS)
x,y=650,510
canvas.paste(art,(x,y))
d=ImageDraw.Draw(canvas)
# Continue the existing decorative rails across the larger TV canvas.
d.line([(1557,0),(1557,510)],fill='#31483E',width=22)
d.line([(1507,930),(1507,1440)],fill='#31483E',width=22)
d.line([(1910,765),(2560,765)],fill='#9FE8CA',width=8)
p=OUT/'bondrail-youtube-banner.png';canvas.save(p,optimize=True)
canvas.crop((507,509,2053,932)).save(OUT/'bondrail-youtube-mobile-preview.png',optimize=True)
assert canvas.size==(2560,1440)
assert p.stat().st_size<6*1024*1024
print(p, p.stat().st_size, 'bytes')
