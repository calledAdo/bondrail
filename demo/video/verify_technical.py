from pathlib import Path
import subprocess,json,re
import imageio_ffmpeg
from PIL import Image,ImageDraw
OUT=Path(__file__).resolve().parent/'output/technical';FF=imageio_ffmpeg.get_ffmpeg_exe();video=OUT/'bondrail-technical-demo.mp4'
result=subprocess.run([FF,'-hide_banner','-i',str(video),'-af','volumedetect','-f','null','-'],capture_output=True,text=True)
if result.returncode:raise RuntimeError(result.stderr[-2000:])
m=re.search(r'Duration: (\d+):(\d+):([\d.]+)',result.stderr);duration=int(m[1])*3600+int(m[2])*60+float(m[3]);assert duration<=180
assert '1920x1080' in result.stderr
peak=float(re.search(r'max_volume: ([-\d.]+) dB',result.stderr)[1]);assert peak<0
scenes=json.loads((OUT/'narration.json').read_text());offset=0;frames=[]
for scene in scenes:
 for f in [.2,.55,.85]:
  t=offset+scene['duration']*f;p=OUT/f"qa-{scene['id']}-{int(f*100)}.jpg"
  subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-ss',str(t),'-i',str(video),'-frames:v','1',str(p)],check=True)
  im=Image.open(p).resize((480,270));d=ImageDraw.Draw(im);d.rectangle((0,0,220,20),fill='white');d.text((5,3),f"{scene['id']} @ {t:.1f}s",fill='black');frames.append(im)
 offset+=scene['duration']
sheet=Image.new('RGB',(1440,270*len(scenes)),'white')
for i,im in enumerate(frames):sheet.paste(im,((i%3)*480,(i//3)*270))
sheet.save(OUT/'contact-sheet.jpg')
report={'file':str(video),'seconds':duration,'resolution':'1920x1080','fps':30,'maxVolumeDb':peak,'fullDecode':'passed','sampleFrames':len(frames),'bytes':video.stat().st_size,'visualReview':'pending'}
(OUT/'validation.json').write_text(json.dumps(report,indent=2));print(json.dumps(report,indent=2))
