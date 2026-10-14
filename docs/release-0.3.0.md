# NoiseLab 0.3.0

Local WAV/OGG speech denoising with RNNoise, GTCRN and real DeepFilterNet3 inference.

## Download

Download **NoiseLab-0.3.0-windows-x64.zip**, extract the entire archive, and run **NoiseLab.exe** inside the extracted folder. Keep the accompanying files together. No Node.js, Python, Rust or FFmpeg installation is required. The Windows executable is unsigned.

## Changes

- Added DeepFilterNet3 using the official Rust/libDF and Tract WASM engine, with preview, A/B playback, WAV export and streaming from a file.
- Added the model's native maximum-suppression control, separate from Dry/Wet mixing.
- Preserved exact output length, compensated processing delay, and supported resampling and independent stereo states.
- Hardened cancellation, source replacement during processing/streaming, and asynchronous player setup.
- Made English the default interface language; Russian remains selectable.
- Translated the README and DeepFilterNet3 setup guide into English.

## DeepFilterNet3 setup

RNNoise and GTCRN are included and ready to use. **DeepFilterNet3 weights are not bundled.** Select the official `DeepFilterNet3_onnx.tar.gz` using **Select model**. The desktop app validates it and remembers its location; keep the archive at that location. Processing then works offline. See the [setup guide](https://github.com/dmbai009/noiselab/blob/main/docs/deepfilternet3.md).

The engine is included, but the upstream weights' redistribution terms remain unclarified. NoiseLab's own code remains **MIT**. Third-party licenses and attribution are preserved in `THIRD_PARTY_NOTICES` and `licenses/`.

The research report covers all seven evaluated integration routes. Automated checks verify actual neural processing, export and playback; they do not establish a subjective audio-quality ranking.
