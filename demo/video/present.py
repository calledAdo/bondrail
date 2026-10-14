"""Render Bondrail's story-led presentation using genuine footage and original motion graphics."""
from pathlib import Path
from functools import lru_cache
from concurrent.futures import ThreadPoolExecutor
import argparse, json, math, subprocess, textwrap
import numpy as np
import soundfile as sf
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont, ImageFilter

HERE=Path(__file__).resolve().parent; ROOT=HERE.parent.parent
OUT=HERE/'output'; WORK=OUT/'presentation'; WORK.mkdir(exist_ok=True)
FF=imageio_ffmpeg.get_ffmpeg_exe(); FPS=30; W,H=1920,1080
FONTS=ROOT/'apps/web/node_modules/geist/dist/fonts/geist-sans'
INK='#202A27'; PAPER='#F6F5EF'; MINT='#9FE8CA'; MUTED='#66746e'; WHITE='#ffffff'
SCENES=json.loads((WORK/'narration.json').read_text())
SHOTS=json.loads((OUT/'capture.json').read_text()); INTRO=json.loads((OUT/'intro-capture.json').read_text())

@lru_cache(maxsize=100)
def font(size,bold=False): return ImageFont.truetype(str(FONTS/('Geist-SemiBold.ttf' if bold else 'Geist-Regular.ttf')),size)
def ease(x): x=max(0,min(1,x));return x*x*(3-2*x)
def ramp(t,a,b): return ease((t-a)/max(.001,b-a))
def mix(a,b,t): return a+(b-a)*t

def text(draw,xy,words,size=32,color=INK,bold=False,spacing=1.13):
 x,y=xy
 for line in words.split('\n'):
  draw.text((x,y),line,font=font(size,bold),fill=color,stroke_width=0)
  y+=size*spacing

def rule(draw,xy,length,color,width=2):
 draw.line((xy[0],xy[1],xy[0]+max(0,length),xy[1]),fill=color,width=width)

@lru_cache(maxsize=64)
def brand_symbol(size,color):
 source=Image.open(ROOT/'brand/bondrail/png/bondrail-symbol-mono-black-1024.png').convert('RGBA')
 source=source.resize((size,size),Image.Resampling.LANCZOS)
 result=Image.new('RGBA',(size,size),color)
 result.putalpha(source.getchannel('A'))
 return result

def mark(im,x,y,size,color=INK,accent=MINT,progress=1):
 symbol=brand_symbol(int(size),color)
 im.paste(symbol,(int(x),int(y)),symbol)

def brand(im,color=INK):
 mark(im,65,39,40,color)
 text(ImageDraw.Draw(im),(116,35),'Bondrail',31,color)

def title(im,heading,t,color=INK):
 d=ImageDraw.Draw(im);offset=20*(1-ramp(t,0,.65))
 text(d,(65,105+offset),heading,62,color,True)

# Selected real footage. End holds are explicit editorial holds, not simulated operations.
def segments(scene):
 id=scene['id'];d=scene['duration']
 def s(k,a,b,hold=0):return (SHOTS[k]['video'],a,b,hold)
 if id=='opening':return [(INTRO['video'],6.5,13.0,max(0,d-6.5))]
 if id=='problem':return []
 if id=='history':return [s('02-credit',4.1,23.1,max(0,d-19))]
 if id=='funding':return [s('03-staging',8.0,26.0,max(0,d-18))]
 if id=='payment':return [s('04-payment',4.0,4.1,3.7),s('04-payment',4.1,16.3,max(0,d-16))]
 if id=='receipt':return [s('04-receipt',.5,8.5,max(0,d-8))]
 if id=='trading':return [s('05-kuru',8.3,27.5,max(0,d-19.2))]
 if id=='deposit':return [s('06-deposit',11.0,27.0,max(0,d-16))]
 if id=='watched':return [s('07-cre',8,19),s('07-cre',27,35.5,max(0,d-19.5))]
 if id=='closing':return [(INTRO['video'],6.5,12.5,max(0,d-6))]
 raise ValueError(id)

