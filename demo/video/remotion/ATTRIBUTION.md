# Attribution and license record

This is a standalone, private video-production package. Nothing is published or deployed. The Remotion usage is for an individual / team of at most three, as specified by the task.

| Material | Pinned source | License / use |
| --- | --- | --- |
| Remotion, renderer, bundler, CLI | 4.0.395; https://github.com/remotion-dev/remotion | Remotion License; free individual / up-to-three-person use, https://www.remotion.dev/license. This is not an MIT dependency. |
| snapcn: laptop-frame, screen-recording, cursor-track, terminal-simulator, word-captions, text-reveal, count-grid | https://github.com/shadcn-labs/snapcn/tree/47ee435f17d85f74abf48b095b40d64fc9616fb0/registry/snap-cn | MIT, copyright 2026 Sri Nath (snap-cn). Full license header in every copied component; `src/vendor/snapcn/LICENSE`. Public free registry only; no Pro assets. |
| remocn: shader-mesh-gradient, shader-grain-gradient | https://github.com/Remocn/remocn/tree/fd2d3010a8183985553f9ddeb364313d57fb36b9/registry/remocn | MIT, copyright 2026 Remocn. Full license header in each wrapper; `src/vendor/remocn/LICENSE`. |
| Paper shaders and React bindings | @paper-design/shaders / shaders-react 0.0.81 | Apache-2.0 (not MIT); `licenses/Paper-shaders-Apache-2.0.txt`. remocn's shader implementation dependency. |
| Geist Sans and Geist Mono | Existing `apps/web/node_modules/geist` assets | SIL Open Font License 1.1; `licenses/Geist-OFL.txt`. Local font files, no remote font requests in the render. |
| Kokoro model, voice bank | kokoro-v1.0.int8.onnx / voices-v1.0.bin, model-files-v1.0 at https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.0 | Kokoro-82M Apache-2.0; https://huggingface.co/hexgrad/Kokoro-82M. Synthetic `am_michael` voice, not a voice clone. |
| kokoro-onnx | 0.6.1, https://github.com/thewh1teagle/kokoro-onnx | MIT, local inference. |
| faster-whisper / Whisper | faster-whisper 1.2.1 / base.en | MIT; local speech recognition for timing and verification. |
| Brand marks and production footage | This repository's `brand/bondrail/`, https://bondrail.vercel.app, Monadscan | Bondrail material and real production/testnet captures. Explorer is identified in evidence; no affiliation implied. |
| Music | `../narrate_update.py` | Original deterministic synthesized pad composed for this video; no stock recording or third-party music. |
| Example Solidity contract | Recorded isolated npm consumer | Original six-line MIT example inheriting published @bondrail/contracts; no deployment. |

## Local adaptations to MIT components

The copied sources retain their original license text. `theme.tsx` supplies Bondrail colors, local Geist fonts, CSS color mixing, and a no-op wrapper for the original editor selection marker. Word captions and count-grid use local Geist instead of fetching Google fonts. Caption safe margin is adjusted for 1080p landscape. TerminalSimulator adds a `recordedText` branch displaying verbatim captured output with explicit edited pauses; none of its example/default terminal content is rendered. Count-grid adds a `MetricCounter` using its label reveal with a fixed recorded value, so no intermediate fictional metric is displayed. Screen-recording camera helpers and cursor-track use captured cursor timestamps; crop/zoom transforms apply to both together. Cursor-track uses percentage positions so recorded coordinates remain accurate inside the scaled video plate. Laptop entrance is shortened to 15 frames (500 ms). Laptop placeholder/notch/demo paths are never used. remocn wrappers freeze shader time for deterministic abstract backgrounds; no wall-clock animation or GSAP is used.

All versions are recorded in package-lock.json. The application workspace and its pnpm lockfile are unchanged.
