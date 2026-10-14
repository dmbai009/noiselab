import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWav,readFrames,wavHeader,encodePCM,waveform} from '../public/js/audio/wav.js';
import {processWav} from '../public/js/audio/pipeline.js';
import {fixture,signal} from './fixtures.mjs';
for(const rate of [44100,48000])for(const channels of [1,2])for(const encoding of ['pcm16','pcm24','float32'])test(`${rate} Hz / ${channels} channels / ${encoding} / Unicode`,async()=>{
  const pcm=signal(rate,0.013,channels),f=fixture({rate,channels,encoding,pcm}),info=await inspectWav(f);
  assert.equal(info.sampleRate,rate);assert.equal(info.channels,channels);assert.equal(info.frames,pcm[0].length);assert.equal(info.name,'голос_ї.wav');
  const decoded=await readFrames(f,info,0,info.frames);
  const tolerance=encoding==='pcm16'?1/16384:encoding==='pcm24'?1/4194304:1e-7;
  for(let c=0;c<channels;c++)for(let i=0;i<info.frames;i++)assert.ok(Math.abs(decoded[c][i]-pcm[c][i])<tolerance);
});
test('PCM signed 32-bit and extensible PCM GUID',async()=>{
  const header=wavHeader({sampleRate:48000,channels:1,frames:3,encoding:'float32'}).slice(0,44);
  const simple=wavHeader({sampleRate:48000,channels:1,frames:3,encoding:'pcm16'});const v=new DataView(simple.buffer);
  v.setUint32(4,48,true);v.setUint32(28,192000,true);v.setUint16(32,4,true);v.setUint16(34,32,true);v.setUint32(40,12,true);
  const pcm=new Int32Array([-2147483648,0,2147483647]),f=new File([simple,pcm],'int32.wav');const info=await inspectWav(f);
  assert.deepEqual([...((await readFrames(f,info,0,3))[0])],[-1,0,1]);
  const ext=new Uint8Array(68);ext.set(simple.slice(0,36));const e=new DataView(ext.buffer);e.setUint32(4,72,true);e.setUint32(16,40,true);e.setUint16(20,65534,true);e.setUint16(36,22,true);e.setUint16(38,32,true);e.setUint32(40,4,true);ext.set([1,0,0,0,0,0,16,0,128,0,0,170,0,56,155,113],44);ext.set(new TextEncoder().encode('data'),60);e.setUint32(64,12,true);
  assert.equal((await inspectWav(new File([ext,pcm],'ext.wav'))).format,1);
});
test('reject corrupt, unsupported and nonfinite WAV',async()=>{
  await assert.rejects(inspectWav(new File(['not wav'],'bad.wav')));
  const good=fixture();await assert.rejects(inspectWav(new File([await good.slice(0,100).arrayBuffer()],'truncated.wav')));
  const raw=new Uint8Array(await good.arrayBuffer());raw[20]=6;await assert.rejects(inspectWav(new File([raw],'alaw.wav')));
  const nan=fixture({encoding:'float32',pcm:[new Float32Array([0,0,0])]});const bytes=new Uint8Array(await nan.arrayBuffer());new DataView(bytes.buffer).setFloat32(56,NaN,true);const f=new File([bytes],'nan.wav');const info=await inspectWav(f);await assert.rejects(readFrames(f,info,0,3));
});
test('odd-sized 24-bit exports include RIFF padding',async()=>{const f=fixture({pcm:[new Float32Array([.25])] ,encoding:'pcm24'});const info=await inspectWav(f);assert.equal(info.frames,1);assert.equal(f.size,48);});
test('float peaks preserved, integer clipping explicitly counted',()=>{const input=[new Float32Array([-1.5,0,1.7])];assert.equal(encodePCM(input,'pcm16').clipped,2);assert.equal(encodePCM(input,'float32').clipped,0);assert.throws(()=>encodePCM([new Float32Array([Infinity])]));});
test('very short silence, waveform, original identity',async()=>{
  const f=fixture({pcm:[new Float32Array(1)],encoding:'float32'}),info=await inspectWav(f);const peaks=await waveform(f,info,20);assert.ok(peaks.every(x=>x===0));
  let output;const m=await processWav({file:f,info,algorithm:'original',onChunk:async c=>{output=c;}});assert.equal(m.frames,1);assert.equal(output[0][0],0);
});
test('20 minute lazy WAV stays within one-second PCM blocks',async()=>{
  const frames=48000*1200,header=wavHeader({sampleRate:48000,channels:2,frames,encoding:'pcm16'});let largest=0;
  const file={name:'20-minute.wav',size:44+frames*4,slice(begin,end){largest=Math.max(largest,end-begin);return {arrayBuffer:async()=>{const b=new Uint8Array(end-begin);for(let i=begin;i<Math.min(end,44);i++)b[i-begin]=header[i];return b.buffer;}};}};
  const info=await inspectWav(file);let emitted=0;await processWav({file,info,algorithm:'original',onChunk:async pcm=>{emitted+=pcm[0].length;assert.ok(pcm[0].length<=48000);}});
  assert.equal(emitted,frames);assert.ok(largest<=48000*4);
});
test('cancel processing at block boundary',async()=>{const f=fixture({seconds:3}),info=await inspectWav(f);let stop=false;await assert.rejects(processWav({file:f,info,algorithm:'original',cancelled:()=>stop,onChunk:async()=>{stop=true;}}),/Cancelled/);});
