"""Graphic-only Envio sponsor thumbnail, using the established Bondrail identity."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[3]; B=ROOT/'brand/bondrail'; OUT=B/'social'
S=2
im=Image.new('RGB',(1280*S,720*S),'#101E19'); d=ImageDraw.Draw(im)
fonts=ROOT/'apps/web/node_modules/geist/dist/fonts/geist-sans'
def text(x,y,s,size,color='#F6F5EF',bold=False):
 f=ImageFont.truetype(str(fonts/f'Geist-{"SemiBold" if bold else "Regular"}.ttf'),size*S)
 d.text((x*S,y*S),s,font=f,fill=color,anchor='ls')
def line(points,color='#9FE8CA',width=3):
 d.line([(x*S,y*S) for x,y in points],fill=color,width=width*S,joint='curve')
def box(bounds,fill,outline=None,r=20):
 d.rounded_rectangle(tuple(v*S for v in bounds),radius=r*S,fill=fill,outline=outline,width=2*S)
def asset(name,x,y,w):
 a=Image.open(B/'png'/name).convert('RGBA'); a=a.resize((w*S,round(a.height/a.width*w*S)),Image.Resampling.LANCZOS); im.paste(a,(x*S,y*S),a)
# Three distinct integrations, joined by a restrained multiplication motif.
text(65,64,'BONDRAIL / ENVIO HYPERINDEX DEMO',20,'#A8BFB3',True)
box((909,32,1215,79),'#20362C',r=23)
text(930,63,'MONAD TESTNET',20,'#BCECD7',True)
def symbol(p,cx,y,w):
 a=Image.open(p).convert('RGBA');a=a.crop(a.getbbox());a=a.resize((w*S,round(a.height/a.width*w*S)),Image.Resampling.LANCZOS);im.paste(a,(round(cx*S-a.width/2),y*S),a)
box((110,118,350,350),'#332519','#BD8348',36)
box((520,103,760,365),'#294B3B','#6FAD91',36)
box((930,118,1170,350),'#241B45','#7558DE',36)
symbol(B/'third-party/envio-logo-square.png',230,211,196)
symbol(B/'png/bondrail-symbol-dark-1024.png',640,149,152)
symbol(B/'third-party/monad-symbol-white.png',1050,163,137)
text(421,262,'×',56,'#718C7E')
text(831,262,'×',56,'#718C7E')
text(180,402,'Envio',35,bold=True)
text(557,417,'Bondrail',38,'#B2EED2',True)
text(982,402,'Monad',35,bold=True)
text(63,535,'Real payments.',86,bold=True)
text(63,633,'Useful data.',86,'#A7EDD0',True)
box((854,505,1207,616),'#192D23','#395A48',22)
line([(881,551),(894,564),(918,536)],'#A7EDD0',5)
text(938,555,'LIVE INDEXED DATA',19,'#BCECD7',True)
text(881,589,'Powered by HyperIndex',21,'#C0D0C7')
OUT.mkdir(parents=True,exist_ok=True)
p=OUT/'bondrail-youtube-envio-thumbnail.png'
im.resize((1280,720),Image.Resampling.LANCZOS).save(p,optimize=True)
im.resize((320,180),Image.Resampling.LANCZOS).save(OUT/'bondrail-youtube-envio-thumbnail-preview.png')
assert p.stat().st_size<2*1024*1024
print(p,p.stat().st_size)
