from pathlib import Path
import subprocess,json
import imageio_ffmpeg
ROOT=Path(__file__).resolve().parents[2];OUT=ROOT/'demo/video/output/founder-pitch';FF=imageio_ffmpeg.get_ffmpeg_exe();SRC='/Users/adokiye/Documents/BondrailPitch.mov'
KEEP=[(.18,56.25),(68.60,120.5)];duration=sum(b-a for a,b in KEEP)
filters=[]
for i,(a,b) in enumerate(KEEP):
 filters += [f'[0:v]trim=start={a}:end={b},setpts=PTS-STARTPTS,fps=30[v{i}]',f'[0:a]atrim=start={a}:end={b},asetpts=PTS-STARTPTS[a{i}]']
filters+=['[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]']
subprocess.run([FF,'-hide_banner','-loglevel','error','-y','-i',SRC,'-filter_complex',';'.join(filters),'-map','[v]','-map','[a]','-c:v','libx264','-crf','18','-preset','fast','-c:a','pcm_s16le',str(OUT/'founder-edited.mkv')],check=True)
(OUT/'edit.json').write_text(json.dumps({'source':SRC,'keep':KEEP,'seconds':duration,'speed':1,'removed':'Repeated terms/funding passage, with original speech and synchronized face preserved.'},indent=2))
print('Edited duration',duration)
