"""Generate every voice line locally. No API, account or metered service."""
import json
import os
from pathlib import Path
import numpy as np
import soundfile as sf
from kokoro_onnx import Kokoro

HERE = Path(__file__).resolve().parent
OUT = HERE / 'output'
VOICE = OUT / 'voice'
VOICE.mkdir(parents=True, exist_ok=True)
MODELS = Path(os.environ.get('BONDRAIL_VOICE_MODELS', '/tmp/slice-video-models'))
engine = Kokoro(str(MODELS / 'kokoro-v1.0.int8.onnx'), str(MODELS / 'voices-v1.0.bin'))
scenes = json.loads((HERE / 'scenes.json').read_text())
manifest = []
for scene in scenes:
    lines = []
    for i, text in enumerate(scene['sentences']):
        target = VOICE / f"{scene['id']}-{i}.wav"
        if not target.exists():
            spoken = text.replace('USDC', 'U S D C').replace('CRE', 'C R E').replace('PumpLab', 'Pump Lab').replace('CurveLab', 'Curve Lab')
            audio, rate = engine.create(spoken, voice='af_heart', speed=0.94, lang='en-us')
            sf.write(target, audio, rate)
        audio, rate = sf.read(target)
        lines.append({'text': text.replace('X four oh two', 'x402'), 'file': str(target), 'duration': len(audio) / rate})
    speech = sum(x['duration'] for x in lines)
    # Speech is at its natural rate. Evenly allocate the remaining time as pauses.
    if speech > scene['duration'] - 0.8:
        raise RuntimeError(f"{scene['id']}: {speech:.1f}s speech exceeds its {scene['duration']}s slot")
    gap = (scene['duration'] - speech - 0.8) / max(1, len(lines) - 1)
    cursor = 0.4
    merged = np.zeros(round(scene['duration'] * rate), dtype=np.float32)
    for line in lines:
        audio, _ = sf.read(line['file'])
        pos = round(cursor * rate)
        merged[pos:pos + len(audio)] = audio
        line['start'] = cursor
        line['end'] = cursor + line['duration']
        cursor += line['duration'] + gap
    target = VOICE / f"{scene['id']}.wav"
    sf.write(target, merged, rate)
    manifest.append({**scene, 'audio': str(target), 'lines': lines})
    print(f"{scene['id']}: {speech:.1f}s voice / {scene['duration']}s scene", flush=True)
(OUT / 'narration.json').write_text(json.dumps(manifest, indent=2))
sf.write(VOICE / 'slice-narration.wav', np.concatenate([sf.read(x['audio'])[0] for x in manifest]), rate)
