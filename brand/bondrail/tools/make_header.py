"""Rebuild Bondrail's X header with Pillow and the approved identity assets."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
import base64

ROOT = Path(__file__).resolve().parents[3]
BRAND = ROOT / 'brand/bondrail'
FONTS = ROOT / 'apps/web/node_modules/geist/dist/fonts/geist-sans'
OUT = BRAND / 'social'
S = 2
INK, MINT, PAPER, MUTED = '#202A27', '#9FE8CA', '#F6F5EF', '#A5B9AF'
im = Image.new('RGB', (1500*S, 500*S), INK)
d = ImageDraw.Draw(im)
svg = []
def txt(x,y,value,size,color=PAPER,bold=False):
 f=ImageFont.truetype(str(FONTS / ('Geist-SemiBold.ttf' if bold else 'Geist-Regular.ttf')),size*S)
 d.text((x*S,y*S),value,font=f,fill=color,anchor='ls')
 svg.append(f'<text x="{x}" y="{y}" font-family="Geist" font-weight="{600 if bold else 400}" font-size="{size}" fill="{color}">{value}</text>')
def line(points,color,width):
 d.line([(x*S,y*S) for x,y in points],fill=color,width=width*S,joint='curve')
 coords=' '.join(f'{x},{y}' for x,y in points)
 svg.append(f'<polyline points="{coords}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linejoin="round"/>')
def asset(name,x,y,w,h):
 src=Image.open(BRAND/'png'/f'{name}.png').convert('RGBA').resize((w*S,h*S),Image.Resampling.LANCZOS)
 im.paste(src,(x*S,y*S),src)
 source=(BRAND/'svg'/f'{name.rsplit("-",1)[0]}.svg').read_text()
 source=source[source.index('<svg'):].replace('<svg ',f'<svg x="{x}" y="{y}" ',1)
 import re
 source=re.sub(r'width="[^"]+"',f'width="{w}"',source,count=1)
 source=re.sub(r'height="[^"]+"',f'height="{h}"',source,count=1)
 svg.append(source)
# An understated rail system; the unequal paths suggest a repayment allocation.
line([(1020,500),(1020,330),(1080,270),(1180,270)],'#31483E',26)
line([(1080,0),(1080,130),(1140,190),(1180,190)],'#31483E',26)
line([(1376,244),(1400,244),(1460,304),(1500,304)],MINT,10)
asset('bondrail-symbol-dark-1024',1170,134,210,210)
asset('bondrail-lockup-dark-1008',92,49,260,63)
txt(114,147,'Revenue bonds for onchain businesses.',21,MUTED)
txt(110,224,'Issue bonds.',66,bold=True)
txt(110,298,'Raise capital.',66,bold=True)
txt(114,348,'Repay investors from your revenue.',25,MUTED)
txt(1120,414,'bondrail.vercel.app',23,MINT)
# Keep the lower-left clear for the profile avatar overlay.
im.resize((1500,500),Image.Resampling.LANCZOS).save(OUT/'bondrail-twitter-header.png',optimize=True)
im.save(OUT/'bondrail-twitter-header-2x.png',optimize=True)
faces=''
for weight,name in [(400,'Regular'),(600,'SemiBold')]:
 data=base64.b64encode((FONTS/f'Geist-{name}.ttf').read_bytes()).decode()
 faces+=f"@font-face{{font-family:Geist;font-weight:{weight};src:url(data:font/ttf;base64,{data}) format('truetype');}}"
(OUT/'bondrail-twitter-header.svg').write_text('<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="500" viewBox="0 0 1500 500"><title>Bondrail — Revenue bonds for onchain businesses</title><defs><style>'+faces+'</style></defs><rect width="1500" height="500" fill="'+INK+'"/>'+''.join(svg)+'</svg>')
print(OUT/'bondrail-twitter-header.png')
