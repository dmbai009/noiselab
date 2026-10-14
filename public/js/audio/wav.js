const ascii = (v, p, n) => String.fromCharCode(...new Uint8Array(v.buffer, v.byteOffset + p, n));
const integer = (n) => Number.isSafeInteger(n) && n >= 0;

export async function inspectWav(file) {
  if (!file || !integer(file.size) || file.size < 44) throw new Error('Invalid WAV: file is too short');
  const first = new DataView(await file.slice(0, 12).arrayBuffer());
  if (ascii(first, 0, 4) !== 'RIFF' || ascii(first, 8, 4) !== 'WAVE') throw new Error('Only RIFF WAVE is supported (RF64/RIFX are not supported)');
  const limit = first.getUint32(4, true) + 8;
  if (limit > file.size || limit < 44) throw new Error('Truncated RIFF');
  let fmt, data, offset = 12, chunks = 0;
  while (offset + 8 <= limit) {
    if (++chunks > 10000) throw new Error('Too many WAV chunks');
    const header = new DataView(await file.slice(offset, offset + 8).arrayBuffer());
    const id = ascii(header, 0, 4), size = header.getUint32(4, true), begin = offset + 8;
    if (begin + size > limit) throw new Error(`Truncated ${id} chunk`);
    if (id === 'fmt ') {
      if (size < 16 || size > 65536) throw new Error('Invalid WAV fmt');
      const v = new DataView(await file.slice(begin, begin + size).arrayBuffer());
      let format = v.getUint16(0, true);
      const channels = v.getUint16(2, true), sampleRate = v.getUint32(4, true);
      const blockAlign = v.getUint16(12, true), bits = v.getUint16(14, true);
      if (format === 65534) {
        if (size < 40 || v.getUint16(16, true) < 22 || v.getUint16(18, true) !== bits) throw new Error('Unsupported extensible WAV precision');
        const guidTail = [0,0,0,0,16,0,128,0,0,170,0,56,155,113];
        if (guidTail.some((x, i) => v.getUint8(26 + i) !== x)) throw new Error('Unsupported WAV subformat GUID');
        format = v.getUint16(24, true);
      }
      if (![1,3].includes(format) || ![1,2].includes(channels) || sampleRate < 8000 || sampleRate > 192000 ||
          (format === 1 ? ![16,24,32].includes(bits) : bits !== 32) || blockAlign !== channels * bits / 8 ||
          v.getUint32(8, true) !== sampleRate * blockAlign) throw new Error('Unsupported WAV encoding, rate, channels or alignment');
      fmt = { format, channels, sampleRate, bits, blockAlign };
    }
    if (id === 'data' && !data) data = { dataOffset: begin, dataBytes: size };
    offset = begin + size + (size & 1);
  }
  if (!fmt || !data || data.dataBytes % fmt.blockAlign) throw new Error('Missing or misaligned WAV data');
  const frames = data.dataBytes / fmt.blockAlign;
  if (!frames) throw new Error('Empty WAV');
  return { ...fmt, ...data, frames, duration: frames / fmt.sampleRate, size: file.size, name: file.name || 'audio.wav' };
}

export async function readFrames(file, info, start, count) {
  if (!integer(start) || !integer(count) || start + count > info.frames) throw new Error('Invalid PCM range');
  const begin = info.dataOffset + start * info.blockAlign;
  const bytes = await file.slice(begin, begin + count * info.blockAlign).arrayBuffer();
  if (bytes.byteLength !== count * info.blockAlign) throw new Error('Truncated audio');
  const v = new DataView(bytes), out = Array.from({ length: info.channels }, () => new Float32Array(count));
  const step = info.bits / 8;
  for (let i = 0; i < count; i++) for (let c = 0; c < info.channels; c++) {
    const p = (i * info.channels + c) * step;
    let x;
    if (info.format === 3) x = v.getFloat32(p, true);
    else if (step === 2) x = v.getInt16(p, true) / 32768;
    else if (step === 4) x = v.getInt32(p, true) / 2147483648;
    else { const raw = v.getUint8(p) | v.getUint8(p+1) << 8 | v.getUint8(p+2) << 16; x = (raw & 0x800000 ? raw - 0x1000000 : raw) / 8388608; }
    if (!Number.isFinite(x)) throw new Error('Non-finite PCM in WAV');
    out[c][i] = x;
  }
  return out;
}

