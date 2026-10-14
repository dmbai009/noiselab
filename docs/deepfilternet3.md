# DeepFilterNet3 in NoiseLab 0.3.0

The official Rust/WASM engine processes audio in a Worker. Its output is available in the shared player, A/B comparison, WAV export and streaming from a file. RNNoise and GTCRN remain available.

## Setup

1. Extract the Windows release archive and run `NoiseLab.exe`. Keep the entire extracted folder together. For a development build, use `npm start`.
2. Obtain the official [DeepFilterNet3_onnx.tar.gz](https://github.com/Rikorose/DeepFilterNet/raw/d375b2d8309e0935d165700c91da9de862a99c31/models/DeepFilterNet3_onnx.tar.gz). NoiseLab does not download it automatically. For the local integration research, a copy was placed at `research/deepfilternet3/sources/official/models/DeepFilterNet3_onnx.tar.gz`; that research folder is excluded from the public repository and release.
3. Click **Select model** on the DeepFilterNet3 card and select the archive. Electron validates its SHA256 and remembers its location. Keep the file there; select it again if you move it. Browser sessions require selecting the file again after reopening the page.
4. Open WAV/OGG audio, select a region, and use **Process selection → Listen → Play**. Process the same selection with RNNoise/GTCRN to compare.
5. **Max suppression, dB** controls the actual model `atten_lim` parameter from 0 to 100. At 100, attenuation is unrestricted; at 0, the engine bypasses suppression. Changing this setting requires new inference. **Dry/Wet** separately mixes the computed output with the original.

After the model is available, the packaged app needs no internet, Python, Emscripten, npm or Rust to process audio.

## Implementation

Upstream commit `d375b2d8309e0935d165700c91da9de862a99c31`; libDF 0.5.7-pre; Tract 0.21.4; Rust 1.98.1; wasm-bindgen 0.2.92. Sources, versions and artifact hashes are recorded in `runtime/deepfilternet3/build-info.json`.

The bridge adds a panic hook and `df_free`, which releases the exact `Box<DFState>` returned by `df_create`. An earlier call to the internal `__wbg_dfstate_free` used a different wasm-bindgen representation and caused a reproduced failure. Neural inference and DSP code have not been rewritten.

Native frames contain 480 samples at 48 kHz. The verified configuration gives `(960−480)+2×480=1440` samples of delay, or 30 ms. The pipeline compensates that delay, pads the last frame and flushes the tail with zeros to retain the exact requested length. At 0 dB, the native runtime returns the current input without this delay, so the adapter reports zero delay; separate tests check the beginning and tail.

Other source rates use sinc resampling to and from 48 kHz. Stereo uses independent states. AGC, EQ, automatic normalization and postfilter are disabled. Dry/Wet and optional audition-only LUFS matching keep their existing behavior.

## Weights and licenses

The accepted official epoch-120 archive is **7,983,136 bytes**, with SHA256:

```text
c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616
```

Upstream, lofcz, Mezon and boredland/noise archives matched; the same bytes were found inside lofcz's published WASM.

Engine/bridge code is MIT OR Apache-2.0. Notices for 138 normal/build Rust packages are retained in `licenses/deepfilternet3-rust*`. Two crates without separate LICENSE files retain explicit MIT metadata, attribution and a labeled standard license text; these are not misrepresented as original upstream license files.

Questions about the weights' license remain open with the upstream author: [#697](https://github.com/Rikorose/DeepFilterNet/issues/697), [#700](https://github.com/Rikorose/DeepFilterNet/issues/700), [#709](https://github.com/Rikorose/DeepFilterNet/issues/709). The **repository and release contain the engine without weights**. The selected model stays an external local file. Commercial redistribution of those weights is not asserted to be cleared.

NoiseLab's own code remains MIT. Its license does not replace third-party terms.

## Rebuilding the engine

Ordinary app builds use the checked-in `public/vendor/deepfilternet3/df.js` and `df_bg.wasm`. Rebuilding the engine requires Rust 1.98.1, its wasm32 target and wasm-bindgen-cli 0.2.92:

```powershell
rustup toolchain install 1.98.1 --target wasm32-unknown-unknown
rustup override set 1.98.1
cargo install wasm-bindgen-cli --version 0.2.92 --root research/deepfilternet3/toolchain -j 4
npm run build:deepfilter
npm run vendor
npm run build:win
```

The build script pins the source commit, saved Cargo.lock and bridge. It does not modify other projects or install a global SDK. Absolute build paths can change diagnostic strings and the binary hash; update the manifest and asset hashes for your own verified build.

## Verification and limits

Run `npm test`, `npm run test:browser`, `npm run test:deepfilter:browser` and `npm run test:deepfilter:electron`. DFN3 tests accept an external archive through `NOISELAB_DF_MODEL`; Node tests that require it explicitly skip if it is absent. Browser/Electron DFN3 checks also require the reference speech WAV downloaded by the separate `node tools/fetch-fixture.mjs` command.

The [complete A–G research report](deepfilternet3-integration-research.md), in Russian, records initial failures, numerical comparisons, 10/60-second measurements, production checks and licensing. Real reference speech and synthetic technical cases were checked. Human listening assessment, whisper/keyboard/fan corpora and STOI/PESQ were not performed.
