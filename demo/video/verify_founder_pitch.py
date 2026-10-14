from pathlib import Path
import subprocess,json,re
import imageio_ffmpeg
from PIL import Image,ImageDraw
OUT=Path(__file__).resolve().parent/'output/founder-pitch';FF=imageio_ffmpeg.get_ffmpeg_exe();v=OUT/'bondrail-founder-pitch.mp4'
r=subprocess.run([FF,'-hide_banner','-i',str(v),'-af','volumedetect','-f','null','-'],capture_output=True,text=True);assert r.returncode==0,r.stderr[-2000:]
m=re.search(r'Duration: (\d+):(\d+):([\d.]+)',r.stderr);duration=int(m[1])*3600+int(m[2])*60+float(m[3]);peak=float(re.search(r'max_volume: ([-\d.]+) dB',r.stderr)[1]);assert duration<120 and peak<0 and '1920x1080' in r.stderr
samples=[2,7,9,15,23,30,36,42,45,50,54,56.4,60,64,69,73,78,83,86,92,97,100,104,107]
sheet=Image.new('RGB',(1600,6*245),'white')
for i,t in enumerate(samples):
 p=OUT/f'qa-{t}.jpg';subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-ss',str(t),'-i',str(v),'-frames:v','1',str(p)],check=True);sheet.paste(Image.open(p).resize((400,225)),(i%4*400,i//4*245));ImageDraw.Draw(sheet).text((i%4*400+6,i//4*245+227),f'{t}s',fill='black')
sheet.save(OUT/'contact-sheet.jpg');report={'seconds':duration,'resolution':'1920x1080','fps':30,'bytes':v.stat().st_size,'peakDb':peak,'decode':'passed','framesSampled':len(samples),'visualReview':'pending','voice':'original founder audio, no speed change','source':json.loads((OUT/'edit.json').read_text())}
(OUT/'validation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
