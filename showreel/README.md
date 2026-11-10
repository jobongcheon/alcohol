# 디자인하는AI — 15s Motion Showreel

`designing-ai-showreel.mp4` · 1920×1080 · 60fps · 15.0s · AAC stereo

8 bars at 128 BPM (1 bar = 1.875s). Every cut lands on a downbeat.

| Bar | Time | Scene | Transition out |
|---|---|---|---|
| 0 | 0.00 | BOOT: prompt `> AI야, 디자인해줘` collapses into a construction grid | volt iris flood |
| 1 | 1.88 | INTRO: 디자인 / 하는 / AI kinetic slam, strip-sliced lockup | paper bar wipe |
| 2 | 3.75 | DESIGN SYSTEM: Figma tokens auto-wire into a component | zoom-through |
| 3 | 5.63 | MOTION: shape morph + squash/stretch + live graph editor | shape match-cut |
| 4 | 7.50 | VIBE CODING: code types itself → web service builds → deploy | glitch whip-pan |
| 5 | 9.38 | CHARACTER: 1,800 particles assemble a mascot + brand callouts | diagonal slash |
| 6 | 11.25 | NUMBERS: 99,100 subscribers · 6.6M+ views · 61 videos · since 2023 | white flash |
| 7 | 13.13 | OUTRO: logo build + wordmark + light sweep | fade |

Channel stats come from a third-party tracker (snapshot taken 2026-10-12).

## Pipeline (`src/`)
- `reel.js`: a deterministic, time-driven Canvas2D scene graph. Each frame is a pure function of `t`.
- Motion blur: 5 sub-frames over a 0.6 shutter, accumulated in a linear-light RGBA16F WebGL2 buffer.
- Post-processing: radial chromatic aberration, beat-synced glitch blocks, vignette, film grain, and flash.
- `render.js`: headless Chromium (Playwright) renders frames in parallel.
- `audio.py`: a procedural score in numpy/scipy (kick, clap, hats, sidechain-style bass, arps, pads, risers, impacts, whooshes, UI foley) with convolution reverb, locked to the same beat grid.

```bash
cd src && npm i pretendard @fontsource/space-grotesk @fontsource/jetbrains-mono @fontsource/unbounded playwright
node render.js frames 0-899 3 && python3 audio.py
ffmpeg -framerate 60 -i frames/f%04d.jpg -i score.wav -c:v libx264 -b:v 18M -pix_fmt yuv420p -c:a aac -shortest out.mp4
```
