"""Decode, audio, caption timing, final-track STT, contact sheet and evidence checks."""
from pathlib import Path
import json,re,subprocess,hashlib,difflib
import numpy as np
from PIL import Image,ImageDraw
import imageio_ffmpeg
HERE=Path(__file__).resolve().parent;OUT=HERE/'output/update';VIDEO=OUT/'bondrail-update.mp4';FF=imageio_ffmpeg.get_ffmpeg_exe()
p=subprocess.run([FF,'-hide_banner','-i',str(VIDEO),'-af','loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True)
(OUT/'decode-and-loudness.log').write_text(p.stderr);assert p.returncode==0,p.stderr[-3000:]
m=re.search(r'Duration: (\d+):(\d+):([\d.]+)',p.stderr);seconds=int(m[1])*3600+int(m[2])*60+float(m[3]);assert seconds<=180
for token in ['1920x1080','30 fps','Video: h264','Audio: aac']:assert token in p.stderr,token
levels=json.JSONDecoder().raw_decode(p.stderr[p.stderr.rfind('{'):])[0];assert -28<float(levels['input_i'])<-12,levels;assert float(levels['input_tp'])<-.2,levels
manifest=json.loads((OUT/'narration.json').read_text());assert abs(sum(s['duration'] for s in manifest)-seconds)<.1
words=json.loads((OUT/'words.json').read_text());assert all(w['end']>=w['start']>=0 and w['end']<=seconds for w in words)
assert all(a['start']<=b['start'] for a,b in zip(words,words[1:]));assert len(words)==sum(len(l['text'].split()) for s in manifest for l in s['lines'])
srt=(OUT/'bondrail-update.srt').read_text();assert srt.count(' --> ')>40
chain=json.loads((OUT/'chain-verification.json').read_text());assert all(a['status']=='success' for a in chain['actions']);assert chain['budget']=={'approve':1,'depositUSDC':1,'withdrawUSDC':0,'x402Calls':1}
assert int(chain['balances']['gasWei'])>10**16
captures=json.loads((OUT/'capture.json').read_text());required=['landing','vaults','vault','oracle','pump','credit','explorer'];assert all(captures[n]['success'] for n in required)
assert all(not captures[n]['errors'] for n in required if n!='explorer')
# Decode the actual final AAC track for independent recognition (not the source WAV).
from faster_whisper import WhisperModel
model=WhisperModel('base.en',device='cpu',compute_type='int8',download_root='/private/tmp/bondrail-video-models/whisper',cpu_threads=4)
recognition=[]; alignment=[]
for scene in manifest:
 raw=subprocess.run([FF,'-hide_banner','-loglevel','error','-ss',str(scene['start']),'-i',str(VIDEO),'-t',str(scene['duration']),'-f','f32le','-ac','1','-ar','16000','-'],capture_output=True,check=True).stdout
 audio=np.frombuffer(raw,dtype=np.float32)
 segments,_=model.transcribe(audio,beam_size=5,word_timestamps=True,initial_prompt='Bondrail, Monad, x402, USDC, SDK, npm, Solidity, BondrailEarner.')
 segments=list(segments);actual=[{'text':w.word,'start':scene['start']+w.start} for seg in segments for w in (seg.words or [])]
 recognized=' '.join(s.text.strip() for s in segments);expected=' '.join(l['text'] for l in scene['lines'])
 normalize=lambda x:re.sub('[^a-z0-9]','',x.lower())
 ratio=difflib.SequenceMatcher(None,normalize(expected),normalize(recognized),autojunk=False).ratio()
 reference=[w for w in words if scene['start']<=w['start']<scene['start']+scene['duration']]
 matches=difflib.SequenceMatcher(None,[normalize(w['text']) for w in reference],[normalize(w['text']) for w in actual],autojunk=False)
 offsets=[]
 for block in matches.get_matching_blocks():
  offsets += [abs(reference[block.a+i]['start']-actual[block.b+i]['start']) for i in range(block.size)]
 assert len(offsets)>=len(reference)*.7,(scene['id'],'insufficient matching words')
 assert np.percentile(offsets,95)<.6,(scene['id'],'caption drift',np.percentile(offsets,95))
 alignment.append({'scene':scene['id'],'matchedWords':len(offsets),'medianOffsetSeconds':float(np.median(offsets)),'p95OffsetSeconds':float(np.percentile(offsets,95)),'maxOffsetSeconds':max(offsets)})
 recognition.append({'scene':scene['id'],'expected':expected,'recognized':recognized,'characterSimilarity':ratio});print(scene['id'],round(ratio,3),recognized,flush=True)
 assert ratio>.88,(scene['id'],ratio,recognized)
(OUT/'final-speech-recognition.json').write_text(json.dumps(recognition,indent=2))
# Exactly six representative frames, 3 columns by 2 rows.
review=OUT/'review';review.mkdir(exist_ok=True);times=[9,39,79,104,135,157];sheet=Image.new('RGB',(1920,760),'#202A27');draw=ImageDraw.Draw(sheet)
for i,t in enumerate(times):
 dest=review/f'final-{t}.jpg';subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-ss',str(t),'-i',str(VIDEO),'-frames:v','1',str(dest)],check=True)
 im=Image.open(dest);im.thumbnail((640,360));x=i%3*640;y=i//3*380;sheet.paste(im,(x,y));draw.text((x+8,y+363),f'{t}s',fill='#9FE8CA')
sheet.save(OUT/'contact-sheet.jpg',quality=94)
report={'file':VIDEO.name,'sha256':hashlib.sha256(VIDEO.read_bytes()).hexdigest(),'bytes':VIDEO.stat().st_size,'seconds':seconds,'format':'1920x1080 / 30 fps / H.264 / AAC','decode':'passed','loudnessLUFS':float(levels['input_i']),'truePeakDBTP':float(levels['input_tp']),'captions':len(words),'timing':'word timestamps from source-line ASR; independently checked on final AAC track','captionTimingChecks':alignment,'finalSpeechRecognition':recognition,'chainVerified':3,'x402Calls':1,'gasRemainingMON':chain['balances']['mon'],'contactSheetFrames':times,'visualReview':'pending'}
(OUT/'validation.json').write_text(json.dumps(report,indent=2));print('Media and evidence checks passed',seconds,'seconds',flush=True)
