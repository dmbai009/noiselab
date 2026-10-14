import test from 'node:test';import assert from 'node:assert/strict';
import {SincKernel,OutputResampler,readResampled} from '../public/js/audio/resample.js';
import {inspectWav} from '../public/js/audio/wav.js';import {fixture} from './fixtures.mjs';
test('absolute resampling matches across chunk boundaries 44.1→48',async()=>{
  const f=fixture({rate:44100,seconds:.1,encoding:'float32'}),info=await inspectWav(f),k=new SincKernel(44100,48000);
  const whole=(await readResampled(f,info,0,info.frames,0,4800,48000,k))[0];
  for(let p=0;p<4800;p+=137){const piece=(await readResampled(f,info,0,info.frames,p,Math.min(137,4800-p),48000,k))[0];assert.deepEqual(piece,whole.slice(p,p+piece.length));}
});
test('incremental output resampling has exact count and no block clicks',()=>{
  for(const rate of [16000,48000]){
    const input=Float32Array.from({length:rate},(_,i)=>Math.sin(i*2*Math.PI*250/rate));
    const reference=new OutputResampler(rate,44100,1,44100);reference.append([input]);const expected=reference.pull(true)[0];
    const chunked=new OutputResampler(rate,44100,1,44100),actual=new Float32Array(44100);let written=0;
    for(let p=0;p<input.length;p+=257){chunked.append([input.slice(p,p+257)]);const out=chunked.pull()[0];actual.set(out,written);written+=out.length;assert.ok(chunked.buffers[0].length<400);}
    const tail=chunked.pull(true)[0];actual.set(tail,written);written+=tail.length;assert.equal(written,44100);assert.deepEqual(actual,expected);
  }
});
test('antialias filter attenuates 12 kHz at 48→16',()=>{const k=new SincKernel(48000,16000),high=Float32Array.from({length:4800},(_,i)=>Math.sin(i*2*Math.PI*12000/48000));let sum=0;for(let i=32;i<1568;i++)sum+=k.at(high,i*3)**2;assert.ok(Math.sqrt(sum/1536)<0.001);});
test('same-rate identity and impulse time',()=>{const input=new Float32Array(4800);input[2401]=1;const s=new OutputResampler(48000,48000,1,input.length);s.append([input]);assert.deepEqual(s.pull(true)[0],input);});
