"""Original opening motion proof. Reference informs editing, never supplies assets/audio."""
from pathlib import Path
from functools import lru_cache
import subprocess,json,math,argparse
import numpy as np
import soundfile as sf
from PIL import Image,ImageDraw,ImageFont,ImageFilter
import imageio_ffmpeg
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'demo/video/output/introduction/opening';OUT.mkdir(parents=True,exist_ok=True)
FF=imageio_ffmpeg.get_ffmpeg_exe();W,H,FPS=1920,1080,60
SCENES=json.loads((OUT/'narration.json').read_text());A=SCENES[0]['duration'];B=A+SCENES[1]['duration'];D=sum(s['duration'] for s in SCENES)
CAP=json.loads((ROOT/'demo/video/output/technical/capture.json').read_text())
FONTS=ROOT/'apps/web/node_modules/geist/dist/fonts/geist-sans';INK='#0D1512';MINT='#9FE8CA';WHITE='#F6F5EF';MUTED='#8FA49A'
def clamp(x):return max(0,min(1,x))
def ease(x):x=clamp(x);return x*x*x*(x*(x*6-15)+10)
def progress(t,a,b):return ease((t-a)/(b-a))
def mix(a,b,u):return a+(b-a)*u
@lru_cache(None)
def font(n,b=False):return ImageFont.truetype(str(FONTS/('Geist-SemiBold.ttf' if b else 'Geist-Regular.ttf')),n)
def text(d,xy,s,n=32,color=WHITE,b=False,anchor=None):d.text(xy,s,font=font(n,b),fill=color,anchor=anchor)
@lru_cache(None)
def symbol(size):
 im=Image.open(ROOT/'brand/bondrail/png/bondrail-symbol-mono-black-1024.png').convert('RGBA').resize((size,size),Image.Resampling.LANCZOS)
 c=Image.new('RGBA',im.size,MINT);c.putalpha(im.getchannel('A'));return c

def base():
 im=Image.new('RGB',(480,270),INK);g=Image.new('RGBA',im.size);d=ImageDraw.Draw(g);d.ellipse((180,-180,600,240),fill=(56,122,94,65));g=g.filter(ImageFilter.GaussianBlur(65));return Image.alpha_composite(im.convert('RGBA'),g).resize((W,H),Image.Resampling.BICUBIC)
BG=base()
def layer():return Image.new('RGBA',(W,H))
def composite(im,l,alpha=1,dx=0,dy=0):
 if alpha<1:l.putalpha(l.getchannel('A').point(lambda v:round(v*clamp(alpha))))
 im.alpha_composite(l,(round(dx),round(dy)))

def prepare(id,start,length):
 p=OUT/f'{id}-source.mp4';subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-ss',str(start),'-i',CAP[id]['video'],'-vf',f'crop=1600:812:0:0,fps={FPS},tpad=stop_mode=clone:stop_duration=20','-t',str(length),'-an','-c:v','libx264','-preset','ultrafast','-crf','18',str(p)],check=True);return p