def prepare_track(scene):
 dest=WORK/f"{scene['id']}-source.mp4";cuts=segments(scene)
 if not cuts:return None
 args=[FF,'-hide_banner','-loglevel','error','-y'];filters=[]
 for i,(source,a,b,hold) in enumerate(cuts):
  args+=['-ss',str(a),'-t',str(b-a),'-i',source]
  filters.append(f'[{i}:v]setpts=PTS-STARTPTS,fps={FPS},scale=1600:900:force_original_aspect_ratio=decrease,pad=1600:900:(ow-iw)/2:(oh-ih)/2,setsar=1,tpad=stop_mode=clone:stop_duration={hold}[v{i}]')
 filters.append(''.join(f'[v{i}]' for i in range(len(cuts)))+f'concat=n={len(cuts)}:v=1:a=0[out]')
 args+=['-filter_complex',';'.join(filters),'-map','[out]','-an','-t',str(scene['duration']),'-c:v','libx264','-preset','ultrafast','-crf','17','-threads','2',str(dest)]
 subprocess.run(args,check=True);return dest

def camera(t,points):
 # (time, zoom, centre-x, centre-y). Smooth camera moves, source playback unretimed.
 if t<=points[0][0]:return points[0][1:]
 for a,b in zip(points,points[1:]):
  if t<=b[0]:
   u=ramp(t,a[0],b[0]);return tuple(mix(a[j],b[j],u) for j in range(1,4))
 return points[-1][1:]

def screen(im,raw,box,cam,t,animated=True):
 if raw is None:return
 x,y,w,h=box;z,cx,cy=cam
 sw,sh=raw.size;aspect=w/h
 cw=min(sw,sh*aspect)/z;ch=cw/aspect
 lx=max(0,min(sw-cw,cx*sw-cw/2));ly=max(0,min(sh-ch,cy*sh-ch/2))
 crop=raw.crop((round(lx),round(ly),round(lx+cw),round(ly+ch))).resize((w,h),Image.Resampling.LANCZOS)
 enter=ramp(t,0,.65) if animated else 1
 x+=round(34*(1-enter));y+=round(12*(1-enter))
 d=ImageDraw.Draw(im)
 # Deliberate plain screen frame, with a quiet offset shadow on paper/mint.
 d.rounded_rectangle((x+8,y+12,x+w+8,y+h+12),radius=12,fill='#cbd2cc' if im.getpixel((0,0))!= (8,13,12) else '#020504')
 mask=Image.new('L',(w,h));ImageDraw.Draw(mask).rounded_rectangle((0,0,w-1,h-1),radius=10,fill=255)
 im.paste(crop,(x,y),mask)
 d.rounded_rectangle((x,y,x+w,y+h),radius=10,outline='#283832',width=1)

def caption(im,scene,t):
 active=next((l for l in scene['lines'] if l['start']<=t<l['end']),None)
 if not active:return
 d=ImageDraw.Draw(im);words=active['text'].split();lines=[];line=''
 for word in words:
  candidate=(line+' '+word).strip()
  if d.textlength(candidate,font=font(29))>1510 and line:lines.append(line);line=word
  else:line=candidate
 lines.append(line)
 totalh=len(lines)*37;top=H-49-totalh
 maxw=max(d.textlength(l,font=font(29)) for l in lines)
 d.rounded_rectangle(((W-maxw)/2-20,top-9,(W+maxw)/2+20,top+totalh+5),radius=10,fill='#101613')
 for j,l in enumerate(lines):
  width=d.textlength(l,font=font(29));text(d,((W-width)/2,top+j*37),l,29,WHITE)

def footer(im,scene,t,bg):
 color='#a0b7ad' if bg==INK else '#3b574b';d=ImageDraw.Draw(im)
 disclosure='Monad testnet · team-run demo businesses'
 if scene['id']=='payment':disclosure='Real test-wallet transaction · automated Node signer'
 if scene['id']=='receipt':disclosure='Actual Monad RPC receipt · decoded evidence view'
 if scene['id']=='watched':disclosure='CRE simulation + real Monad broadcast'
 if scene['id']=='problem':disclosure='The idea behind Bondrail'
 text(d,(65,1043),disclosure,16,color)
 text(d,(1480,1043),'bondrail.vercel.app',16,color)
 if scene['id'] in ('payment','receipt','trading','deposit','watched'):
  text(d,(1500,55),'Recorded operation · edited timing',16,color)

