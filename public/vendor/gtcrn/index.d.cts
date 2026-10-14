
//#region wasm-out/gtcrn.d.ts
type Ptr = number;
interface GtcrnModule {
  HEAPF32: Float32Array;
  _malloc(size: number): Ptr;
  _free(ptr: Ptr): void;
  _gtcrn_create(): Ptr;
  _gtcrn_destroy(state: Ptr): void;
  _gtcrn_process(state: Ptr, input: Ptr, output: Ptr): void;
  _gtcrn_process_48k(state: Ptr, input: Ptr, output: Ptr): void;
  _gtcrn_model_run(mix: Ptr, convCache: Ptr, traCache: Ptr, interCache: Ptr, enh: Ptr, convCacheOut: Ptr, traCacheOut: Ptr, interCacheOut: Ptr): void;
}
interface LoadOptions {
  wasmBinary?: ArrayBuffer | Uint8Array;
  locateFile?(path: string, scriptDirectory: string): string;
}
declare function loadGtcrnModule(options?: LoadOptions): Promise<GtcrnModule>;
//#endregion
//#region src/GtcrnProcessor.d.ts
declare const FRAME_SIZE = 256;
declare const SAMPLE_RATE = 16000;
declare const FRAME_SIZE_48K = 768;
declare const SAMPLE_RATE_48K = 48000;
type SupportedSampleRate = typeof SAMPLE_RATE | typeof SAMPLE_RATE_48K;
interface GtcrnProcessorOptions {
  sampleRate?: SupportedSampleRate;
}
declare class GtcrnProcessor {
  private readonly module;
  private readonly processNative;
  readonly frameSize: number;
  readonly sampleRate: SupportedSampleRate;
  private state;
  private inPtr;
  private outPtr;
  constructor(module: Readonly<GtcrnModule>, options?: GtcrnProcessorOptions);
  /**
   * Denoise one frame. The default is 256 samples at 16 kHz; use
   * `{ sampleRate: 48000 }` for 768 samples at 48 kHz.
   */
  process(frame: Float32Array): Float32Array;
  destroy(): void;
}
//#endregion
export { FRAME_SIZE, FRAME_SIZE_48K, type GtcrnModule, GtcrnProcessor, type GtcrnProcessorOptions, type LoadOptions, type Ptr, SAMPLE_RATE, SAMPLE_RATE_48K, type SupportedSampleRate, loadGtcrnModule };
//# sourceMappingURL=index.d.cts.map