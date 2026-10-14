# NoiseLab

A standalone, local speech denoising laboratory for Windows and the browser. Compare **RNNoise, GTCRN and DeepFilterNet3** using actual neural inference in CPU WebAssembly, synchronized A/B playback and WAV export. Supports WAV and OGG input. Your audio stays on your computer: no microphone access, accounts, audio uploads, telemetry or runtime CDN requests.

The interface opens in **English**. Russian is available from the language selector.

## Download and run

Download **NoiseLab-0.3.0-windows-x64.zip** from the [0.3.0 release](https://github.com/dmbai009/noiselab/releases/tag/v0.3.0). Extract the entire archive and open `NoiseLab.exe` inside the extracted folder. Keep all accompanying files together. Node.js, npm, Python, Rust and FFmpeg are not required to run the Windows build. The executable is unsigned.

RNNoise and GTCRN work immediately. **DeepFilterNet3 requires an external model file**; its engine is included, but its weights are not bundled because their redistribution terms have not been separately confirmed. See [DeepFilterNet3 setup](docs/deepfilternet3.md) and the [seven-route integration research](docs/deepfilternet3-integration-research.md).

## Development setup

Development was tested on Windows 10 x64 with Node.js **24.21.0** and Electron **44.7.2**. Use Node.js 24 LTS; parts of the Electron 44 installation toolchain require Node.js 22.12 or later.

```powershell
git clone https://github.com/dmbai009/noiselab.git
cd noiselab
npm ci
npm start
```

Installing dependencies requires internet access once. `postinstall` copies the WASM libraries and bundled models from pinned npm packages into `public/vendor`. The prebuilt DeepFilterNet3 engine is tracked in the repository. Subsequent launches and audio processing work offline.

For browser use:

```powershell
npm run browser
```

Open [http://127.0.0.1:4173](http://127.0.0.1:4173) in Chrome or Edge with WebAssembly SIMD support. The server listens on loopback and only serves static resources; processing happens locally in the browser, with no audio-upload endpoint.

## Using NoiseLab

1. Click **Open WAV / OGG** or drop a file onto the top panel. OGG Vorbis and Opus support mono and stereo. A Worker decodes OGG pages through local WASM into temporary browser disk storage (OPFS). FFmpeg is not needed. Allow approximately `duration × sample rate × channels × 4` bytes of free space: 20 minutes at 48 kHz stereo needs about 439 MiB. Vorbis retains its native rate; Opus decodes at 48 kHz with pre-skip and final-granule handling.
2. Click the waveform to seek, or drag to select a region. You can also enter the start and end times. Zoom follows the playback position.
3. Click **Process selection** for an algorithm. Select the external model first for DeepFilterNet3. Preview is limited to 60 seconds and 12 MiB of PCM per variant; high sample rates and stereo reduce the allowed duration. The current limit appears beside the selection.
4. Click **Listen** to select a variant, then **Play**. Pause/resume, Loop and A/B retain the position within the current selection. Switching uses a 20 ms fade. The original is read directly from the source PCM.
5. **Strength · Dry/Wet** mixes aligned original and processed audio: 0% uses the original samples; 100% uses the model output. Changing the mix does not run inference again. DeepFilterNet3 also has a separate **Max suppression, dB** setting that controls the model itself and requires reprocessing.
6. Optional **Match audition loudness (LUFS)** affects playback only. It uses K weighting and gating based on BS.1770 for mono/stereo, without claiming meter certification. No gain is applied to silence or regions shorter than 400 ms. Gain increases are limited to 12 dB; decreases are not limited. Audition gain can exceed full scale. Export uses the original PCM values and the chosen Dry/Wet mix.
7. Expand **Advanced settings**, choose the selection or entire file, and select PCM16, PCM24 or Float32. Processed audio and decoded Original export as WAV. **Copy original** makes a byte-for-byte copy of the input WAV or OGG, including metadata. OGG copies retain `.ogg`; processed output is not re-encoded to OGG.

Typical output names are `voice_original.wav`, `voice_rnnoise.wav`, `voice_gtcrn.wav` and `voice_deepfilternet3.wav`. The source file is protected from overwriting. Electron uses Save As, explicit replacement confirmation and a temporary file beside the destination, followed by length validation, sync and rename. Cancellation removes the unfinished temporary file.

Chrome and Edge can write through the File System Access API. The fallback download assembles a Blob and is limited to **128 MiB**. Standard RIFF output is limited to **4 GiB**; RF64 is not implemented. Integer PCM export clips values outside [-1, 1] and reports the number of clipped samples. Float32 preserves values above full scale. No hidden normalization or dithering is applied.

## Models

| Algorithm | Implementation | Internal sample rate | Availability |
|---|---|---|---|
| RNNoise | `@shiguredo/rnnoise-wasm` 2025.1.5, Xiph `70f1d256` | 48 kHz | Included |
| GTCRN | `@sapphi-red/gtcrn-wasm` 0.0.3, `gtcrn_simple.onnx` | 16 kHz | Included |
| DeepFilterNet3 | Official Rust/libDF, Tract 0.21.4, local WASM | 48 kHz | Engine included; [select external weights](docs/deepfilternet3.md) |

RNNoise uses 480-sample frames with 960 samples of delay compensation (20 ms). GTCRN uses 256-sample frames and 256 samples of compensation (16 ms). DeepFilterNet3 uses 480-sample frames with 1,440 samples of compensation (30 ms), or zero delay in its native 0 dB bypass mode. Stereo uses independent model states for each channel. GTCRN limits the Wet spectrum to approximately 8 kHz, which affects high-frequency voice detail.

Selections use up to 250 ms of preceding context. Zero-padded final frames and tail flushing preserve the requested output length. Other source rates use sinc resampling to and from the model rate. See [architecture](docs/architecture.md).

Exact versions, sources, hashes and third-party licenses are recorded in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES), [models/manifest.json](models/manifest.json), [models/assets.sha256.json](models/assets.sha256.json) and [licenses/](licenses/). The neural models are not reimplemented in JavaScript.

## Streaming and performance

**Benchmark algorithms** runs each available model twice on the same selection; DeepFilterNet3 participates after its weights are selected. The table distinguishes inference time from the complete pipeline. **First** means the first pass in that comparison; a cached module is identified separately. Truly cold loads require a new Worker or process.

**Real time from file** computes new blocks during playback with 0.5–2 seconds of buffering. It does not replay precomputed results. You can switch between Original and the current model. Stop streaming and use regular preview for seeking, Loop, another model or LUFS matching. An underrun means a computed block missed its playback deadline; the gap is counted, and the original is not silently substituted. Algorithmic delay is compensated, while the initial buffer remains a startup delay.

RTF is neural inference time divided by audio duration. Complete pipeline time also includes reading, resampling, measurements, messages and writing. Streaming wall time includes waiting for playback and does not represent offline export speed. WASM memory means linear memory, not total application RSS. CPU percentage is not reported.

## Tests and builds

```powershell
npm test
npm run test:browser
npm run test:electron
npm run build:win
```

Puppeteer requires Chrome or Edge; set `NOISELAB_CHROME` if it is installed elsewhere. Node tests cover WAV parsing, resampling, blocks, model lifecycle and cancellation. Browser tests execute real RNNoise and GTCRN inference and check the interface, player, export, streaming and display scaling. Electron smoke tests use hidden windows, separate profiles, real model output and Web Audio. These checks do not replace human listening tests.

DeepFilterNet3 tests use an external official archive:

```powershell
$env:NOISELAB_DF_MODEL = "C:\Models\DeepFilterNet3_onnx.tar.gz"
node tools/fetch-fixture.mjs
npm test
npm run test:deepfilter:browser
npm run test:deepfilter:electron
```

Node tests that require these weights explicitly skip when the archive is absent. DeepFilterNet3 browser and Electron tests also need the reference WAV created by `fetch-fixture.mjs`. This fixture is downloaded only by that explicit command and is excluded from the repository and release.

The unpacked Windows build is `dist/win-unpacked/NoiseLab.exe`; distribute the entire `win-unpacked` folder. `npm run build:portable` is also available. The [DeepFilterNet3 guide](docs/deepfilternet3.md) documents rebuilding its WASM engine; ordinary application builds use the checked-in engine and need no Rust toolchain.

For a longer benchmark:

```powershell
node tools/fetch-fixture.mjs
npm run benchmark
```

The pinned upstream noisy speech recording is repeated to reach 1, 5 and 20 minutes; these are not unique recordings of those lengths. Results and hardware details go into `test-output/benchmark.json`. No rights to that third-party recording are granted by NoiseLab.

Additional checks: `npm run test:ogg:browser`, `npm run test:ogg:electron`, `npm run test:stability`, `npm run test:recovery`. OGG fixture generation requires FFmpeg, optionally specified by `NOISELAB_FFMPEG`; this is a test dependency only. `npm run vendor` rebuilds the local bundles. Retained LGPL parser sources can be replaced and rebuilt.

## Stability and limits

Electron uses software interface rendering and a single user-facing instance. Test processes use independent profiles and are hidden from the taskbar. Limited automatic recovery is provided after an interface-process crash, with a request to reopen the source file; unfinished exports are removed.

The local log is `%APPDATA%\noiselab\logs\noiselab.log`; native crash dumps are stored under `crashes/` beside it. Reports are not uploaded (`uploadToServer: false`). Text logs do not contain PCM or recording contents. Native dumps may contain process-memory fragments and remain local.

The originally reported disappearance while minimized was not reliably reproduced, and the older build had no diagnostic record of its cause. The cause is therefore not claimed to be established. The two-minute minimized-window check and controlled renderer-crash test are documented in [the 0.2 update](docs/update-0.2.md).

- WAV input supports mono/stereo, PCM16/24/32, Float32 and WAVE_FORMAT_EXTENSIBLE with matching valid precision, at 8–192 kHz. RF64, RIFX, compressed WAV and more than two channels are unsupported.
- OGG input supports single complete Vorbis or Opus streams. Video, FLAC-in-OGG, chained/multiplexed streams and damaged pages are rejected. Page checksums are validated. Unsupported files, including WebM, preserve the currently loaded source.
- OGG decoding requires sufficient OPFS disk space/quota. Temporary decoded PCM is removed when changing the source. Browser storage can retain it after a crash; Electron clears its own temporary browser filesystem at the next launch.
- Long-file waveforms use subsampling for speed, so narrow peaks can be missing from the overview.
- Only Original and results for the bounded preview selection are retained in memory. Changing the selection discards results. Full-file export does not retain the complete processed PCM.
- Symmetric sinc resampling compensates its timing shift, but model filters can change frequency phase. Identical Dry/Wet phase is not guaranteed. No extra normalizer, compressor or gate is added.
- DeepFilterNet3 accepts only the verified official model archive. A classic Wiener filter is not implemented. Human evaluation on personal voices, whispering and emotional speech remains incomplete; numerical tests do not establish a winner for speech naturalness.

The [original report](docs/report.md) records earlier checks and limitations; [the 0.3.0 integration research](docs/deepfilternet3-integration-research.md) records the current DeepFilterNet3 work. Research and most historical documents are in Russian.

## License

NoiseLab's own code is licensed under **MIT**; see [LICENSE](LICENSE). Third-party code, bundled models and codecs retain their respective licenses and notices. MIT does not replace those terms.

DeepFilterNet3 engine code is MIT OR Apache-2.0. The upstream author's clarification of the published weights' redistribution terms is still pending ([issue #700](https://github.com/Rikorose/DeepFilterNet/issues/700)); these weights are not included in the repository or release.

The published RNNoise WASM contains the official default model. Its source is BSD-3-Clause and the wrapper is Apache-2.0, but the exact upstream weights archive has no separate license text. Coverage of those weights by the source license is an inference, rather than a separately confirmed grant; unrestricted commercial redistribution is not asserted. See [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) for the recorded scope and attribution.
