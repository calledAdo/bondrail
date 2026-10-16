"""Two-pass loudness finish; video bitstream and all caption timing are unchanged."""
from pathlib import Path
import subprocess,json
import imageio_ffmpeg
OUT=Path(__file__).resolve().parents[2]/'output/update'
duration=sum(s['duration'] for s in json.loads((OUT/'narration.json').read_text()))
FF=imageio_ffmpeg.get_ffmpeg_exe();src=OUT/'bondrail-update-render.mp4';dest=OUT/'bondrail-update.mp4'
first=subprocess.run([FF,'-hide_banner','-i',str(src),'-vn','-af','loudnorm=I=-18:TP=-1.5:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
m=json.JSONDecoder().raw_decode(first.stderr[first.stderr.rfind('{'):])[0];settings=f"loudnorm=I=-18:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=false:print_format=json"
second=subprocess.run([FF,'-hide_banner','-y','-i',str(src),'-map','0:v:0','-map','0:a:0','-c:v','copy','-af',settings,'-c:a','aac','-b:a','192k','-ar','48000','-t',str(duration),'-movflags','+faststart',str(dest)],capture_output=True,text=True,check=True)
r=json.JSONDecoder().raw_decode(second.stderr[second.stderr.rfind('{'):])[0];(OUT/'audio-normalization.json').write_text(json.dumps({'targetLUFS':-18,'targetTruePeak':-1.5,'measurement':m,'finish':r,'videoStream':'copied without re-encoding'},indent=2))
print('Audio finish:',r['output_i'],'LUFS,',r['output_tp'],'dBTP',flush=True)
