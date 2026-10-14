"""Original Bondrail brand film. All animated artwork and music are generated locally."""
from pathlib import Path
from functools import lru_cache
import math,subprocess,json,argparse
import numpy as np
import soundfile as sf
from PIL import Image,ImageDraw,ImageFont,ImageFilter
import imageio_ffmpeg

ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'demo/video/output/explainer';OUT.mkdir(parents=True,exist_ok=True)
W,H,FPS,DURATION=1920,1080,60,24.8
INK='#202A27';MINT='#9FE8CA';PAPER='#F6F5EF';MUTED='#72847B';LINE='#DCE4DC'
FF=imageio_ffmpeg.get_ffmpeg_exe();FONTS=ROOT/'apps/web/node_modules/geist/dist/fonts/geist-sans'
def clamp(t):return max(0,min(1,t))
def ease(t):t=clamp(t);return t*t*(3-2*t)
def out(t):return 1-(1-clamp(t))**3
def ramp(t,a,b):return ease((t-a)/(b-a))
@lru_cache(None)
def font(size,bold=False):return ImageFont.truetype(str(FONTS/f'Geist-{"SemiBold" if bold else "Regular"}.ttf'),size)
def txt(d,x,y,s,size=40,color=INK,bold=False,anchor='la'):
 d.text((x,y),s,font=font(size,bold),fill=color,anchor=anchor)
def centered(d,y,s,size=60,color=INK,bold=False):txt(d,W/2,y,s,size,color,bold,'ma')
def layer():return Image.new('RGBA',(W,H),(0,0,0,0))
def paste(im,l,alpha=1,dx=0,dy=0):
 if alpha<1:l.putalpha(l.getchannel('A').point(lambda v:int(v*clamp(alpha))))
 im.alpha_composite(l,(round(dx),round(dy)))
@lru_cache(None)
def asset(name,width):
 a=Image.open(ROOT/'brand/bondrail/png'/name).convert('RGBA');return a.resize((width,round(a.height*width/a.width)),Image.Resampling.LANCZOS)

def background():
 a=Image.new('RGB',(480,270),PAPER);g=Image.new('RGBA',a.size,(0,0,0,0));d=ImageDraw.Draw(g)
 d.ellipse((-120,-130,180,180),fill=(159,232,202,110));d.ellipse((330,120,620,390),fill=(159,232,202,90))
 g=g.filter(ImageFilter.GaussianBlur(55));a=Image.alpha_composite(a.convert('RGBA'),g)
 return a.resize((W,H),Image.Resampling.LANCZOS)
BG=background()
def line_progress(d,points,p,color=MINT,width=5):
 lengths=[math.dist(points[i],points[i+1]) for i in range(len(points)-1)];budget=sum(lengths)*clamp(p)
 for i,ln in enumerate(lengths):
  if budget<=0:break
  x,y=points[i];xx,yy=points[i+1];f=min(1,budget/ln);d.line((x,y,x+(xx-x)*f,y+(yy-y)*f),fill=color,width=width);budget-=ln

def dot_path(d,points,p,r=8,color=INK):
 lengths=[math.dist(points[i],points[i+1]) for i in range(len(points)-1)];b=sum(lengths)*clamp(p)
 for i,ln in enumerate(lengths):
  if b<=ln:
   x,y=points[i];xx,yy=points[i+1];f=b/ln;px=x+(xx-x)*f;py=y+(yy-y)*f;d.ellipse((px-r,py-r,px+r,py+r),fill=color);return
  b-=ln

def bond_card(t):
 l=layer();d=ImageDraw.Draw(l);x,y,w,h=170,250,560,590
 # Grounding shadow is quiet and flat; no mock device frame.
 d.rounded_rectangle((x+6,y+14,x+w+6,y+h+14),radius=32,fill='#E1E8DF')
 d.rounded_rectangle((x,y,x+w,y+h),radius=32,fill='#FFFFFF',outline=LINE,width=2)
 d.rounded_rectangle((x+30,y+30,x+w-30,y+174),radius=18,fill=INK)
 mark=asset('bondrail-symbol-dark-512.png',74);l.alpha_composite(mark,(x+50,y+53))
 txt(d,x+144,y+54,'Your business',32,PAPER,True);txt(d,x+144,y+102,'Onchain revenue',22,MINT)
 txt(d,x+34,y+202,'Revenue bond',43,INK,True)
 status='Set your terms' if t<9 else ('Funding' if t<12.5 else ('Funded' if t<15 else 'Repaying'))
 d.rounded_rectangle((x+34,y+264,x+252,y+309),radius=22,fill=MINT)
 txt(d,x+54,y+273,status,23,INK,True)
 txt(d,x+34,y+343,'Revenue share',24,MUTED);txt(d,x+w-34,y+343,'Defined by you',24,INK,False,'ra')
 txt(d,x+34,y+389,'Repayment cap',24,MUTED);txt(d,x+w-34,y+389,'Set in the bond',24,INK,False,'ra')
 d.line((x+34,y+438,x+w-34,y+438),fill=LINE,width=2)
 label='Terms investors can assess' if t<9 else ('Investor capital' if t<15 else 'Revenue toward repayment')
 txt(d,x+34,y+468,label,23,INK)
 d.rounded_rectangle((x+34,y+516,x+w-34,y+530),radius=7,fill='#EDF1EB')
 p=.0 if t<9 else (ramp(t,9.3,12.5) if t<15 else .08+.66*ramp(t,15,19.3))
 if p>0:d.rounded_rectangle((x+34,y+516,x+34+(w-68)*p,y+530),radius=7,fill=INK if t<15 else '#5ABD98')
 return l