def compose(scene,t,raw):
 id=scene['id'];duration=scene['duration']
 bg=MINT if id in ('funding','deposit') else (INK if id in ('opening','payment','watched','closing') else PAPER)
 im=Image.new('RGB',(W,H),bg);d=ImageDraw.Draw(im)
 if id=='opening':
  screen(im,raw,(0,0,W,1015),camera(t,[(0,1.0,.5,.47),(5,1.075,.5,.40)]),t,False)
  # Landing page remains the opening, not an invented brand card.
  d=ImageDraw.Draw(im);d.rectangle((0,1000,W,H),fill=INK)
 elif id=='problem':
  brand(im);text(d,(65,145),'Revenue today.',100,INK,True)
  text(d,(65,255+18*(1-ramp(t,.8,1.5))),'Capital for the next move.',100,INK,True)
  # Conceptual flow, clearly distinct from application evidence.
  left=(80,495,700,825);right=(1130,495,1820,825)
  d.rounded_rectangle(left,radius=18,fill=WHITE)
  d.rounded_rectangle(right,radius=18,fill=INK)
  text(d,(115,532),'The business',27,MUTED)
  text(d,(115,583),'Payments\nkeep coming.',52,INK,True)
  text(d,(1165,532),'The next move',27,'#a5b9af')
  text(d,(1165,583),'Build. Launch.\nGrow.',52,WHITE,True)
  u=ramp(t,4.7,6.2);rule(d,(738,655),340*u,'#13a876',6)
  if u>.98:d.polygon([(1085,655),(1066,644),(1066,666)],fill='#13a876')
  for j in range(3):
   x=170+((t*.20+j*.31)%1)*365;y=760
   d.rounded_rectangle((x,y,x+76,y+10),radius=5,fill=MINT)
  if t>5.7:text(d,(750,700),'A record\nworth funding.',24,INK,True)
 elif id=='history':
  brand(im);title(im,'Start with evidence.',t)
  screen(im,raw,(65,210,1300,725),camera(t,[(0,1,.5,.5),(4,1.08,.5,.53),(11,1.08,.5,.53),(13,1.25,.33,.73),(18,1.25,.33,.73)]),t)
  text(d,(1430,255),'Know what\ncounts.',51,INK,True)
  if t<12:
   text(d,(1430,485),'3',115,INK,True)
   text(d,(1430,622),'attributed payers',28,INK)
   text(d,(1430,686),'Revenue. Concentration.\nTraceable payments.',25,MUTED)
  else:
   text(d,(1430,485),'2 of 5',88,INK,True)
   text(d,(1430,604),'payers excluded',28,INK)
   text(d,(1430,672),'Linked to issuer funding.\nShown in the record.',25,MUTED)
  text(d,(1430,853),'Controlled test wallets.\nNot customer traction.',20,MUTED)
 elif id=='funding':
  brand(im);title(im,'Fund the next move.',t)
  screen(im,raw,(690,210,1160,725),camera(t,[(0,1.0,.5,.46),(5,1.0,.5,.46),(9,1.16,.40,.49),(17,1.16,.40,.49)]),t)
  text(d,(80,225),'$20',137,INK,True);text(d,(85,387),'USDC funded',30,INK)
  p=ramp(t,2.2,3.0);rule(d,(85,470),500*p,INK,2)
  if t>2.7:
   text(d,(85,506),'$10',86,INK,True);text(d,(295,530),'Released to\nthe business',29,INK)
  if t>4.7:
   text(d,(85,658),'$10',86,INK,True);text(d,(295,684),'Held in\nescrow',29,INK)
  if t>7.3:text(d,(85,845),'Next release:\nrevenue milestone + time window',24,INK)
 elif id=='payment':
  brand(im,WHITE);title(im,'One trade. Automatic repayment.',t,WHITE)
  screen(im,raw,(65,215,1785,715),camera(t,[(0,1.04,.5,.47),(4,1.13,.42,.48),(7,1.45,.33,.46),(10,1.45,.33,.46),(13,1.62,.32,.43),(16,1.62,.32,.43)]),t)
  if t>6.2:
   d.rounded_rectangle((1370,245,1780,395),radius=12,fill=INK)
   mark(im,1400,272,68,WHITE,MINT,ramp(t,6.2,6.9))
   text(d,(1510,265),'25%',57,MINT,True);text(d,(1400,355),'of the trading fee',23,WHITE)
 elif id=='receipt':
  brand(im);title(im,'Follow the money.',t)
  screen(im,raw,(65,220,1300,715),camera(t,[(0,1.0,.5,.50),(4,1.035,.5,.50),(8,1.035,.5,.50)]),t)
  text(d,(1430,280),'Same transaction.',28,INK,True)
  text(d,(1420,407),'0.0025',92,INK,True)
  text(d,(1430,530),'USDC to the bond',27,INK)
  rule(d,(1430,611),400*ramp(t,.4,1.1),'#139d75',4)
  text(d,(1430,662),'Successful on Monad.\nNo separate collection.',25,MUTED)
  text(d,(1430,854),'0x1ead969f…47398ad',20,MUTED)
 elif id=='trading':
  brand(im);title(im,'A claim you can trade.',t)
  screen(im,raw,(65,215,1785,715),camera(t,[(0,1.12,.65,.49),(3.2,1.45,.82,.46),(7.0,1.45,.82,.49),(10.5,1.45,.82,.57),(12.2,1.36,.81,.76),(17.7,1.36,.81,.76),(21,1.15,.72,.61)]),t)
  if t<7:tag='Quote → review → buy'
  elif t<10.8:tag='Real testnet execution'
  else:tag='Confirmed · 0.088 claims'
  d.rounded_rectangle((1390,110,1850,170),radius=9,fill=INK);text(d,(1410,122),tag,23,WHITE,True)
 elif id=='deposit':
  brand(im);title(im,'Join the next raise.',t)
  screen(im,raw,(690,210,1160,725),camera(t,[(0,1.0,.5,.48),(4,1.25,.77,.57),(8,1.25,.77,.57),(12,1.0,.5,.46),(17,1.0,.5,.46)]),t)
  text(d,(80,272),'1',144,INK,True);text(d,(195,346),'test USDC',38,INK)
  if t>4.7:
   rule(d,(91,485),455*ramp(t,4.7,5.4),INK,3)
   text(d,(80,531),'1',144,INK,True);text(d,(195,605),'CurveLab claim',35,INK)
  if t>8.7:text(d,(85,809),'Withdrawable while\nfunding stays open.',28,INK)
 elif id=='watched':
  brand(im,WHITE);title(im,'Revenue can come from an API.',t,WHITE)
  cam=camera(t,[(0,1.08,.43,.39),(9,1.18,.43,.39),(10.9,1.18,.43,.39)]) if t<11 else (1.0,.5,.5)
  screen(im,raw,(65,215,1300,715),cam,t)
  text(d,(1430,263),'Paid APIs.\nWatched onchain.',43,WHITE,True)
  if t<12.9:
   text(d,(1430,505),'30 min',88,MINT,True);text(d,(1430,624),'scheduled checks',26,WHITE)
   text(d,(1430,700),'CRE simulation.\nReal report broadcasts.',24,'#a5b9af')
  else:
   text(d,(1430,505),'2',108,MINT,True);text(d,(1430,631),'adjacent violations',27,WHITE)
   text(d,(1430,698),'Default + stake slashing.\nNot executed in this demo.',23,'#a5b9af')
 elif id=='closing':
  screen(im,raw,(0,0,W,1015),camera(t,[(0,1.08,.5,.4),(6,1.0,.5,.5)]),t,False)
  alpha=int(235*ramp(t,2.0,5.2));overlay=Image.new('RGBA',(W,H),(8,13,12,alpha));im=Image.alpha_composite(im.convert('RGBA'),overlay).convert('RGB');d=ImageDraw.Draw(im)
  if t>3.4:
   u=ramp(t,3.4,4.1);x=660;y=320+int(22*(1-u));mark(im,x,y,95,WHITE,MINT)
   text(d,(780,y-20),'Bondrail',110,WHITE)
   headline='Issue bonds. Raise capital.';fw=d.textlength(headline,font=font(64,True));text(d,((W-fw)/2,520),headline,64,WHITE,True)
   url='bondrail.vercel.app';fw=d.textlength(url,font=font(32));text(d,((W-fw)/2,642),url,32,MINT)
   text(d,(727,722),'Working prototype on Monad testnet',24,'#afc2b8')
 else:raise ValueError(id)
 footer(im,scene,t,bg);caption(im,scene,t)
 if id=='closing' and t>duration-.45:
  im=Image.blend(im,Image.new('RGB',im.size,INK),ramp(t,duration-.45,duration))
 return im

