"""Compose actual app recordings, male narration, camera motion and captions; no mock UI."""
from pathlib import Path
import json, subprocess, math, argparse
import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont
ROOT=Path(__file__).resolve().parents[2];HERE=ROOT/'demo/video';OUT=HERE/'output/technical';FF=imageio_ffmpeg.get_ffmpeg_exe()
SCENES=json.loads((OUT/'narration.json').read_text());CAP=json.loads((OUT/'capture.json').read_text());FPS=30
FONT=ROOT/'apps/web/node_modules/geist/dist/fonts/geist-sans/Geist-Regular.ttf'
BOLD=FONT.with_name('Geist-SemiBold.ttf')
def stamp(t):
 h=int(t//3600);m=int(t//60)%60;s=t%60;return f'{h}:{m:02}:{s:05.2f}'
def ass(scene):
 # Sentence captions split into short readable groups, timed proportionally to spoken words.
 header='''[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\nWrapStyle: 0\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Geist,32,&H00F6F5EF,&H00FFFFFF,&H00151D19,&H00151D19,0,0,0,0,100,100,0,0,3,10,0,2,190,190,60,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'''
 events=[]
 for l in scene['lines']:
  words=l['text'].split();groups=[];g=[]
  for w in words:
   if len(' '.join(g+[w]))>75 and g:groups.append(g);g=[]
   g.append(w)
  if g:groups.append(g)
  at=l['start']
  for g in groups:
   end=at+(l['end']-l['start'])*len(g)/len(words)
   events.append(f"Dialogue: 0,{stamp(at)},{stamp(end)},Default,,0,0,0,,{{\\fad(90,90)}}{' '.join(g)}")
   at=end
 p=OUT/(scene['id']+'.ass');p.write_text(header+'\n'.join(events));return p

def frame(scene,idx):
 im=Image.new('RGBA',(1920,1080),(246,245,239,255));d=ImageDraw.Draw(im)
 # Transparent window reveals the genuine screen recording.
 d.rectangle((112,100,1807,961),fill=(0,0,0,0))
 logo=Image.open(ROOT/'brand/bondrail/png/bondrail-symbol-mono-black-1024.png').convert('RGBA').resize((35,35),Image.Resampling.LANCZOS)
 im.alpha_composite(logo,(35,21));d.text((83,20),'Bondrail',font=ImageFont.truetype(str(BOLD),28),fill='#202A27')
 d.text((350,22),scene['label'],font=ImageFont.truetype(str(FONT),26),fill='#202A27')
 d.text((1620,25),f'{idx+1:02} / 09',font=ImageFont.truetype(str(FONT),22),fill='#66746e')
 disclosure='Monad testnet · team-run demo · edited timing'
 if scene['id']=='payment':disclosure='Real contract payment · automated Node signer · edited timing'
 if scene['id']=='receipt':disclosure='Actual Monad RPC receipt · decoded evidence view'
 if scene['id']=='kuru':disclosure='PumpLab · separate existing bond and Kuru market'
 d.text((112,1047),disclosure,font=ImageFont.truetype(str(FONT),17),fill='#66746e')
 d.text((1585,1047),'bondrail.vercel.app',font=ImageFont.truetype(str(FONT),17),fill='#66746e')
 p=OUT/(scene['id']+'-frame.png');im.save(p);return p

def get(id,label):return next(m['at'] for m in CAP[id]['marks'] if m['label']==label)
def cuts(scene):
 id=scene['id'];duration=scene['duration'];source=id
 if id=='close':return [('close',get('close','ready'),get('close','ready')+6.8)]
 if id=='opening':return [('opening',get('opening','ready'),get('opening','ready')+7.5),('opening',get('opening','markets')+2,get('opening','end')-.2)]
 if id=='receipt':return [('payment',get('payment','receipt')+.2,get('payment','end')-.2)]
 if id=='issue':
  # Form entry and final confirmation; waits may be omitted, never invented.
  return [('issue',get('issue','ready'),get('issue','terms-ready')+4),('issue',max(get('issue','terms-ready')+2,get('issue','confirmed')-3),get('issue','confirmed')+.8),('fund',get('fund','ready')-2,get('fund','ready')+3)]
 if id=='activate':return [('activate',get('activate','ready')+3,get('activate','confirmed')+2),('activate',get('activate','bond-ready'),get('activate','end')-.2)]
 if id=='fund':return [('fund',get('fund','ready'),get('fund','ready')+3),('fund',get('fund','approved')-.8,get('fund','end')-.2)]
 if id=='payment':return [('payment',get('payment','ready'),get('payment','ready')+duration)]
 if id=='kuru':return [('kuru',get('kuru','ready'),get('kuru','end')-.2)]
 return [(source,get(source,'ready') if id!='close' else get(source,'ready'),get(source,'end')-.2)]

def render(scene,idx):
 id=scene['id'];duration=scene['duration'];pieces=cuts(scene);inputs=[];filters=[];total=0
 for i,(source,a,b) in enumerate(pieces):
  inputs+=['-ss',str(a),'-t',str(b-a),'-i',CAP[source]['video']]
  filters.append(f'[{i}:v]crop=1600:812:0:0,setpts=PTS-STARTPTS,fps=30,setsar=1[v{i}]');total+=b-a
 filters.append(''.join(f'[v{i}]' for i in range(len(pieces)))+f'concat=n={len(pieces)}:v=1:a=0[cut]')
 # Editorial retiming only if needed; record factor in manifest. Final holds are disclosed.
 speed=max(1,total/duration)
 # Mild smooth zoom keeps the full workflow legible; no crop through critical edge labels.
 zoom="1+0.09*(1-cos(min(on/180,1)*PI))/2"
 filters.append(f"[cut]setpts=PTS/{speed},tpad=stop_mode=clone:stop_duration={max(0,duration-total)+1},fps=30,scale=1920:974,zoompan=z='{zoom}':x='iw/2-iw/zoom/2':y='0':d=1:s=1696x862:fps=30,pad=1920:1080:112:100:color=0xf6f5ef[screen]")
 n=len(pieces);inputs+=['-loop','1','-i',str(frame(scene,idx)),'-i',scene['audio']]
 filters.append(f"[screen][{n}:v]overlay=0:0,ass='{ass(scene)}':fontsdir='{FONT.parent}',fade=t=in:st=0:d=0.15,fade=t=out:st={duration-.15}:d=0.15[out]")
 dest=OUT/(id+'-final.mp4')
 cmd=[FF,'-hide_banner','-loglevel','error','-y',*inputs,'-filter_complex',';'.join(filters),'-map','[out]','-map',f'{n+1}:a','-af','loudnorm=I=-16:TP=-1.5:LRA=7','-t',str(duration),'-c:v','libx264','-preset','fast','-crf','19','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','192k','-threads','4',str(dest)]
 subprocess.run(cmd,check=True);print(id,'rendered',flush=True)
 return {'id':id,'duration':duration,'cuts':pieces,'speed':speed,'hold':max(0,duration-total)}

def finish():
 concat=OUT/'concat.txt';concat.write_text('\n'.join(f"file '{OUT/(s['id']+'-final.mp4')}'" for s in SCENES))
 dest=OUT/'bondrail-technical-demo.mp4';subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(concat),'-c','copy','-movflags','+faststart',str(dest)],check=True)
 # Portable captions alongside the burned-in captions.
 srt=[];offset=0
 for s in SCENES:
  for l in s['lines']:
   def ts(t):
    ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
   srt.append(f"{len(srt)+1}\n{ts(offset+l['start'])} --> {ts(offset+l['end'])}\n{l['text']}\n")
  offset+=s['duration']
 (OUT/'bondrail-technical-demo.srt').write_text('\n'.join(srt));print(dest,offset,flush=True)
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--only');p.add_argument('--finish',action='store_true');args=p.parse_args()
 if args.finish:finish()
 else:
  records=[]
  for i,s in enumerate(SCENES):
   if args.only and s['id']!=args.only:continue
   records.append(render(s,i))
  (OUT/('edit-'+(args.only or 'all')+'.json')).write_text(json.dumps(records,indent=2))
  if not args.only:finish()
