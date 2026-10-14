"""Founder-led Bondrail pitch: original slides, local blur, synchronized real face/voice."""
from pathlib import Path
from functools import lru_cache
import subprocess,json,math,argparse
import numpy as np
from PIL import Image,ImageDraw,ImageFilter,ImageFont
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import imageio_ffmpeg
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'demo/video/output/founder-pitch';FF=imageio_ffmpeg.get_ffmpeg_exe();W,H,FPS=1920,1080,30
EDIT=json.loads((OUT/'edit.json').read_text());D=EDIT['seconds'];INK='#101A15';PAPER='#F6F5EF';MINT='#9FE8CA';MUTED='#9BB0A3';LINE='#334C3E'
FONTS=ROOT/'apps/web/node_modules/geist/dist/fonts/geist-sans'
@lru_cache(None)
def font(size,bold=False):return ImageFont.truetype(str(FONTS/('Geist-SemiBold.ttf' if bold else 'Geist-Regular.ttf')),size)
def text(d,xy,s,size=32,color=PAPER,bold=False,anchor=None):d.text(xy,s,font=font(size,bold),fill=color,anchor=anchor)
def clamp(x):return max(0,min(1,x))
def ease(x):x=clamp(x);return x*x*x*(x*(x*6-15)+10)
def ramp(t,a,b):return ease((t-a)/(b-a))
def lerp(a,b,u):return a+(b-a)*u
@lru_cache(None)
def logo(size):
 a=Image.open(ROOT/'brand/bondrail/png/bondrail-symbol-mono-black-1024.png').convert('RGBA').resize((size,size),Image.Resampling.LANCZOS);b=Image.new('RGBA',a.size,MINT);b.putalpha(a.getchannel('A'));return b

def background():
 im=Image.new('RGB',(480,270),INK);l=Image.new('RGBA',im.size);d=ImageDraw.Draw(l);d.ellipse((180,-110,620,290),fill=(58,115,81,43));return Image.alpha_composite(im.convert('RGBA'),l.filter(ImageFilter.GaussianBlur(65))).resize((W,H),Image.Resampling.BICUBIC).convert('RGB')
BG=background()
def brand(im,label):
 im.paste(logo(40),(72,47),logo(40));d=ImageDraw.Draw(im);text(d,(128,44),'Bondrail',32,PAPER,True);text(d,(1810,54),label.upper(),18,MUTED,anchor='ra')
def header(im,title,sub):
 d=ImageDraw.Draw(im);text(d,(100,145),title,64,PAPER,True);text(d,(102,231),sub,30,MUTED)
def card(im,x,y,w,h,k,title,lines,accent=False):
 d=ImageDraw.Draw(im);d.rounded_rectangle((x,y,x+w,y+h),radius=22,fill='#182A20' if accent else '#16221B',outline=MINT if accent else LINE,width=2);text(d,(x+27,y+27),k,20,MINT);text(d,(x+27,y+85),title,36,PAPER,True)
 for j,line in enumerate(lines):text(d,(x+27,y+144+j*39),line,27,MUTED)
def arrow(d,x1,y,x2):
 d.line((x1,y,x2,y),fill=MINT,width=3);d.line((x2-12,y-8,x2,y,x2-12,y+8),fill=MINT,width=3)

def problem(im,t):
 brand(im,'The problem');header(im,'Revenue arrives over time.','The next move needs capital today.')
 for i,(title,lines) in enumerate([('Security audit',['Launch with','greater confidence.']),('Infrastructure',['More capacity','to serve users.']),('New launch',['Build the next','product or service.'])]):
  v=ramp(t,8.2+i*.25,9.2+i*.25);card(im,460+i*450,round(364+35*(1-v)),410,270,f'0{i+1}',title,lines)
 d=ImageDraw.Draw(im);d.line((500,801,1745,801),fill=LINE,width=3)
 for x,label in [(500,'TODAY'),(1122,'REVENUE OVER TIME'),(1745,'FUTURE')]:
  d.ellipse((x-6,795,x+6,807),fill=MINT);text(d,(x,838),label,18,MUTED,anchor='ma')
 p=(t*.13)%1;xx=550+1130*p;d.ellipse((xx-10,791,xx+10,811),fill=MINT)
 text(d,(490,696),'Fund the next move before future revenue arrives.',30,PAPER)

