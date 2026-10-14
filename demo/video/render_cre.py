from pathlib import Path
import subprocess,json,math,textwrap
import numpy as np
from PIL import Image,ImageDraw,ImageFont
import imageio_ffmpeg
HERE=Path(__file__).resolve().parent;OUT=HERE/'output/cre';FF=imageio_ffmpeg.get_ffmpeg_exe()
cap=json.loads((OUT/'capture.json').read_text());scenes=json.loads((OUT/'narration.json').read_text());marks={x['id']:x['at'] for x in cap['marks']}
FONT=HERE.parents[1]/'apps/web/node_modules/geist/dist/fonts/geist-sans'
font=ImageFont.truetype(str(FONT/'Geist-Regular.ttf'),27);small=ImageFont.truetype(str(FONT/'Geist-Regular.ttf'),19)
raw=cap['video'];segments={'product':(marks['product'],marks['offer']-.2),'offer':(marks['offer'],marks['cli']-.2),'cli':(marks['cli'],marks['receipt']-.2),'receipt':(marks['receipt'],marks['end']-.15),'limits':(marks['receipt']+3,marks['end']-.15)}
allcaps=[];offset=0
for s in scenes:
 for l in s['lines']:
  txt=l['text'].replace('C R E','CRE').replace('R P C','RPC').replace('Observation Accepted','ObservationAccepted')
  parts=textwrap.wrap(txt,95,break_long_words=False);total=sum(len(p) for p in parts);t=l['start']
  for p in parts:
   end=t+(l['end']-l['start'])*len(p)/total;allcaps.append((offset+t,offset+end,p));t=end
 offset+=s['duration']
def stamp(t):
 ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
(OUT/'bondrail-chainlink-cre-demo.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(b)}\n{t}' for i,(a,b,t) in enumerate(allcaps))+'\n')
frames=round(offset*30);encoder=subprocess.Popen([FF,'-hide_banner','-loglevel','error','-y','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','rgb24','-s','1920x1080','-r','30','-i','-','-an','-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p',str(OUT/'silent.mp4')],stdin=subprocess.PIPE)
cursor=0
labels={'product':'01 / THE REVENUE BOND','offer':'02 / LIVE PAYMENT OFFER','cli':'03 / CRE CLI SIMULATION + BROADCAST','receipt':'04 / VERIFIED ONCHAIN RECEIPT','limits':'TESTNET DEMONSTRATION / EXPLICIT TRUST ASSUMPTIONS'}
for s in scenes:
 a,b=segments[s['id']];dur=s['duration'];read=subprocess.Popen([FF,'-hide_banner','-loglevel','error','-ss',str(a),'-i',raw,'-t',str(b-a),'-vf','fps=30,scale=1600:900','-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
 last=None
 for i in range(round(dur*30)):
  buf=read.stdout.read(1600*900*3)
  if len(buf)==1600*900*3:
   source=Image.frombytes('RGB',(1600,900),buf)
   arr=np.asarray(source); gray=(np.max(arr,axis=2)-np.min(arr,axis=2)<12)&(arr[:,:,0]>110)&(arr[:,:,0]<145)
   rows=np.flatnonzero((~gray).sum(axis=1)>25);cols=np.flatnonzero((~gray).sum(axis=0)>25)
   last=source.crop((0,0,int(cols[-1])+1,int(rows[-1])+1))
  if last is None:raise RuntimeError('Missing source frame')
  frame=Image.new('RGB',(1920,1080),'#0A1410');d=ImageDraw.Draw(frame);t=i/30
  # A gentle camera move on product/evidence only; CLI stays fixed for legibility.
  z=1 if s['id']=='cli' else 1+0.012*min(1,t/dur)
  scale=min(1680/last.width,930/last.height)*z;w=round(last.width*scale);h=round(last.height*scale);img=last.resize((w,h),Image.Resampling.BICUBIC);x=(1920-w)//2;y=45+(930-h)//2;frame.paste(img,(x,y))
  d.text((120,10),labels[s['id']],font=small,fill='#AFE7CD')
  now=cursor+i/30;caption=next((txt for st,en,txt in allcaps if st<=now<en),'')
  if caption:
   lines=textwrap.wrap(caption,85);height=37*len(lines)+12;d.rectangle((0,1080-height-9,1920,1080),fill='#0A1410')
   for j,l in enumerate(lines):d.text((960,1080-height+37*j),l,font=font,fill='#F6F5EF',anchor='mt')
  encoder.stdin.write(frame.tobytes())
 read.stdout.close();read.terminate();read.wait();cursor+=dur;print(s['id'],round(cursor,2),flush=True)
encoder.stdin.close();assert encoder.wait()==0
# Narration concat and normalization.
args=[]
for s in scenes:args+=['-i',s['audio']]
chain=''.join(f'[{i}:a]' for i in range(len(scenes)))+f'concat=n={len(scenes)}:v=0:a=1,loudnorm=I=-16:TP=-1.5:LRA=11[a]'
subprocess.run([FF,'-hide_banner','-loglevel','error','-y',*args,'-filter_complex',chain,'-map','[a]',str(OUT/'narration.wav')],check=True)
subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-i',str(OUT/'silent.mp4'),'-i',str(OUT/'narration.wav'),'-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','192k','-shortest','-movflags','+faststart',str(OUT/'bondrail-chainlink-cre-demo.mp4')],check=True)
(OUT/'edit.json').write_text(json.dumps({'duration':cursor,'source':raw,'segments':segments,'note':'Actual browser capture and live CLI output. End frames held for narration; no simulated output or speed claims.','hash':cap['hash']},indent=2));print('DONE',cursor)