export function wavHeader({ sampleRate, channels, frames, encoding = 'pcm24' }) {
  if (!integer(frames) || ![1,2].includes(channels) || !integer(sampleRate) || sampleRate < 8000 || sampleRate > 192000 || !['pcm16','pcm24','float32'].includes(encoding)) throw new Error('Invalid WAV export parameters');
  const bits = encoding === 'pcm16' ? 16 : encoding === 'pcm24' ? 24 : 32;
  const float = encoding === 'float32', headerSize = float ? 56 : 44;
  const dataBytes = frames * channels * bits / 8;
  if (dataBytes + headerSize - 8 > 0xffffffff) throw new Error('RIFF WAV exceeds 4 GiB; export shorter selections');
  const bytes = new Uint8Array(headerSize), v = new DataView(bytes.buffer);
  const put = (p, s) => [...s].forEach((x,i) => v.setUint8(p+i,x.charCodeAt(0)));
  put(0,'RIFF'); v.setUint32(4,headerSize - 8 + dataBytes + (dataBytes & 1),true); put(8,'WAVE'); put(12,'fmt ');
  v.setUint32(16,16,true); v.setUint16(20,float ? 3 : 1,true); v.setUint16(22,channels,true);
  v.setUint32(24,sampleRate,true); v.setUint32(28,sampleRate*channels*bits/8,true);
  v.setUint16(32,channels*bits/8,true); v.setUint16(34,bits,true);
  if (float) { put(36,'fact'); v.setUint32(40,4,true); v.setUint32(44,frames,true); }
  put(headerSize-8,'data'); v.setUint32(headerSize-4,dataBytes,true);
  return bytes;
}

export function encodePCM(channels, encoding = 'pcm24') {
  if (!channels.length || !channels.every(c => c.length === channels[0].length) || !['pcm16','pcm24','float32'].includes(encoding)) throw new Error('Invalid PCM export');
  const step = encoding === 'pcm16' ? 2 : encoding === 'pcm24' ? 3 : 4;
  const bytes = new Uint8Array(channels[0].length * channels.length * step), v = new DataView(bytes.buffer);
  let clipped = 0;
  for (let i = 0; i < channels[0].length; i++) for (let c = 0; c < channels.length; c++) {
    const x = channels[c][i], p = (i * channels.length + c) * step;
    if (!Number.isFinite(x)) throw new Error('Non-finite output');
    if (encoding === 'float32') v.setFloat32(p,x,true);
    else {
      if (x > 1 || x < -1) clipped++;
      const y = Math.max(-1,Math.min(1,x));
      if (step === 2) v.setInt16(p,Math.round(y < 0 ? y*32768 : y*32767),true);
      else { const n = Math.round(y < 0 ? y*8388608 : y*8388607); v.setUint8(p,n&255); v.setUint8(p+1,(n>>8)&255); v.setUint8(p+2,(n>>16)&255); }
    }
  }
  return { bytes, clipped };
}

export function createStats() {
  let n = 0, squares = 0, peak = 0;
  return { add(channels) { for (const c of channels) for (const x of c) { n++; squares += x*x; peak = Math.max(peak,Math.abs(x)); } },
    get value() { const rms = Math.sqrt(squares/Math.max(1,n)); return { rms, rmsDb: 20*Math.log10(Math.max(1e-12,rms)), peak, peakDb: 20*Math.log10(Math.max(1e-12,peak)) }; } };
}

export async function waveform(file, info, bins = 1600, progress = () => {}, cancelled = () => false) {
  const peaks = new Float32Array(bins * 2); peaks.fill(0);
  const stride = Math.max(1,Math.floor(info.frames/(bins*256)));
  for (let start = 0; start < info.frames; start += info.sampleRate * 4) {
    if (cancelled()) throw new Error('Cancelled');
    const pcm = await readFrames(file,info,start,Math.min(info.sampleRate*4,info.frames-start));
    for (let i = 0; i < pcm[0].length; i += stride) {
      const b = Math.min(bins-1,Math.floor((start+i)*bins/info.frames));
      for (const c of pcm) { peaks[2*b] = Math.min(peaks[2*b],c[i]); peaks[2*b+1] = Math.max(peaks[2*b+1],c[i]); }
    }
    progress((start+pcm[0].length)/info.frames);
  }
  return peaks;
}