def why(im,t):
 brand(im,'Why I am building it');header(im,'Make revenue useful for raising capital.','Give investors a repayment source they can inspect.')
 card(im,480,370,1260,185,'FOR BUSINESSES','A revenue record that supports the raise.',[],t<36)
 card(im,480,605,1260,215,'FOR INVESTORS','Visible sources. Inspectable rules.',['Know where repayment comes from.'],t>=36)

def terms(im,t):
 brand(im,'How Bondrail works');header(im,'A business issues a revenue bond.','The terms are defined before investors fund it.')
 for i,(title,lines) in enumerate([('Raise amount',['The capital the','business wants to raise.']),('Revenue share',['The share allocated','toward repayment.']),('Repayment cap',['The maximum revenue','repayment under the bond.'])]):
  card(im,460+i*450,370,410,315,f'0{i+1}',title,lines,i==min(2,max(0,int((t-43.7)/3))))
 d=ImageDraw.Draw(im)
 if t>52.8:
  text(d,(1100,791),'Investors fund the bond and receive claims.',34,MINT,True,anchor='ma')
 else:text(d,(1100,791),'Clear terms at issuance.',30,MUTED,anchor='ma')

def staging(im,t):
 brand(im,'Capital release');header(im,'Capital moves in stages.','A portion can remain in escrow until milestones are met.')
 card(im,480,376,550,310,'01 · INITIAL RELEASE','Capital to the business',['A first portion releases','when the bond activates.'],True)
 card(im,1170,376,550,310,'02 · MILESTONE','Capital held in escrow',['The next release follows','the agreed conditions.'])
 arrow(ImageDraw.Draw(im),1055,530,1145);text(ImageDraw.Draw(im),(1100,808),'Staged capital. Conditions fixed in the bond.',30,MINT,anchor='ma')

def repayment(im,t):
 brand(im,'Revenue repayment');header(im,'As the business earns, repayment accrues.','A share of revenue goes toward the bond’s repayment cap.')
 d=ImageDraw.Draw(im)
 for x,label,small in [(480,'Business','Revenue-generating activity'),(920,'Bond','Revenue allocated to repayment'),(1360,'Investors','Claims on collected repayments')]:
  d.rounded_rectangle((x,395,x+365,610),radius=20,fill='#17251D',outline=LINE,width=2);text(d,(x+28,446),label,41,PAPER,True)
  words=small.split();line='';yy=518
  for w in words:
   if len(line+' '+w)>25:text(d,(x+28,yy),line,22,MUTED);line='';yy+=29
   line=(line+' '+w).strip()
  text(d,(x+28,yy),line,22,MUTED)
 arrow(d,855,505,905);arrow(d,1295,505,1345)
 p=(t*.5)%1;x=815+p*570;d.ellipse((x-7,498,x+7,512),fill=MINT)
 d.rounded_rectangle((480,715,1725,815),radius=18,fill='#253124');text(d,(510,747),'Repayment depends on actual revenue. Returns are not guaranteed.',28,PAPER)

def users(im,t):
 brand(im,'First users');header(im,'Start with revenue-generating apps on Monad.','Work directly with founders on their first bond.')
 for i,(title,lines) in enumerate([('Find founders',['Direct outreach','within the ecosystem.']),('First issuance',['Help businesses','set up and issue.']),('Reach investors',['Start with each','business’s community.'])]):
  card(im,460+i*450,365,410,285,f'0{i+1}',title,lines,i==min(2,int(max(0,t-85.5)/4)))
 text(ImageDraw.Draw(im),(1100,786),'Founder outreach → assisted issuance → community investors',26,MINT,anchor='ma')

