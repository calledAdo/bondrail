# Founder-led pitch

Separate from the159-second technical demonstration. Responds to the form's “Introduce your team, the problem you solve, and why you are building it. Up to2minutes.”

Uses the user's second take, `/Users/adokiye/Documents/BondrailPitch.mov`, with original voice and synchronized face. The user is a solo founder; on-screen first name Adokiye matches the supplied script and introduction. Earlier take and all original media are preserved.

Edit: retain0.18–56.25s and68.60–120.50s, giving107.97s. Remove the repeated explanation of terms/funding. No speech acceleration, cloned voice or synthetic replacement.

Visuals: founder full-screen opening and closing; approved locally processed background blur; Loom-style circular face at bottom left during the supporting slides. Slides cover the capital timing gap, founder's motivation, bond terms, staged release, revenue-dependent repayment and first-user plan. Genuine prior testnet app recordings illustrate the working prototype. No new blockchain writes.

Captions follow the speech with obvious recognition errors corrected and some verbal filler condensed. A matching SRT is included. Original audio receives a75Hz high-pass filter and loudness normalization. No music competes with the founder.

Production:

```sh
/tmp/slice-video-venv/bin/python demo/video/prepare_founder_pitch.py
MPLCONFIGDIR=/tmp/bondrail-mpl /tmp/bondrail-matting-venv/bin/python demo/video/render_founder_pitch.py
/tmp/slice-video-venv/bin/python demo/video/verify_founder_pitch.py
```

Background processing uses the MediaPipe selfie-segmentation model at `/tmp/bondrail-selfie-segmenter.tflite`; model source https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite . All face/video processing is local. No source recording was uploaded to a service.

Output: `output/founder-pitch/bondrail-founder-pitch.mp4`, matchingSRT, edit.json, validation.json and contact-sheet.jpg. This is not the old synthetic narration motion preview.

Verified final export: 107.97 seconds, 1920×1080 at 30fps, 12,753,720 bytes. Full audio/video decode passed; audio peak −1.3dB. Reviewed 24 sampled frames plus full-size terms and product frames. No full listening review was performed.
