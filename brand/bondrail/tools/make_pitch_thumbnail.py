"""Graphic-only founder pitch thumbnail, using the established Bondrail identity."""
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
asset('bondrail-lockup-dark-1008.png',64,49,290)
box((998,54,1216,98),'#20362C',r=22)
text(1021,84,'FOUNDER PITCH',18,'#BCECD7',True)
text(61,263,'Revenue',100,bold=True)
text(61,371,'bonds.',100,'#A7EDD0',True)
text(67,449,'For onchain',43,bold=True)
text(67,503,'businesses.',43,bold=True)
line([(68,557),(615,557)],'#375347',2)
text(68,608,'Issue bonds. Raise capital.',30,'#C0D0C7')
# A bond sits between the two sides of the financing relationship.
box((823,155,1126,219),'#22392F',r=12)
text(892,197,'INVESTORS',23,'#D9E9E1',True)
line([(865,220),(865,267)])
line([(857,257),(865,267),(873,257)])
text(888,253,'CAPITAL',15,'#A7EDD0',True)
box((780,282,1170,484),'#294437','#6B9D85',24)
asset('bondrail-symbol-dark-1024.png',1061,303,76)
text(808,327,'BONDRAIL',16,'#A7EDD0',True)
text(808,391,'Revenue bond',34,bold=True)
line([(809,413),(1137,413)],'#557563',2)
text(809,455,'Defined terms. Revenue repayment.',17,'#D0E3D8')
line([(865,485),(865,536)])
line([(857,526),(865,536),(873,526)])
box((803,548,1146,612),'#22392F',r=12)
text(833,589,'ONCHAIN BUSINESS',23,'#D9E9E1',True)
# Return rail: revenue travels back toward investors.
line([(1147,580),(1210,580),(1210,185),(1137,185)],'#76AF95',3)
line([(1147,177),(1137,185),(1147,193)],'#76AF95',3)
text(888,521,'CAPITAL RELEASE',14,'#A7EDD0',True)
text(901,646,'REVENUE → REPAYMENT',14,'#A7EDD0',True)
OUT.mkdir(parents=True,exist_ok=True)
p=OUT/'bondrail-youtube-pitch-thumbnail.png'
im.resize((1280,720),Image.Resampling.LANCZOS).save(p,optimize=True)
im.resize((320,180),Image.Resampling.LANCZOS).save(OUT/'bondrail-youtube-pitch-thumbnail-preview.png')
assert p.stat().st_size<2*1024*1024
print(p)