class Reader:
 def __init__(self,path,w,h):
  self.w=w;self.h=h;self.last=None;self.p=subprocess.Popen([FF,'-hide_banner','-loglevel','error','-i',str(path),'-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 def next(self):
  b=self.p.stdout.read(self.w*self.h*3)
  if len(b)==self.w*self.h*3:self.last=Image.frombytes('RGB',(self.w,self.h),b)
  return self.last
 def close(self):self.p.terminate();self.p.stdout.close();self.p.wait()

def prepare_proof():
 c=json.loads((ROOT/'demo/video/output/technical/capture.json').read_text());segments=[('issue',17,20.5),('activate',24.915,28.415),('payment',21.7,27.4)];args=[];f=[]
 for i,(key,a,b) in enumerate(segments):
  args+=['-ss',str(a),'-t',str(b-a),'-i',c[key]['video']];f.append(f'[{i}:v]crop=1600:812:0:0,setpts=PTS-STARTPTS,fps=30,scale=1280:650[v{i}]')
 f.append('[v0][v1][v2]concat=n=3:v=1:a=0[out]');dest=OUT/'proof-source.mp4';subprocess.run([FF,'-hide_banner','-loglevel','error','-y',*args,'-filter_complex',';'.join(f),'-map','[out]','-an','-c:v','libx264','-preset','fast','-crf','18',str(dest)],check=True);return dest

def proof(im,t,raw):
 brand(im,'Working prototype');header(im,'Built and working on Monad testnet.','Issuance. Funding. Staged release. Revenue repayment.')
 if raw:
  elapsed=t-72.1;z=1+.045*ramp(elapsed,1,5);ww=1280/z;hh=650/z;cropped=raw.crop(((1280-ww)/2,0,(1280+ww)/2,hh)).resize((1330,675),Image.Resampling.BICUBIC);im.paste(cropped,(470,302));ImageDraw.Draw(im).rounded_rectangle((470,302,1800,977),radius=5,outline=LINE,width=2)
 text(ImageDraw.Draw(im),(480,991),'Actual recorded operation · controlled testnet activity · Native integration',19,MUTED)

def circle(im,face):
 crop=face.crop((350,0,950,600)).resize((310,310),Image.Resampling.LANCZOS);mask=Image.new('L',(310,310));ImageDraw.Draw(mask).ellipse((1,1,308,308),fill=255);im.paste(crop,(65,683),mask);ImageDraw.Draw(im).ellipse((63,681,377,995),outline=MINT,width=3)
 text(ImageDraw.Draw(im),(220,1022),'ADOKIYE · SOLO FOUNDER',17,MUTED,anchor='ma')

def full_founder(face,t,closing=False):
 im=face.resize((W,H),Image.Resampling.BICUBIC);overlay=Image.new('RGBA',(W,H));d=ImageDraw.Draw(overlay)
 for y in range(720,H):d.line((0,y,W,y),fill=(8,16,11,int(210*(y-720)/(H-720))))
 im=Image.alpha_composite(im.convert('RGBA'),overlay).convert('RGB');im.paste(logo(63),(84,842),logo(63));d=ImageDraw.Draw(im)
 text(d,(171,833),'Bondrail' if closing else 'Adokiye',57,PAPER,True);text(d,(172,910),'Revenue bonds for onchain businesses.' if closing else 'Solo founder · Bondrail',30,MINT)
 if closing:text(d,(173,961),'bondrail.vercel.app',24,PAPER)
 return im

# Caption text corrected for clear ASR name/product errors; timing follows source speech.
CAPTIONS=[
(.52,3.05,"Hi, my name is Adokiye."),(3.05,7.56,"I’m the solo founder building Bondrail—revenue bonds for onchain businesses."),
(8.70,13.9,'A business can earn revenue every day and still need capital for its next move.'),(13.9,22.1,'A security audit. More infrastructure to scale. Or a new product launch.'),(22.1,27.5,'These costs arrive today. The revenue that could fund them arrives over time.'),(27.5,29.4,'That’s why we’re building Bondrail.'),
(29.4,35.9,'I believe a business’s onchain revenue should help it access capital.'),(35.9,41.4,'Investors should be able to inspect where repayment comes from and the rules behind it.'),(41.4,42.96,'Here’s how it works.'),
(44.06,47.3,'A business issues a revenue bond.'),(47.3,52.7,'It sets the amount to raise, the revenue share allocated to repayment, and a repayment cap.'),(53.12,55.94,'Investors fund the bond and receive claims.'),
(68.76,75.56,'Capital can release in stages, with part held in escrow until milestone conditions are met.'),(76.44,80.65,'As the business earns, a share of its revenue goes toward repayment.'),(80.65,83.84,'Returns depend on actual revenue and are not guaranteed.'),
(84.84,87.9,'I’ve built a working prototype on Monad testnet.'),(87.9,96.48,'It demonstrates issuance, funding, staged capital release, and automatic fee repayment within a business transaction.'),
(98.22,102.2,'I’ll start with revenue-generating teams or apps currently on Monad.'),(102.2,104.4,'That is our go-to-market approach.'),(104.4,111.14,'Working directly with founders to help them issue their first bonds and reach investors through their communities.'),
(111.72,112.92,'The goal is simple.'),(113.96,117.46,'Help onchain businesses fund their next move.'),(118,119.9,'That is essentially Bondrail.')]
def shifted(t):return t-.18 if t<56.25 else t-12.53
SUBS=[(shifted(a),shifted(b),s) for a,b,s in CAPTIONS]
def caption(im,t):
 active=next(((a,b,s) for a,b,s in SUBS if a<=t<b),None)
 if not active:return
 a,b,s=active;words=s.split();groups=[];g=[]
 for w in words:
  if len(' '.join(g+[w]))>68 and g:groups.append(g);g=[]
  g.append(w)
 if g:groups.append(g)
 pos=(t-a)/(b-a)*len(words);n=0;chosen=groups[-1]
 for g in groups:
  n+=len(g)
  if pos<n:chosen=g;break
 textstr=' '.join(chosen);d=ImageDraw.Draw(im);width=d.textlength(textstr,font=font(29));center=1120 if 8.4<t<99.0 else 1160
 x=max(415,center-width/2);d.rounded_rectangle((x-17,1022,x+width+17,1071),radius=8,fill='#070E0A');text(d,(x,1026),textstr,29)

def render():
 opts=vision.ImageSegmenterOptions(base_options=python.BaseOptions(model_asset_path='/tmp/bondrail-selfie-segmenter.tflite'),output_confidence_masks=True,running_mode=vision.RunningMode.IMAGE)
 segmenter=vision.ImageSegmenter.create_from_options(opts);reader=Reader(OUT/'founder-edited.mkv',1280,720);proofReader=Reader(prepare_proof(),1280,650)
 enc=subprocess.Popen([FF,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s','1920x1080','-r','30','-i','-','-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-threads','4',str(OUT/'pitch-silent.mp4')],stdin=subprocess.PIPE)
 prevMask=None;lastProof=None
 try:
  for n in range(round(D*FPS)):
   t=n/FPS;raw=reader.next();small=raw.resize((640,360),Image.Resampling.BILINEAR);result=segmenter.segment(mp.Image(image_format=mp.ImageFormat.SRGB,data=np.array(small)));mask=result.confidence_masks[0].numpy_view().copy().squeeze();mask=np.clip((mask-.20)/.65,0,1)
   if prevMask is not None:mask=.8*mask+.2*prevMask
   prevMask=mask.copy();m=Image.fromarray(np.uint8(mask*255)).resize((1280,720),Image.Resampling.BILINEAR).filter(ImageFilter.GaussianBlur(2));face=Image.composite(raw,raw.filter(ImageFilter.GaussianBlur(23)),m)
   im=BG.copy()
   if t<8.1:im=full_founder(face,t)
   elif t<29.2:problem(im,t)
   elif t<43.5:why(im,t)
   elif t<56.07:terms(im,t)
   elif t<63.6:staging(im,t)
   elif t<72.1:repayment(im,t)
   elif t<85.3:
    lastProof=proofReader.next();proof(im,t,lastProof)
   elif t<99.0:users(im,t)
   else:im=full_founder(face,t,True)
   if 8.1<=t<99.0:circle(im,face)
   # Soft, short transitions around content changes; talking head remains in sync.
   for cut in [29.2,43.5,56.07,63.6,72.1,85.3]:
    if cut<=t<cut+.35:
     alpha=ramp(t,cut,cut+.35);temp=BG.copy();circle(temp,face);im=Image.blend(temp,im,alpha)
   if 8.1<=t<8.7:im=Image.blend(full_founder(face,t),im,ramp(t,8.1,8.7))
   if 99.0<=t<99.6:
    prev=BG.copy();users(prev,t);circle(prev,face);im=Image.blend(prev,im,ramp(t,99.0,99.6))
   caption(im,t)
   if t>D-.5:im=Image.blend(im,Image.new('RGB',(W,H),INK),ramp(t,D-.5,D))
   enc.stdin.write(im.tobytes())
   if n%450==0:print(f'render {t:.0f}/{D:.2f}s',flush=True)
 finally:enc.stdin.close();enc.wait();reader.close();proofReader.close();segmenter.close()
 assert enc.returncode==0
 subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-i',str(OUT/'pitch-silent.mp4'),'-i',str(OUT/'founder-edited.mkv'),'-map','0:v','-map','1:a','-c:v','copy','-af','highpass=f=75,loudnorm=I=-16:TP=-1.5:LRA=7','-c:a','aac','-b:a','192k','-t',str(D),'-movflags','+faststart',str(OUT/'bondrail-founder-pitch.mp4')],check=True)
 def ts(t):
  ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
 (OUT/'bondrail-founder-pitch.srt').write_text('\n'.join(f'{i+1}\n{ts(a)} --> {ts(b)}\n{s}\n' for i,(a,b,s) in enumerate(SUBS)))
 print('DONE',D,flush=True)
if __name__=='__main__':render()
