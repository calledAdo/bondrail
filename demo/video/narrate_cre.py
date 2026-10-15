"""Create a fresh, naturally paced temporary narration for the presentation cut."""
from pathlib import Path
import json,hashlib,math
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
HERE=Path(__file__).resolve().parent
OUT=HERE/'output'/'cre';VOICE=OUT/'voice';VOICE.mkdir(parents=True,exist_ok=True)
engine=Kokoro('/tmp/bondrail-video-models/kokoro-v1.0.int8.onnx','/tmp/bondrail-video-models/voices-v1.0.bin')
scenes=json.loads((HERE/'cre.json').read_text());manifest=[]
for scene in scenes:
 lines=[]
 for text in scene['lines']:
  spoken=text.replace('USDC','U S D C').replace('CRE','C R E').replace('PumpLab','Pump Lab').replace('CurveLab','Curve Lab').replace('HTTP','H T T P')
  key=hashlib.sha256(('am_michael/1.0/'+spoken).encode()).hexdigest()[:12];p=VOICE/f'{key}.wav'
  if not p.exists():
   samples,sr=engine.create(spoken,voice='am_michael',speed=1.0,lang='en-us');sf.write(p,samples,sr)
  samples,sr=sf.read(p);lines.append({'text':text,'file':str(p),'duration':len(samples)/sr})
 speech=sum(l['duration'] for l in lines)
 duration=math.ceil(max(scene['minimum'],speech+0.8+0.36*(len(lines)-1))*30)/30
 # Intentional breath between complete thoughts; no four-second gaps.
 gap=min(1.2,max(0.36,(duration-speech-0.8)/max(1,len(lines)-1)))
 cursor=0.4;merged=np.zeros(round(duration*sr),dtype=np.float32)
 for line in lines:
  samples,_=sf.read(line['file']);pos=round(cursor*sr);merged[pos:pos+len(samples)]=samples
  line['start']=cursor;line['end']=cursor+len(samples)/sr;cursor=line['end']+gap
 wav=VOICE/f"{scene['id']}.wav";sf.write(wav,merged,sr)
 manifest.append({**scene,'audio':str(wav),'duration':duration,'lines':lines,'voice':'am_michael'})
 print(scene['id'],round(speech,2),'spoken /',duration,'seconds',flush=True)
(OUT/'narration.json').write_text(json.dumps(manifest,indent=2))
print('TOTAL',sum(x['duration'] for x in manifest),flush=True)
