"""YouTube thumbnail for the short Bondrail explainer."""
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
ROOT=Path(__file__).resolve().parents[3];B=ROOT/'brand/bondrail';OUT=B/'social'
S=2;im=Image.new('RGB',(1280*S,720*S),'#202A27');d=ImageDraw.Draw(im)
fonts=ROOT/'apps/web/node_modules/geist/dist/fonts/geist-sans'
def text(x,y,s,size,color='#F6F5EF',bold=False):
 f=ImageFont.truetype(str(fonts/f'Geist-{"SemiBold" if bold else "Regular"}.ttf'),size*S)
 d.text((x*S,y*S),s,font=f,fill=color,anchor='ls')
def line(pts,color,w):d.line([(x*S,y*S) for x,y in pts],fill=color,width=w*S,joint='curve')
def asset(name,x,y,width):
 a=Image.open(B/'png'/name).convert('RGBA');a=a.resize((width*S,round(a.height/a.width*width*S)),Image.Resampling.LANCZOS);im.paste(a,(x*S,y*S),a)
# Continuous rails frame the symbol without crossing its negative space.
line([(915,0),(915,187),(965,237)],'#31483E',22)
line([(886,720),(886,512),(946,452)],'#31483E',22)
line([(1180,354),(1220,394),(1280,394)],'#9FE8CA',9)
asset('bondrail-lockup-dark-1008.png',62,57,300)
text(75,234,'Revenue bonds for',29,'#A5B9AF')
text(75,274,'onchain businesses.',29,'#A5B9AF')
text(69,390,'Issue bonds.',88,bold=True)
text(69,497,'Raise capital.',88,bold=True)
text(75,586,'Repay investors from your revenue.',28,'#A5B9AF')
asset('bondrail-symbol-dark-1024.png',904,242,277)
# Avoid YouTube's duration overlay in the bottom-right corner.
im.resize((1280,720),Image.Resampling.LANCZOS).save(OUT/'bondrail-youtube-explainer-thumbnail.png',optimize=True)
im.resize((320,180),Image.Resampling.LANCZOS).save(OUT/'bondrail-thumbnail-small-preview.png',optimize=True)
p=OUT/'bondrail-youtube-explainer-thumbnail.png';assert p.stat().st_size<2*1024*1024
print(p, p.stat().st_size)
