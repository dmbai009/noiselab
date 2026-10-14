import { readFrames } from './wav.js';
// Symmetric 64-tap Blackman-windowed sinc, 1024 fractional phases.
// Absolute sample positions prevent block-boundary rounding from accumulating.
export class SincKernel {
  constructor(inputRate, outputRate) {
    this.radius = 32; this.sameRate = inputRate === outputRate;
    const cutoff = Math.min(1, outputRate / inputRate) * 0.94;
    this.table = Array.from({length:1024},(_,phase) => {
      const frac = phase/1024, weights = new Float64Array(64); let sum = 0;
      for (let j=0;j<64;j++) { const d = j-31-frac, a = Math.PI*d*cutoff;
        const w = Math.abs(d) < 32 ? 0.42+0.5*Math.cos(Math.PI*d/32)+0.08*Math.cos(2*Math.PI*d/32) : 0;
        weights[j] = (Math.abs(a)<1e-10 ? cutoff : cutoff*Math.sin(a)/a)*w; sum += weights[j]; }
      for (let j=0;j<64;j++) weights[j] /= sum;
      return weights;
    });
  }
  at(array, position, base = 0) {
    if (this.sameRate && Math.abs(position-Math.round(position))<1e-8) return array[Math.round(position)-base] || 0;
    const k = Math.floor(position), weights = this.table[Math.min(1023,Math.floor((position-k)*1024))];
    let x = 0;
    for (let j=0;j<64;j++) x += (array[k-31+j-base] || 0)*weights[j];
    return x;
  }
}

export async function readResampled(file, info, start, end, offset, count, rate, kernel) {
  const ratio = info.sampleRate/rate;
  const low = Math.max(start,Math.floor(start+offset*ratio)-32);
  const high = Math.min(end,Math.ceil(start+(offset+count)*ratio)+33);
  const pcm = high > low ? await readFrames(file,info,low,high-low) : Array.from({length:info.channels},()=>new Float32Array(0));
  return pcm.map(c => { const out = new Float32Array(count);
    for(let i=0;i<count;i++) { const p = start+(offset+i)*ratio; if(p<end) out[i] = kernel.at(c,p,low); }
    return out; });
}

export class OutputResampler {
  constructor(inputRate, outputRate, channels, outputFrames, startPosition = 0) {
    this.kernel = new SincKernel(inputRate,outputRate); this.ratio = inputRate/outputRate;
    this.channels = channels; this.limit = outputFrames; this.start = startPosition;
    this.buffers = Array.from({length:channels},()=>new Float32Array(0)); this.base=0; this.received=0; this.emitted=0;
  }
  append(pcm) {
    this.buffers = this.buffers.map((c,i) => {const out = new Float32Array(c.length+pcm[i].length); out.set(c); out.set(pcm[i],c.length); return out;});
    this.received += pcm[0].length;
  }
  pull(final = false) {
    const first = this.emitted;
    while(this.emitted < this.limit && (final || this.start+this.emitted*this.ratio+33 < this.received)) this.emitted++;
    const output = this.buffers.map(c => {const out = new Float32Array(this.emitted-first); for(let i=0;i<out.length;i++) out[i]=this.kernel.at(c,this.start+(first+i)*this.ratio,this.base); return out;});
    const discard = Math.max(0,Math.min(this.buffers[0].length,Math.floor(this.start+this.emitted*this.ratio)-33-this.base));
    this.buffers = this.buffers.map(c=>c.slice(discard)); this.base += discard;
    return output;
  }
}