def investor_network(t):
 l=layer();d=ImageDraw.Draw(l);reveal=ramp(t,8.5,9.3)
 # Same people remain in place as funding becomes repayment.
 for i,yy in enumerate([375,540,705]):
  path=[(852,yy),(796,yy),(765,545),(730,545)]
  line_progress(d,path,reveal,LINE,3)
  p=clamp((t-9.1-i*.37)/3.0)
  if 0<p<1:dot_path(d,path,p,9,INK)
  if t>15:
   q=((t-15)/1.7-i*.21)%1
   dot_path(d,list(reversed(path)),q,8,'#52AF89')
  d.ellipse((842,yy-39,920,yy+39),fill=INK if t<15 else MINT)
  color=PAPER if t<15 else INK
  d.ellipse((872,yy-18,890,yy),fill=color)
  d.arc((862,yy-1,900,yy+33),180,360,fill=color,width=5)
 txt(d,881,787,'Investors',22,MUTED,False,'ma')
 return l

def mechanism(t):
 l=layer();progress=out((t-4.4)/.9)
 paste(l,bond_card(t),progress,dx=-70*(1-progress),dy=20*(1-progress))
 if t>8.5:paste(l,investor_network(t),ramp(t,8.5,9.3),dx=20*(1-ramp(t,8.5,9.3)))
 d=ImageDraw.Draw(l)
 steps=[('Issue a revenue bond.',5.0,9.1),('Investors fund it.',9.1,14.9),('Revenue flows back.',14.9,20)]
 for i,(words,start,end) in enumerate(steps):
  a=ramp(t,start,start+.6)
  if a<=0:continue
  active=t<end;sl=layer();sd=ImageDraw.Draw(sl);yy=342+i*144
  if active:
   # Expanding highlight is the only saturated editorial emphasis.
   tw=sd.textlength(words,font=font(45,True));sd.rounded_rectangle((1040,yy-7,1040+(tw+28)*out((t-start)/.7),yy+58),radius=9,fill=MINT)
  txt(sd,1054,yy,words,45,INK if active else MUTED,active)
  caption=['Set a revenue share and repayment cap.','Raise capital for your next move.','A share goes toward investor repayment.'][i]
  if active:txt(sd,1056,yy+71,caption,25,MUTED)
  paste(l,sl,a,dy=16*(1-a))
 txt(d,170,888,'How it works · illustration',20,MUTED)
 return l

