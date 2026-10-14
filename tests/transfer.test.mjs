import test from'node:test';import assert from'node:assert/strict';import {processWav}from'../public/js/audio/pipeline.js';import {inspectWav}from'../public/js/audio/wav.js';import {fixture}from'./fixtures.mjs';
test('transferring emitted PCM does not lose sample accounting',async()=>{
  const file=fixture({seconds:2}),info=await inspectWav(file);const offsets=[];
  const metrics=await processWav({file,info,algorithm:'original',onChunk:async(pcm,offset)=>{offsets.push(offset);structuredClone(pcm,{transfer:pcm.map(c=>c.buffer)});}});
  assert.equal(metrics.frames,96000);assert.deepEqual(offsets,[0,48000]);
});
test('unknown model is rejected even when Dry/Wet is zero',async()=>{const file=fixture(),info=await inspectWav(file);await assert.rejects(processWav({file,info,algorithm:'unknown',wet:0}),/unavailable/);});
