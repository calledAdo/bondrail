"""Clone the user's supplied reference locally with Qwen3-TTS on Apple Silicon."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
OUT = HERE / 'output' / 'voice-clone'
MODEL = 'mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', type=Path, required=True)
    parser.add_argument('--transcript-file', type=Path, required=True,
                        help='Exact words spoken in the reference recording.')
    parser.add_argument('--text', default='Your business is earning. Your next move needs capital. Meet Bondrail. Issue revenue bonds, raise capital, and repay investors from revenue.')
    parser.add_argument('--output', type=Path, default=OUT / 'bondrail-voice-test.wav')
    parser.add_argument('--seed', type=int, default=7)
    args = parser.parse_args()
    if not args.reference.is_file():
        parser.error('Reference audio does not exist; provide your own recording first.')
    if not args.transcript_file.is_file():
        parser.error('Provide the exact reference transcript in a text file.')
    transcript = args.transcript_file.read_text().strip()
    if not transcript or not args.text.strip():
        parser.error('Reference transcript and target text must not be empty.')

    # Voice material stays local. Only public model weights are downloaded.
    os.environ.setdefault('HF_HOME', '/tmp/bondrail-voice-hf')
    import imageio_ffmpeg
    import mlx.core as mx
    import numpy as np
    import soundfile as sf
    from mlx_audio.tts.utils import load_model

    OUT.mkdir(parents=True, exist_ok=True)
    reference = OUT / 'reference-24k.wav'
    subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), '-hide_banner', '-loglevel', 'error',
                    '-y', '-i', str(args.reference.resolve()), '-vn', '-ac', '1',
                    '-ar', '24000', str(reference)], check=True)
    samples, rate = sf.read(reference)
    seconds = len(samples) / rate
    if not 3 <= seconds <= 60:
        parser.error(f'Reference is {seconds:.1f}s; use a clean 3–60 second excerpt and its matching transcript.')
    if np.max(np.abs(samples)) < 0.005:
        parser.error('Reference is almost silent; check the recording.')
    mx.random.seed(args.seed)
    model = load_model(MODEL)
    chunks = list(model.generate(text=args.text, ref_audio=str(reference), ref_text=transcript,
                                 lang_code='English', max_tokens=1200, temperature=0.8))
    if not chunks:
        raise RuntimeError('Model produced no audio.')
    rates = {chunk.sample_rate for chunk in chunks}
    if len(rates) != 1:
        raise RuntimeError('Generated chunks have inconsistent sample rates.')
    audio = np.concatenate([np.asarray(chunk.audio).reshape(-1) for chunk in chunks])
    if not np.all(np.isfinite(audio)) or not len(audio):
        raise RuntimeError('Generated audio is empty or invalid.')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    sample_rate = rates.pop()
    sf.write(args.output, audio, sample_rate)
    meta = {'model': MODEL, 'seed': args.seed, 'text': args.text,
            'referenceSeconds': seconds, 'referenceSha256': hashlib.sha256(args.reference.read_bytes()).hexdigest(),
            'durationSeconds': len(audio)/sample_rate, 'sampleRate': sample_rate,
            'note': 'AI-generated narration using user-provided voice reference. Local inference; no voice uploaded.'}
    args.output.with_suffix('.json').write_text(json.dumps(meta, indent=2)+'\n')
    print(f'Generated {len(audio)/sample_rate:.1f}s voice test: {args.output}')


if __name__ == '__main__':
    main()
