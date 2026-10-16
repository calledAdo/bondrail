"""Local Kokoro narration, independently recognized word times, and original ducked music."""
from pathlib import Path
import json, hashlib, math, re, difflib, argparse
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro
HERE=Path(__file__).resolve().parent
OUT=HERE/'output/update'; VOICE=OUT/'voice'; VOICE.mkdir(parents=True,exist_ok=True)
MODEL=Path('/private/tmp/bondrail-video-models')
args=argparse.ArgumentParser();args.add_argument('--align',action='store_true');args=args.parse_args()
if not args.align:
 engine=Kokoro(str(MODEL/'kokoro-v1.0.int8.onnx'),str(MODEL/'voices-v1.0.bin'))
 scenes=json.loads((HERE/'update-script.json').read_text());manifest=[];offset=0;sr=24000
 for scene in scenes:
  lines=[]
  for text in scene['lines']:
   spoken=text.replace('x402','X four oh two').replace('SDK','ess dee kay').replace('API','ay pee eye').replace('testnet','test net').replace('npm','en pee em').replace('BondrailEarner','Bondrail Earner').replace('bondrail.vercel.app','bond rail dot ver sell dot app')
   key=hashlib.sha256(('am_michael/1.03/'+spoken).encode()).hexdigest()[:12];p=VOICE/(key+'.wav')
   if not p.exists():
    audio,sr=engine.create(spoken,voice='am_michael',speed=1.03,lang='en-us');sf.write(p,audio,sr)
   audio,sr=sf.read(p);lines.append({'text':text,'spoken':spoken,'file':str(p),'duration':len(audio)/sr})
  speech=sum(l['duration'] for l in lines)
  duration=math.ceil(max(scene['minimum'],speech+0.8+.38*(len(lines)-1))*30)/30
  gap=min(1.2,max(.38,(duration-speech-.8)/max(1,len(lines)-1)))
  merged=np.zeros(round(duration*sr),dtype=np.float32);cursor=.4
  for line in lines:
   samples,_=sf.read(line['file']);pos=round(cursor*sr);merged[pos:pos+len(samples)]=samples
   line['start']=cursor;line['end']=cursor+line['duration'];cursor=line['end']+gap
  sf.write(VOICE/(scene['id']+'.wav'),merged,sr)
  manifest.append({**scene,'lines':lines,'start':offset,'duration':duration,'voice':'am_michael','speed':1.03});offset+=duration
  print(scene['id'],round(speech,2),'speech /',duration,'scene',flush=True)
 (OUT/'narration.json').write_text(json.dumps(manifest,indent=2))
 print('TOTAL',offset,flush=True)
 if offset>180:raise SystemExit('Narration exceeds 180 seconds; tighten wording before continuing.')
else:
 from faster_whisper import WhisperModel
 model=WhisperModel('base.en',device='cpu',compute_type='int8',download_root='/private/tmp/bondrail-video-models/whisper',cpu_threads=4)
 manifest=json.loads((OUT/'narration.json').read_text());words=[];recognition=[]
 def norm(s):return re.sub(r'[^a-z0-9]','',s.lower())
 for scene in manifest:
  for line in scene['lines']:
   samples,rate=sf.read(line['file']); audio=np.interp(np.arange(round(len(samples)*16000/rate))*rate/16000,np.arange(len(samples)),samples).astype(np.float32)
   segments,info=model.transcribe(audio,word_timestamps=True,beam_size=5,initial_prompt='Bondrail, Monad, x402, USDC, SDK, npm, Solidity, BondrailEarner.',vad_filter=False)
   actual=[{'text':w.word.strip(),'start':w.start,'end':w.end,'probability':w.probability} for s in segments for w in (s.words or [])]
   target=line['text'].split();a=[norm(w['text']) for w in actual];b=[norm(w) for w in target]
   matcher=difflib.SequenceMatcher(None,a,b,autojunk=False);timed=[None]*len(b)
   for tag,i,j,k,l in matcher.get_opcodes():
    if tag=='equal':
     for x,y in zip(range(i,j),range(k,l)):timed[y]={'text':target[y],'start':actual[x]['start'],'end':actual[x]['end'],'alignment':'recognized'}
    elif l>k:
     left=actual[i]['start'] if i<len(actual) else (actual[-1]['end'] if actual else 0)
     right=actual[j-1]['end'] if j>i else min(line['duration'],left+.18*(l-k))
     for y in range(k,l):timed[y]={'text':target[y],'start':left+(right-left)*(y-k)/(l-k),'end':left+(right-left)*(y-k+1)/(l-k),'alignment':'aligned-name-or-token'}
   base=scene['start']+line['start']
   for w in timed:
    w['start']+=base;w['end']+=base;words.append(w)
   recognition.append({'scene':scene['id'],'expected':line['text'],'recognized':' '.join(w['text'] for w in actual),'matchingRatio':matcher.ratio(),'words':actual})
   print(scene['id'],round(matcher.ratio(),3),recognition[-1]['recognized'],flush=True)
 (OUT/'words.json').write_text(json.dumps(words,indent=2));(OUT/'speech-recognition.json').write_text(json.dumps(recognition,indent=2))
 def stamp(t):
  ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
 cues=[];group=[]
 for i,w in enumerate(words):
  group.append(w)
  if len(group)>=7 or re.search(r'[.!?;:]$',w['text']) or i==len(words)-1 or words[i+1]['start']-w['end']>.6:
   cues.append(f'{len(cues)+1}\n{stamp(group[0]["start"])} --> {stamp(max(group[-1]["end"],group[0]["start"]+.35))}\n'+ ' '.join(x['text'] for x in group)+'\n');group=[]
 (OUT/'bondrail-update.srt').write_text('\n'.join(cues))
# Deterministic original pad; low amplitude and a 300ms duck under actual voice regions.
manifest=json.loads((OUT/'narration.json').read_text());sr=24000;duration=sum(s['duration'] for s in manifest);n=round(duration*sr)
voice=np.zeros(n,dtype=np.float32);duck=np.ones(n,dtype=np.float32)
for scene in manifest:
 samples,_=sf.read(VOICE/(scene['id']+'.wav'));pos=round(scene['start']*sr);voice[pos:pos+len(samples)]+=samples
 for line in scene['lines']:
  a=max(0,round((scene['start']+line['start']-.15)*sr));b=min(n,round((scene['start']+line['end']+.25)*sr));duck[a:b]=.25
# Soft transitions using a convolution kernel, bounded memory.
step=240;env=duck[::step];env=np.convolve(np.pad(env,(15,15),mode='edge'),np.ones(31)/31,mode='valid');duck=np.interp(np.arange(n),np.arange(len(env))*step,env)
t=np.arange(n)/sr;bed=np.zeros(n)
for i,f in enumerate([130.8128,164.8138,195.9977,261.6256]):bed+=np.sin(2*np.pi*f*t+.2*np.sin(2*np.pi*.05*t+i))*.005
bed*=duck*np.minimum(t/2,1)*np.minimum((duration-t)/3,1)
peak=max(abs(voice));voice=voice/max(peak,.01)*.62
mix=voice+bed
sf.write(OUT/'mix.wav',np.column_stack([mix,mix]),sr)