def render_scene(scene):
 source=prepare_track(scene);reader=None;raw=None
 if source:
  reader=imageio_ffmpeg.read_frames(str(source),pix_fmt='rgb24');meta=next(reader);size=meta['size']
 target=WORK/f"{scene['id']}.mp4"
 proc=subprocess.Popen([FF,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s','1920x1080','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','fast','-crf','18','-threads','3','-pix_fmt','yuv420p','-movflags','+faststart',str(target)],stdin=subprocess.PIPE)
 try:
  count=round(scene['duration']*FPS)
  for n in range(count):
   if reader:
    try:raw=Image.frombytes('RGB',size,next(reader))
    except StopIteration:reader.close();reader=None
   im=compose(scene,n/FPS,raw)
   if n in (round(count*.25),round(count*.66)):
    im.save(WORK/f"{scene['id']}-check-{n}.jpg",quality=90)
   proc.stdin.write(im.tobytes())
  proc.stdin.close();code=proc.wait()
  if code:raise RuntimeError(f'Encoding failed: {scene["id"]}')
 finally:
  if reader:reader.close()
 print('Rendered presentation:',scene['id'],flush=True)
 return target

def audio_mix():
 # Original, restrained musical bed. No borrowed soundtrack or external music asset.
 sr=24000;voice=np.concatenate([sf.read(s['audio'])[0] for s in SCENES]).astype(np.float32)
 n=len(voice);music=np.zeros(n,dtype=np.float32);duration=n/sr
 chords=[(146.83,185.00,220.0,277.18),(123.47,146.83,185.0,220.0),(98.0,123.47,146.83,185.0),(110.0,146.83,164.81,220.0)]
 # Gentle, slow pad changes underneath speech, plus a sparse warm pulse.
 for beat in range(math.ceil(duration/8)):
  start=int(beat*8*sr);end=min(n,start+int(10*sr));t=np.arange(end-start)/sr
  env=np.minimum(1,t/1.2)*np.minimum(1,np.maximum(0,(10-t)/2.0))
  chord=chords[beat%len(chords)];tone=sum(np.sin(2*np.pi*f*t+.11*j)+.18*np.sin(2*np.pi*(f*2+.18)*t) for j,f in enumerate(chord))/len(chord)
  music[start:end]+=(.012*env*tone).astype(np.float32)
 for beat in range(int(duration/.75)):
  start=int(beat*.75*sr);length=min(int(.45*sr),n-start);t=np.arange(length)/sr
  freq=chords[int(beat*.75/8)%4][beat%4]*2
  bell=np.sin(2*np.pi*freq*t)*np.exp(-t*12)*(1-np.exp(-t*120))
  music[start:start+length]+=(.009*bell).astype(np.float32)
 fade=np.minimum(1,np.arange(n)/sr/1.5)*np.minimum(1,(n-1-np.arange(n))/sr/2.0)
 music*=fade
 sf.write(WORK/'narration-master.wav',voice,sr)
 sf.write(WORK/'original-music.wav',music,sr)
 # Normalize narration independently; the music remains quiet, so silence isn't pumped up.
 subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-i',str(WORK/'narration-master.wav'),'-i',str(WORK/'original-music.wav'),'-filter_complex','[0:a]loudnorm=I=-16:TP=-1.5:LRA=9[v];[v][1:a]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.94[out]','-map','[out]','-ar','48000',str(WORK/'soundtrack.wav')],check=True)

def srt_time(t):
 ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'

def finish():
 paths=[WORK/f"{s['id']}.mp4" for s in SCENES]
 listing=WORK/'concat.txt';listing.write_text(''.join(f"file '{p}'\n" for p in paths))
 audio_mix()
 subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(listing),'-i',str(WORK/'soundtrack.wav'),'-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-ac','2','-movflags','+faststart','-shortest',str(OUT/'bondrail-metropolis-presentation.mp4')],check=True)
 offset=0;subtitles=[];edl=[];counter=0
 for scene in SCENES:
  edl.append({'id':scene['id'],'start':offset,'end':offset+scene['duration'],'sourceIntervals':segments(scene)})
  for line in scene['lines']:
   counter+=1;subtitles.append(f"{counter}\n{srt_time(offset+line['start'])} --> {srt_time(offset+line['end'])}\n{line['text']}\n")
  offset+=scene['duration']
 (OUT/'bondrail-metropolis-presentation.srt').write_text('\n'.join(subtitles))
 (WORK/'edit-decision-list.json').write_text(json.dumps(edl,indent=2)+'\n')
 print('Final presentation:',offset,'seconds',flush=True)

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--only');parser.add_argument('--finish',action='store_true');args=parser.parse_args()
 if args.finish:finish()
 elif args.only:render_scene(next(s for s in SCENES if s['id']==args.only))
 else:
  with ThreadPoolExecutor(max_workers=2) as pool:list(pool.map(render_scene,SCENES))
  finish()
