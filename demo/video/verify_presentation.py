"""Verify the delivered media and save review frames; does not touch the application."""
from pathlib import Path
import hashlib,json,re,subprocess
from datetime import datetime,timezone
from PIL import Image,ImageDraw
import imageio_ffmpeg
HERE=Path(__file__).resolve().parent;OUT=HERE/'output';WORK=OUT/'presentation'
ff=imageio_ffmpeg.get_ffmpeg_exe();video=OUT/'slice-metropolis-presentation.mp4'
p=subprocess.run([ff,'-hide_banner','-i',str(video),'-f','null','-'],capture_output=True,text=True)
(WORK/'decode.log').write_text(p.stderr);assert p.returncode==0,p.stderr
m=re.search(r'Duration: (\d+):(\d+):(\d+\.\d+)',p.stderr);duration=int(m[1])*3600+int(m[2])*60+float(m[3])
scenes=json.loads((WORK/'narration.json').read_text());planned=sum(s['duration'] for s in scenes)
assert duration<=180 and abs(duration-planned)<.1
assert '1920x1080' in p.stderr and '30 fps' in p.stderr and 'Audio: aac' in p.stderr
levels=subprocess.run([ff,'-hide_banner','-i',str(video),'-vn','-af','volumedetect','-f','null','-'],capture_output=True,text=True,check=True)
vol={key:float(re.search(key+r': (-?[0-9.]+) dB',levels.stderr)[1]) for key in ['mean_volume','max_volume']};assert vol['max_volume']<0
transactions=json.loads((OUT/'transactions.json').read_text());assert len(transactions)==5 and all(x['status']=='success' and x['chainId']==10143 for x in transactions)
proof=json.loads((OUT/'native-proof.json').read_text());assert int(proof['after'])-int(proof['before'])==2500
shotdir=WORK/'review';shotdir.mkdir(exist_ok=True);offset=0;frames=[]
for scene in scenes:
 for local in [min(2,scene['duration']/3),scene['duration']*.76]:frames.append((scene['id'],offset+local))
 offset+=scene['duration']
frames.extend([('repayment-before',66.8),('repayment-after',68.2),('kuru-confirmed',90.5),('deposit-claims',106)])
for i,(name,t) in enumerate(frames):
 dest=shotdir/f'{i:02}-{name}.jpg';subprocess.run([ff,'-hide_banner','-loglevel','error','-y','-ss',str(t),'-i',str(video),'-frames:v','1',str(dest)],check=True)
for batch in range(3):
 part=frames[batch*8:(batch+1)*8];board=Image.new('RGB',(1280,380*((len(part)+1)//2)),'#222');d=ImageDraw.Draw(board)
 for j,(name,t) in enumerate(part):
  im=Image.open(shotdir/f'{batch*8+j:02}-{name}.jpg');im.thumbnail((640,360));x=j%2*640;y=j//2*380;board.paste(im,(x,y+20));d.text((x+8,y+3),f'{name}: {t:.2f}s',fill='white')
 board.save(shotdir/f'board-{batch}.jpg',quality=92)
report={'file':str(video),'durationSeconds':duration,'timelineSeconds':planned,'sizeBytes':video.stat().st_size,'sha256':hashlib.sha256(video.read_bytes()).hexdigest(),'fullDecodePassed':True,'video':'1920x1080 H.264 30fps','audio':'AAC stereo 48kHz','audioLevelsDb':vol,'captionFile':str(OUT/'slice-metropolis-presentation.srt'),'framesPrepared':len(frames),'transactionsVerified':5,'nativeRepaymentDeltaUSDC':'0.0025','voice':'Kokoro af_bella; synthetic, voice cloning deferred by user','music':'Original local synthesized pad/pulse, mixed quietly under narration','referenceUse':'Story/pacing analysis only; no reference footage, voice, music or branding reused','verifiedAt':datetime.now(timezone.utc).isoformat()}
(WORK/'validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
