"""Standard Rec.709 delivery and exact-duration audio from the original normalized WAV."""
from pathlib import Path
import json, subprocess, sys
import imageio_ffmpeg
PKG=Path(__file__).resolve().parents[1]
OUT=PKG.parent/'output/concepts'
PLAN=json.loads((PKG/'src/concepts/timeline.json').read_text())
suffix=sys.argv[1] if len(sys.argv)>1 else ''
if suffix not in ('','-square'):raise ValueError('Expected landscape or -square')
source=OUT/f'bondrail-concepts{suffix}-render.mp4'
destination=OUT/f'bondrail-concepts{suffix}.mp4'
# Remotion's default JPEG path produces full-range BT.601 (bt470bg) intermediates.
# Explicit matrix/range conversion preserves RGB appearance and avoids ambiguous player handling.
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(),'-hide_banner','-loglevel','error','-y',
    '-i',str(source),'-i',str(PKG/'public/concepts/music.wav'),'-map','0:v:0','-map','1:a:0',
    '-vf','scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p,sidedata=mode=delete:type=ICC_PROFILE,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-c:v','libx264','-preset','slow','-crf','18','-color_range','tv','-colorspace','bt709',
    '-color_primaries','bt709','-color_trc','bt709','-c:a','aac','-b:a','192k','-ar','48000',
    '-t',str(PLAN['seconds']),'-movflags','+faststart',str(destination)],check=True)
print('Delivery finished:',destination.name,flush=True)
