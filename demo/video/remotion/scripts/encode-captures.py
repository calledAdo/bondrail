"""Preserve CDP presentation timestamps and holds; encode the real frames at 1080p30."""
from pathlib import Path
import json,subprocess
import imageio_ffmpeg
HERE=Path(__file__).resolve().parents[2];OUT=HERE/'output/update'
ff=imageio_ffmpeg.get_ffmpeg_exe();captures=json.loads((OUT/'capture.json').read_text())
for scene,c in captures.items():
 if not c['success']:continue
 d=Path(c['dir']);dest=OUT/(scene+'.mp4')
 if dest.exists() and dest.stat().st_mtime > max((d/'capture.json').stat().st_mtime,Path(__file__).stat().st_mtime):continue
 info=json.loads((d/'capture.json').read_text());frames=info['frames'];lines=['ffconcat version 1.0']
 for i,frame in enumerate(frames):
  end=frames[i+1]['at'] if i+1<len(frames) else info['duration']
  lines += ["file '"+frame['file']+"'",'duration '+str(max(.001,end-frame['at']))]
 lines += ["file '"+frames[-1]['file']+"'"]
 (d/'frames.ffconcat').write_text('\n'.join(lines))
 subprocess.run([ff,'-hide_banner','-loglevel','error','-y','-safe','0','-i',str(d/'frames.ffconcat'),'-vf','fps=30,scale=1920:1080:force_original_aspect_ratio=decrease:flags=lanczos,pad=1920:1080:0:0:color=0x202A27,setsar=1','-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-an','-t',str(info['duration']),str(dest)],check=True)
 print(scene,round(info['duration'],2),'seconds;',len(frames),'original display-change frames',flush=True)
