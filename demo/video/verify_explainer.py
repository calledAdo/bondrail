from pathlib import Path
import subprocess,re,json,hashlib
import imageio_ffmpeg
from PIL import Image,ImageDraw
P=Path(__file__).resolve().parent/'output/explainer';V=P/'bondrail-explainer.mp4';FF=imageio_ffmpeg.get_ffmpeg_exe()
r=subprocess.run([FF,'-hide_banner','-i',str(V),'-af','volumedetect','-f','null','-'],capture_output=True,text=True)
assert r.returncode==0,r.stderr
assert '1920x1080' in r.stderr and '60 fps' in r.stderr
peak=float(re.findall(r'max_volume: ([\-\d.]+)',r.stderr)[-1]);assert peak<0
match=re.search(r'Duration: (\d+):(\d+):([\d.]+)',r.stderr);duration=int(match[1])*3600+int(match[2])*60+float(match[3]);assert 24<duration<26
frames=[1.1,3.3,4.9,6.3,9.5,11.3,13.8,15.5,17.2,19.5,20.25,24.2]
board=Image.new('RGB',(1440,1184),'#F6F5EF');d=ImageDraw.Draw(board)
for i,t in enumerate(frames):
 p=P/f'qa-{t}.jpg';subprocess.run([FF,'-v','error','-ss',str(t),'-i',str(V),'-frames:v','1','-vf','scale=480:270','-y',str(p)],check=True)
 x=i%3*480;y=i//3*296;board.paste(Image.open(p),(x,y));d.text((x+8,y+275),f'{t}s',fill='#202A27')
board.save(P/'export-review.jpg')
subprocess.run([FF,'-v','error','-ss','22.4','-i',str(V),'-frames:v','1','-y',str(P/'bondrail-explainer-poster.png')],check=True)
report={'file':str(V),'durationSeconds':duration,'video':'1920×1080 H.264 60fps','audio':'AAC stereo 48kHz; original synthesized music and effects; no voiceover','decodePassed':True,'peakDb':peak,'sizeBytes':V.stat().st_size,'sha256':hashlib.sha256(V.read_bytes()).hexdigest(),'reviewFrames':frames,'reference':'useSpoke.mp4: structure/pacing only; no assets reused','purpose':'Illustrated brand explainer; separate from operation-evidence demo','reviewLimit':'Sampled visual frames and technical audio checks; not human listening review'}
(P/'validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