def frame(t):
 im=BG.copy();d=ImageDraw.Draw(im)
 if t<5.0:
  a=out(t/.65)*(1-ramp(t,3.9,4.8));l=layer();ld=ImageDraw.Draw(l)
  centered(ld,407,'Your business earns.',76,INK,True)
  if t>1.05:
   q=ramp(t,1.05,1.8);ll=layer();dd=ImageDraw.Draw(ll);centered(dd,511,'Your next move needs capital.',62,INK)
   paste(l,ll,q,dy=22*(1-q))
  paste(im,l,a,dy=-28*ramp(t,3.9,4.8))
 if 4.4<=t<19.9:
  q=1-ramp(t,19.2,19.9);paste(im,mechanism(t),q,dx=-36*(1-q))
  # Logo stays small during the mechanism, then grows into the closing lockup.
  logo=asset('bondrail-lockup-light-1008.png',235);ll=layer();ll.alpha_composite(logo,(155,110));paste(im,ll,q)
 if t>=19.9:
  a=ramp(t,19.9,20.55);l=layer();ld=ImageDraw.Draw(l)
  # Clean paper wipe creates space for the brand reveal.
  l.alpha_composite(BG)
  logo=asset('bondrail-lockup-light-1008.png',660);l.alpha_composite(logo,((W-logo.width)//2,357))
  centered(ld,567,'Revenue bonds for onchain businesses.',48,INK)
  q=ramp(t,20.7,21.3);ll=layer();dd=ImageDraw.Draw(ll)
  centered(dd,678,'Issue bonds. Raise capital.',32,MUTED)
  centered(dd,807,'bondrail.vercel.app',30,INK)
  centered(dd,857,'Live on Monad testnet',21,MUTED)
  paste(l,ll,q,dy=12*(1-q));paste(im,l,a,dy=18*(1-a))
 return im.convert('RGB')

def soundtrack():
 sr=48000;n=round(DURATION*sr);music=np.zeros((n,2),np.float64);rng=np.random.default_rng(18);beat=.6
 def add(start,samples,pan=0):
  pos=round(start*sr);end=min(n,pos+len(samples));s=samples[:end-pos]
  if pos>=0 and end>pos:music[pos:end,0]+=s*math.sqrt((1-pan)/2);music[pos:end,1]+=s*math.sqrt((1+pan)/2)
 # Warm original chords, simple bass and soft percussion. No sampled/reference audio.
 chords=[[146.83,220,293.66,369.99],[130.81,196,261.63,329.63],[164.81,246.94,329.63,392],[110,164.81,220,329.63]]
 for bar in range(11):
  start=bar*beat*4;dur=min(3.0,DURATION-start)
  if dur<=0:continue
  tt=np.arange(round(dur*sr))/sr;env=np.minimum(1,tt/.22)*np.minimum(1,(dur-tt)/.6)
  for j,f in enumerate(chords[bar%4]):add(start,.027*np.sin(2*np.pi*f*tt)*env,(-.5+j/3))
 for i in range(math.ceil(DURATION/beat)):
  start=i*beat;tt=np.arange(round(.28*sr))/sr
  add(start,.10*np.sin(2*np.pi*(54*tt+45*.025*(1-np.exp(-tt/.025))))*np.exp(-tt*19))
  if i%2:
   tt=np.arange(round(.11*sr))/sr;noise=rng.normal(0,1,len(tt));add(start,.018*noise*np.exp(-tt*45),.15)
  tt=np.arange(round(.042*sr))/sr;add(start+beat/2,.009*rng.normal(0,1,len(tt))*np.exp(-tt*95),-.35)
 # Sparse bell notes echo the diagram's moving payment dots.
 for i in range(36):
  start=3+i*beat/2
  if start>21:break
  tt=np.arange(round(.6*sr))/sr;f=[587.33,739.99,880,659.25,493.88,659.25][i%6]
  add(start,.022*(np.sin(2*np.pi*f*tt)+.15*np.sin(2*np.pi*2*f*tt))*np.exp(-tt*7)*np.minimum(1,tt/.008),.45 if i%2 else -.45)
 for start in [4.5,9.1,14.9,19.7]:
  tt=np.arange(round(.25*sr))/sr;env=np.sin(np.pi*tt/.25)**2
  add(start,.012*rng.normal(0,1,len(tt))*env)
 fade=np.minimum(1,np.arange(n)/sr/.7)*np.minimum(1,(DURATION-np.arange(n)/sr)/1.1)
 music*=fade[:,None];music*=.38/max(.001,np.abs(music).max())
 sf.write(OUT/'soundtrack.wav',music,sr,subtype='PCM_24')

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--preview',action='store_true');args=parser.parse_args()
 if args.preview:
  times=[.9,2.8,5.9,8,10.8,13.2,16.1,18.5,20.7,23]
  board=Image.new('RGB',(960,270*5),PAPER);bd=ImageDraw.Draw(board)
  for i,t in enumerate(times):
   f=frame(t);f.save(OUT/f'preview-{t}.jpg');f=f.resize((480,270));board.paste(f,((i%2)*480,(i//2)*270));bd.text(((i%2)*480+8,(i//2)*270+8),str(t),fill=INK)
  board.save(OUT/'storyboard.jpg');print('Preview ready',flush=True)
 else:
  soundtrack();dest=OUT/'bondrail-explainer.mp4'
  cmd=[FF,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-i',str(OUT/'soundtrack.wav'),'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-movflags','+faststart','-shortest',str(dest)]
  proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
  for i in range(round(DURATION*FPS)):
   proc.stdin.write(frame(i/FPS).tobytes())
   if i%(FPS*3)==0:print(f'Rendered {i/FPS:.0f}s / {DURATION}s',flush=True)
  proc.stdin.close()
  if proc.wait()!=0:raise RuntimeError('FFmpeg encoding failed')
  print(dest,flush=True)