class Reader:
 def __init__(self,p):
  self.p=subprocess.Popen([FF,'-hide_banner','-loglevel','error','-i',str(p),'-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE);self.last=None
 def next(self):
  data=self.p.stdout.read(1600*812*3)
  if len(data)==1600*812*3:self.last=Image.frombytes('RGB',(1600,812),data)
  return self.last
 def close(self):self.p.stdout.close();self.p.terminate();self.p.wait()
def screen(raw,box,z=1,cx=.5,cy=.5):
 x,y,w,h=map(round,box);sw,sh=raw.size;cw=min(sw,sh*w/h)/z;ch=cw*h/w;lx=max(0,min(sw-cw,cx*sw-cw/2));ly=max(0,min(sh-ch,cy*sh-ch/2));crop=raw.crop((round(lx),round(ly),round(lx+cw),round(ly+ch))).resize((w,h),Image.Resampling.BICUBIC)
 l=layer();mask=Image.new('L',(w,h));ImageDraw.Draw(mask).rounded_rectangle((0,0,w-1,h-1),radius=18,fill=255);l.paste(crop,(x,y),mask);ImageDraw.Draw(l).rounded_rectangle((x,y,x+w,y+h),radius=18,outline='#345144',width=2);return l

def hook(t,raw):
 l=layer();z=mix(1,1.13,progress(t,1.1,4.6));composite(l,screen(raw,(60,65,1800,913),z,.5,.40));return l

def gap(t):
 l=layer();d=ImageDraw.Draw(l);u=progress(t,0,.8)
 text(d,(135,135+24*(1-u)),'Revenue takes time.',78,WHITE,True)
 text(d,(135,243),'The next move needs capital now.',46,MUTED)
 # Concrete costs arrive in sequence, on one continuous canvas.
 labels=[('01','An audit'),('02','More capacity'),('03','A new launch')]
 for i,(num,label) in enumerate(labels):
  v=progress(t,.2+i*.5,.8+i*.5);x=135+i*550;y=365+40*(1-v)
  card=layer();cd=ImageDraw.Draw(card);cd.rounded_rectangle((x,y,x+510,y+154),radius=20,fill='#16231D',outline='#31463B',width=2);text(cd,(x+28,y+26),num,22,MINT);text(cd,(x+28,y+72),label,40,WHITE,True);composite(l,card,v)
 # Timeline: money arrives in increments; current costs precede future inflows.
 y=733;drawTo=135+1650*progress(t,1,2);d.line((135,y,drawTo,y),fill='#466656',width=3)
 for i,(x,label) in enumerate([(135,'TODAY'),(960,'NEXT WEEK'),(1785,'NEXT MONTH')]):
  if t<1+i*.2:continue
  d.ellipse((x-7,y-7,x+7,y+7),fill=MINT);text(d,(x,y+35),label,21,MUTED,anchor='ma')
 for i in range(7):
  p=((t*.16+i/7)%1);x=1785-1500*p
  d.rounded_rectangle((x-16,y-54,x+16,y-23),radius=8,fill=MINT)
 if t>3.5:
  v=progress(t,3.5,4.3);tag=layer();td=ImageDraw.Draw(tag);td.rounded_rectangle((135,827,715,906),radius=15,fill=MINT);text(td,(167,844),'Capital needed before revenue arrives.',25,INK,True);composite(l,tag,v)
 return l

def answer(t,raw):
 l=layer();d=ImageDraw.Draw(l);reveal=progress(t,0,1);shift=progress(t,2.3,3.5)
 size=round(mix(176,88,shift));x=round(mix(872,120,shift));y=round(mix(240,177,shift));l.alpha_composite(symbol(size),(x,y))
 titleSize=round(mix(90,66,shift));titleWidth=d.textlength('Bondrail',font=font(titleSize,True));text(d,(mix((W-titleWidth)/2,120,shift),mix(465,300,shift)),'Bondrail',titleSize,WHITE,True)
 if shift<.9:
  c=layer();cd=ImageDraw.Draw(c);text(cd,(960,588),'Revenue bonds for onchain businesses.',45,MUTED,anchor='ma');composite(l,c,1-shift)
 if shift>0:
  c=layer();cd=ImageDraw.Draw(c);text(cd,(120,422),'Issue a bond.',52,WHITE,True);text(cd,(120,494),'Raise capital.',52,WHITE,True);text(cd,(120,592),'Repay from revenue.',35,MINT)
  text(cd,(120,819),'ACTUAL PRODUCT · MONAD TESTNET',18,MUTED);composite(l,c,shift)
  # Enter with the same rightward camera direction as the preceding timeline.
  z=mix(1.0,1.08,progress(t,4,8));composite(l,screen(raw,(720+125*(1-shift),170,1110,650),z,.5,.4),shift)
 return l

def captions(im,t):
 off=0;active=None
 for s in SCENES:
  for line in s['lines']:
   if off+line['start']<=t<off+line['end']:
    # Short caption chunks, timed to this sentence's relative progress.
    words=line['text'].split();groups=[];g=[]
    for w in words:
     if len(' '.join(g+[w]))>72 and g:groups.append(g);g=[]
     g.append(w)
    if g:groups.append(g)
    pos=(t-off-line['start'])/(line['end']-line['start'])*len(words);total=0
    for g in groups:
     total+=len(g)
     if pos<total:active=' '.join(g);break
  off+=s['duration']
 if active:
  d=ImageDraw.Draw(im);width=d.textlength(active,font=font(31));x=(W-width)/2;d.rounded_rectangle((x-22,994,x+width+22,1051),radius=10,fill='#070D0A');text(d,(x,1002),active,31)

def render():
 heroStart=next(m['at'] for m in CAP['opening']['marks'] if m['label']=='ready');issueStart=next(m['at'] for m in CAP['issue']['marks'] if m['label']=='terms-ready')
 hero=Reader(prepare('opening',heroStart,A+.7));ui=Reader(prepare('issue',issueStart-.8,D-B+1));lastHero=None;lastUI=None
 video=OUT/'motion-silent.mp4';p=subprocess.Popen([FF,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s','1920x1080','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-threads','4',str(video)],stdin=subprocess.PIPE)
 try:
  for n in range(round(D*FPS)):
   t=n/FPS;im=BG.copy()
   if t<A+.55:lastHero=hero.next()
   if t>B-.55:lastUI=ui.next()
   if t<A-.55:composite(im,hook(t,lastHero))
   elif t<A+.55:
    v=progress(t,A-.55,A+.55);composite(im,hook(t,lastHero),1-v,dx=-150*v);composite(im,gap(max(0,t-A+.55)),v,dx=150*(1-v))
   elif t<B-.55:composite(im,gap(t-A))
   elif t<B+.55:
    v=progress(t,B-.55,B+.55);composite(im,gap(t-A),1-v,dy=-70*v);composite(im,answer(max(0,t-B+.55),lastUI),v,dy=70*(1-v))
   else:composite(im,answer(t-B+.55,lastUI))
   captions(im,t)
   if t<.35:im=Image.blend(Image.new('RGBA',(W,H),INK),im,progress(t,0,.35))
   if t>D-.5:im=Image.blend(im,Image.new('RGBA',(W,H),INK),progress(t,D-.5,D))
   p.stdin.write(im.convert('RGB').tobytes())
   if n%600==0:print(f'{t:.0f}/{D:.1f}s',flush=True)
 finally:p.stdin.close();p.wait();hero.close();ui.close()
 if p.returncode:raise RuntimeError('Encoder failed')
 # Original quiet tonal bed, ducked under the voice; no reference music reused.
 sr=24000;voice=np.concatenate([sf.read(s['audio'],dtype='float32')[0] for s in SCENES]);tt=np.arange(len(voice))/sr;bed=np.zeros_like(voice)
 for f in [130.8128,195.9977,261.6256]:bed+=.009*np.sin(2*np.pi*f*tt)*(.65+.35*np.sin(2*np.pi*.12*tt))
 fade=np.minimum(np.clip(tt/1.5,0,1),np.clip((D-tt)/1.2,0,1));audio=np.clip(voice+bed*fade,-.98,.98);sf.write(OUT/'mix.wav',audio,sr)
 dest=OUT/'bondrail-introduction-motion-preview.mp4';subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-i',str(video),'-i',str(OUT/'mix.wav'),'-c:v','copy','-af','loudnorm=I=-16:TP=-1.5:LRA=7','-c:a','aac','-b:a','192k','-t',str(D),'-movflags','+faststart',str(dest)],check=True);print(dest,flush=True)
if __name__=='__main__':render()
