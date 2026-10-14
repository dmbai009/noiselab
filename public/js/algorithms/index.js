import{validateDeepFilterModel,deepFilterRuntime,MODEL_SHA256}from'./deepfilternet3.js';
export const algorithms = [
  { id:'rnnoise', name:'RNNoise', version:'2025.1.5 · Xiph 70f1d256', rate:48000, frameSize:480, delay:960, available:true, note:'48 kHz · 20 ms · BSD-3 / Apache-2.0' },
  { id:'gtcrn', name:'GTCRN', version:'0.0.3 · gtcrn_simple.onnx', rate:16000, frameSize:256, delay:256, available:true, note:'16 kHz internal · bandwidth up to 8 kHz · MIT' },
  { id:'deepfilternet3', name:'DeepFilterNet3', version:'0.5.7-pre · official Rust / Tract 0.21.4', rate:48000, frameSize:480, delay:1440, available:true, note:'48 kHz · 30 ms · select the official model once' }
];
const cache = new Map();
async function load(id) {
  if (!cache.has(id)) {
    const promise = id==='deepfilternet3' ? deepFilterRuntime() : id === 'rnnoise'
      ? import('../../vendor/rnnoise/rnnoise.js').then(m=>m.Rnnoise.load())
      : import('../../vendor/gtcrn/index.js').then(async m=> {
        const url = new URL('../../vendor/gtcrn/gtcrn.wasm',import.meta.url);
        let wasmBinary;
        if (url.protocol === 'file:' && typeof process !== 'undefined' && process.versions?.node) {
          const fs = await import('node:fs/promises'); wasmBinary = await fs.readFile(url);
        } else { const r = await fetch(url); if(!r.ok) throw new Error('GTCRN asset load failed'); wasmBinary = await r.arrayBuffer(); }
        return { module:await m.loadGtcrnModule({wasmBinary}), Processor:m.GtcrnProcessor };
      });
    cache.set(id,promise); promise.catch(()=>cache.delete(id));
  }
  return cache.get(id);
}

export async function createDenoiser({algorithm, channels = 1,modelFile,attenuationLimit=100,onStage=()=>{}}) {
  const meta = algorithms.find(a=>a.id===algorithm);
  if (!meta?.available) throw new Error(algorithm === 'deepfilternet3' ? 'DeepFilterNet3 integration is unavailable; see docs/deepfilternet3.md' : 'Unknown algorithm');
  if (![1,2].includes(channels)) throw new Error('Only mono/stereo supported');
  if(!Number.isFinite(attenuationLimit)||attenuationLimit<0||attenuationLimit>100)throw new Error('Invalid model attenuation limit');
  const cached = cache.has(algorithm), start=performance.now();onStage('loading');
  const modelBytes=algorithm==='deepfilternet3'?await validateDeepFilterModel(modelFile):null;
  const module=await load(algorithm);onStage('initializing');
  let states=[], dead=false;
  const initialize=()=> { try { for(let i=0;i<channels;i++) {
    if(algorithm==='deepfilternet3'){
      const handle=module.api.df_create(modelBytes,attenuationLimit);
      const state={process:frame=>module.api.df_process_frame(handle,frame),destroy:()=>module.api.df_free(handle)};states.push(state);
      if(module.api.df_get_frame_length(handle)!==meta.frameSize)throw new Error('Unexpected DeepFilterNet3 frame size');
      module.api.df_set_post_filter_beta(handle,0);
    }else states.push(algorithm==='rnnoise' ? module.createDenoiseState() : new module.Processor(module.module));
  }} catch(e) { states.forEach(s=>s.destroy()); states=[]; throw e; } };
  initialize();
  onStage('processing');
  return {
    metadata:{...meta, channels, initMs:performance.now()-start, cached,...(algorithm==='deepfilternet3'?{delay:attenuationLimit<.01?0:meta.delay,attenuationLimit,modelSHA256:MODEL_SHA256,adapter:'official-rust-wasm'}:{})},
    process(pcm) {
      if(dead || pcm.length!==channels || pcm.some(c=>c.length!==meta.frameSize)) throw new Error('Invalid frame or destroyed processor');
      return pcm.map((frame,i)=> {
        let out;
        if(algorithm==='rnnoise') {out=Float32Array.from(frame,x=>x*32768); states[i].processFrame(out); for(let j=0;j<out.length;j++) out[j]/=32768;}
        else out=states[i].process(frame);
        if(out.length!==meta.frameSize||out.some(x=>!Number.isFinite(x))) throw new Error('Invalid model output'); return out;
      });
    },
    flush() { return this.process(Array.from({length:channels},()=>new Float32Array(meta.frameSize))); },
    reset() { if(dead) throw new Error('Destroyed processor'); states.forEach(s=>s.destroy()); states=[]; initialize(); },
    destroy() { if(!dead) {states.forEach(s=>s.destroy()); states=[]; dead=true;} },
    get memoryBytes() { return algorithm==='deepfilternet3'?module.exports.memory.buffer.byteLength:algorithm==='rnnoise' ? module.rnnoiseModule?.HEAPF32?.buffer.byteLength ?? null : module.module.HEAPF32.buffer.byteLength; }
  };
}
