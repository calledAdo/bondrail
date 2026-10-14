"""A silent motion study using genuine landing navigation and saved Kuru footage."""
import json
import subprocess
from pathlib import Path
import imageio_ffmpeg
HERE = Path(__file__).resolve().parent
OUT = HERE/'output'
EDIT = OUT/'motion-v2'
EDIT.mkdir(exist_ok=True)
FF = imageio_ffmpeg.get_ffmpeg_exe()
FONTDIR = HERE.parent.parent/'apps/web/node_modules/geist/dist/fonts/geist-sans'
intro=json.loads((OUT/'intro-capture.json').read_text())
shots=json.loads((OUT/'capture.json').read_text())
m={m['label']:m['at'] for m in intro['marks']}
# All frames come from actual browser videos. Camera motion is editorial only.
segments=[
 (intro['video'],m['hero-ready']+0.3,m['hero-ready']+4.8,1.0,1.13,0.50,0.37,'Revenue bonds for onchain businesses.'),
 (intro['video'],m['open-markets']-1.0,m['open-markets']+0.3,1.13,1.0,0.5,0.5,'Let’s open the product.'),
 (intro['video'],m['markets-ready']+0.3,m['markets-ready']+3.3,1.0,1.15,0.46,0.45,'Meet the businesses.'),
 (intro['video'],m['pumplab-ready']+0.3,m['pumplab-ready']+3.0,1.0,1.22,0.42,0.50,'Follow the revenue.'),
 (shots['05-kuru']['video'],10.8,14.5,1.06,1.65,0.82,0.47,'Check the quote.'),
 (shots['05-kuru']['video'],14.5,19.4,1.65,1.65,0.82,0.47,'Buy. Confirmed on Monad.'),
 (shots['05-kuru']['video'],19.4,24.5,1.65,1.27,0.82,0.76,'The claims arrive in the wallet.'),
]

def ass_time(t):
 return f'{int(t//3600)}:{int(t%3600//60):02}:{t%60:05.2f}'

files=[]
for i,(source,start,end,z0,z1,cx,cy,title) in enumerate(segments):
 duration=round(end-start,3)
 ass=EDIT/f'{i}.ass'
 ass.write_text(f'''[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Head,Geist,42,&H00FFFFFF,&H00FFFFFF,&H00101010,&H00101010,-1,0,0,0,100,100,0,0,3,14,0,2,80,80,46,1
Style: Note,Geist,16,&H00B3EEDB,&H00B3EEDB,&H00101010,&H00101010,0,0,0,0,100,100,0,0,3,7,0,9,35,35,28,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,{ass_time(duration)},Head,,0,0,0,,{{\\fad(180,140)}}{title}
Dialogue: 0,0:00:00.00,{ass_time(duration)},Note,,0,0,0,,MOTION STUDY / VOICE PENDING · EDITED TIMING
''')
 # Smoothstep ramp finishes after 1.2 seconds, then holds attention on the target.
 ramp='min(on/36,1)';ease=f'({ramp}*{ramp}*(3-2*{ramp}))'
 z=f'{z0}+({z1-z0})*{ease}'
 center_y=f'(0.47+({cy}-0.47)*{ease})' if i==6 else str(cy)
 filters=f"trim=start={start}:end={end},setpts=PTS-STARTPTS,fps=30,scale=3840:2160:force_original_aspect_ratio=decrease,pad=3840:2160:(ow-iw)/2:(oh-ih)/2,setsar=1,zoompan=z='{z}':x='max(0,min(iw-iw/zoom,iw*{cx}-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*{center_y}-ih/zoom/2))':d=1:s=1920x1080:fps=30,subtitles='{ass}':fontsdir='{FONTDIR}',format=yuv420p"
 target=EDIT/f'{i}.mp4'
 subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-i',source,'-vf',filters,'-an','-t',str(duration),'-c:v','libx264','-preset','fast','-crf','18','-threads','4',str(target)],check=True)
 files.append(target);print('Motion shot',i,flush=True)
listing=EDIT/'concat.txt';listing.write_text(''.join(f"file '{p}'\n" for p in files))
subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-f','concat','-safe','0','-i',str(listing),'-c','copy','-movflags','+faststart',str(OUT/'slice-motion-v2-preview.mp4')],check=True)
print('Preview:',OUT/'slice-motion-v2-preview.mp4',flush=True)
