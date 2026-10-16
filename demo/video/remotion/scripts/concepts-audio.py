"""Original deterministic 100 BPM score: synthesis only, no samples or reference audio."""
from pathlib import Path
import json, math, subprocess, re
import numpy as np
import soundfile as sf
import imageio_ffmpeg

PKG=Path(__file__).resolve().parents[1]
PLAN=json.loads((PKG/'src/concepts/timeline.json').read_text())
OUT=PKG.parent/'output/concepts'
PUBLIC=PKG/'public/concepts'
SR=48000
DURATION=PLAN['seconds']

def synthesize():
    OUT.mkdir(parents=True,exist_ok=True)
    PUBLIC.mkdir(parents=True,exist_ok=True)
    n=SR*DURATION
    music=np.zeros((n,2),np.float64)
    rng=np.random.default_rng(24)
    def add(start,sound,pan=0):
        pos=round(start*SR)
        count=min(len(sound),n-pos)
        if pos<0 or count<=0:return
        music[pos:pos+count,0]+=sound[:count]*math.sqrt((1-pan)/2)
        music[pos:pos+count,1]+=sound[:count]*math.sqrt((1+pan)/2)
    def time(duration):return np.arange(round(duration*SR))/SR
    # D, C, E minor and A colors continue the launch's warm harmonic vocabulary.
    chords=[[146.83,220,293.66,369.99],[130.81,196,261.63,329.63],[164.81,246.94,329.63,392],[110,164.81,220,329.63]]
    beat=.6
    for bar in range(math.ceil(DURATION/2.4)):
        start=bar*2.4; dur=min(3,DURATION-start)
        t=time(dur);env=np.minimum(1,t/.25)*np.minimum(1,(dur-t)/.8)
        for j,freq in enumerate(chords[bar%4]):
            add(start,.027*(np.sin(2*np.pi*freq*t)+.09*np.sin(2*np.pi*freq*2*t))*env,(-.5+j/3))
        t=time(1.6);freq=chords[bar%4][0]/2
        add(start,.032*np.sin(2*np.pi*freq*t)*np.minimum(1,t/.02)*np.exp(-t*2.6))
    for i in range(math.ceil(DURATION/beat)):
        start=i*beat
        density=.55 if start<6 or start>=70 else 1
        t=time(.28)
        add(start,density*.075*np.sin(2*np.pi*(54*t+45*.025*(1-np.exp(-t/.025))))*np.exp(-t*19))
        if i%2:
            t=time(.11);add(start,density*.011*rng.normal(0,1,len(t))*np.exp(-t*45),.15)
        t=time(.042);add(start+.3,density*.005*rng.normal(0,1,len(t))*np.exp(-t*95),-.35)
    notes=[587.33,739.99,880,659.25,493.88,659.25,440,587.33]
    for i in range(114):
        start=6+i*.6
        if start>=70:break
        t=time(.7);freq=notes[i%len(notes)]
        add(start,.016*(np.sin(2*np.pi*freq*t)+.12*np.sin(4*np.pi*freq*t))*np.exp(-t*6)*np.minimum(1,t/.012),.4 if i%2 else -.4)
    # Soft felt-like impacts at every editorial change, then the three closing beats.
    hits=sorted(set([b['start'] for b in PLAN['beats']]+[64,65.8,67.6]))
    for start in hits:
        t=time(.42);env=np.minimum(1,t/.008)*np.exp(-t*12)
        add(start,.028*(np.sin(2*np.pi*147*t)+.16*rng.normal(0,1,len(t)))*env)
    t=np.arange(n)/SR
    music*= (np.minimum(1,t/.55)*np.minimum(1,(DURATION-t)/1.5))[:,None]
    sf.write(OUT/'music-source.wav',music,SR,subtype='PCM_24')
    ff=imageio_ffmpeg.get_ffmpeg_exe()
    common=[ff,'-hide_banner','-i',str(OUT/'music-source.wav')]
    result=subprocess.run(common+['-af','loudnorm=I=-18:TP=-2:LRA=7:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
    measure=json.loads(re.search(r'\{[^{}]+\}',result.stderr,re.S).group())
    filt=f"loudnorm=I=-18:TP=-2:LRA=7:measured_I={measure['input_i']}:measured_TP={measure['input_tp']}:measured_LRA={measure['input_lra']}:measured_thresh={measure['input_thresh']}:offset={measure['target_offset']}:linear=true"
    subprocess.run(common+['-y','-af',filt,'-ar',str(SR),'-c:a','pcm_s24le',str(PUBLIC/'music.wav')],check=True,capture_output=True)
    (OUT/'music-measurement.json').write_text(json.dumps(measure,indent=2)+'\n')
    print('Original score ready: 76 s, 48 kHz stereo, normalized to -18 LUFS')

if __name__=='__main__':synthesize()
