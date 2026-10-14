# Free own-voice narration for Bondrail

Research checked October 11, 2026. User explicitly requested cloning their own voice and rejected the previous Kokoro voice. V1 footage and evidence are retained; no new transaction is needed.

## Recommended first test: Qwen3-TTS + MLX Audio

[Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS) supports cloning from reference audio and its transcript. Its Base model is the cloning model; CustomVoice is a separate preset-speaker model, and VoiceDesign creates a voice from a description. Do not promise CustomVoice's instruction-based emotion control while cloning with Base.

The [1.7B Base weights](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-Base) and [MLX 8-bit conversion](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit) are labelled Apache-2.0. [MLX Audio](https://github.com/Blaizzy/mlx-audio) is MIT licensed and runs locally on Apple Silicon. This machine has 24 GiB RAM and Metal is available. Local tools were installed separately from the app in `/tmp/slice-clone-venv`; model cache is `/tmp/slice-voice-hf`. Model load/generation status is recorded in the session handoff, not assumed from installation.

No paid API key, voice-service account or hosted GPU is required for this local path. Model downloads require network access. The voice recording is passed to the local model, not uploaded to a cloning service. Actual voice similarity, accent retention and delivery remain untested until the user supplies audio.

## Alternatives checked

| Option | Verified free route | Fit for this demo |
|---|---|---|
| [Chatterbox](https://github.com/resemble-ai/chatterbox) | MIT open-source local models. Original model supports CPU/MPS and `exaggeration` / CFG controls; Turbo examples use a 10-second reference; Nano offers a smaller CPU model. | Good fallback to compare if Qwen sounds flat or misses the accent. Different variants have different controls; benchmark actual samples, not marketing claims. |
| [OpenVoice V2](https://github.com/myshell-ai/OpenVoice) | Official README explicitly says MIT, free for commercial and research use. | Another local route, but a more involved base-voice/tone-conversion pipeline. Not installed in this session. |
| [F5-TTS](https://github.com/SWivid/F5-TTS#license) | MIT code, but the provided pretrained models are CC-BY-NC. | Not the default for a product demo because the pretrained-weight terms are less suitable for promotional reuse. |
| [ElevenLabs](https://elevenlabs.io/pricing) | Free TTS exists, but Instant Voice Cloning appears in paid Starter and Professional Voice Cloning in Creator. | Does not meet the zero-budget voice-cloning requirement. Verified in the live browser; temporary promotions are still not free. |

Public demo spaces can have queues, sleep or upload requirements. They are not needed for the local route and were not used to upload audio.

## What the user needs to provide

A clean **20–30-second recording of their own voice**, or an existing clean voice note. No camera, screen recording or full demo narration needed. WAV, M4A or MP3 is fine. Use the original file where possible, a quiet room, no music/second speaker, and a natural, engaged delivery. Speak as if explaining a useful product to a friend. A flat or noisy reference will not reliably become an enthusiastic clone.

Suggested passage (the exact words should match the submitted recording):

> Every business starts with a problem worth solving. For us, it was simple: if a business is already earning revenue, why is getting capital still so difficult? That's why we're building Bondrail on Monad. Revenue bonds for onchain businesses. Let me show you how it works.

If the recording differs, update the transcript to the actual words. Qwen advertises cloning from as little as three seconds; the longer requested reference gives us a better chance to select a clean, representative passage. Similarity is not guaranteed by reference length alone.

## Local execution

```sh
UV_CACHE_DIR=/tmp/slice-uv-cache uv venv --python 3.12 /tmp/slice-clone-venv
UV_CACHE_DIR=/tmp/slice-uv-cache uv pip install --python /tmp/slice-clone-venv/bin/python mlx-audio==0.5.8 soundfile==0.14.0 imageio-ffmpeg==0.6.0
HF_HOME=/tmp/slice-voice-hf /tmp/slice-clone-venv/bin/python demo/video/clone_voice.py \
  --reference /path/to/your-voice.m4a \
  --transcript-file /path/to/exact-reference-transcript.txt
```

`clone_voice.py` checks the reference, converts it locally to mono 24 kHz, and generates a short test with Qwen3-TTS-12Hz-1.7B-Base-8bit. Voice material and outputs stay under ignored `output/voice-clone/`. A fixed seed and reference hash make the test repeatable. No user-voice test has been generated yet because no reference has been provided.

First compare a 10–15-second generated passage for likeness, pronunciation and energy. Then synthesize the revised narration in short paragraphs. Fit the edit to the actual delivery, with short intentional pauses; do not stretch sparse speech across preset scene durations. Label generated own-voice narration in the production/submission notes.

## V2 direction

`story-v2.json` supplies a 155-second target story: landing promise → PumpLab's history → staged funding → automatic repayment → tradable investor claims → an open raise → paid APIs → return to the promise. Actual narration length determines the final cut, with a hard limit of 180 seconds.

Use actual landing-page navigation and original real transaction clips. Focus the camera on the spoken evidence with eased zooms, then pull back to restore context. Avoid long frozen dashboard views, repeated oversized chapter headings, fake counters and recreated wallet/transaction states. A short silent motion study is generated by `motion_preview.py`; it is a direction sample, not the revised final demo.
