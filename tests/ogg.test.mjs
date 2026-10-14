import test from'node:test';import assert from'node:assert/strict';import{readFile,writeFile}from'node:fs/promises';
import{oggFixtures}from'../tools/ogg-fixtures.mjs';import{inspectOgg,decodeOgg}from'../public/js/audio/ogg.js';import{inspectWav,readFrames}from'../public/js/audio/wav.js';import{audioContainer}from'../public/js/audio/file-validation.js';
// Node tests exercise published decoder source; browser tests exercise local UMD Worker bundles.
import{OggVorbisDecoder}from'@wasm-audio-decoders/ogg-vorbis';import{OggOpusDecoder}from'ogg-opus-decoder';import{oggPages}from'../public/js/audio/ogg.js';
let fixtures;
test('real OGG Vorbis / Opus decoders: mono/stereo, exact length and native PCM reference',async()=>{
  fixtures=await oggFixtures();
  for(const f of fixtures){const bytes=await readFile(f.output),file=new File([bytes],'голос.ogg');const meta=await inspectOgg(file);assert.equal(await audioContainer(file),'ogg');assert.equal(meta.codec,f.codec);assert.equal(meta.channels,f.channels);
    const decoder=f.codec==='vorbis'?new OggVorbisDecoder():new OggOpusDecoder();await decoder.ready;const pieces=Array.from({length:f.channels},()=>[]);let count=0;
    try{for(let p=0;p<bytes.length;p+=1011){const r=await decoder.decode(bytes.subarray(p,p+1011));assert.equal(r.errors.length,0);if(r.samplesDecoded)r.channelData.forEach((c,i)=>pieces[i].push(c));count+=r.samplesDecoded;}const tail=await decoder.flush();if(tail.samplesDecoded)tail.channelData.forEach((c,i)=>pieces[i].push(c));count+=tail.samplesDecoded;}
    finally{decoder.free();}
    const reference=new File([await readFile(f.decoded)],'reference.wav'),info=await inspectWav(reference);assert.equal(count,info.frames);const expected=await readFrames(reference,info,0,info.frames);
    for(let c=0;c<f.channels;c++){const actual=new Float32Array(count);let offset=0;for(const part of pieces[c]){actual.set(part,offset);offset+=part.length;}let square=0;for(let i=0;i<count;i++)square+=(actual[i]-expected[c][i])**2;assert.ok(Math.sqrt(square/count)<2e-5,'Decoder differs from FFmpeg '+f.codec);assert.ok(actual.every(Number.isFinite));}
  }
});
test('unsupported WebM is identified before replacing an open source',async()=>{const file=new File([new Uint8Array(200).fill(2)],'video.webm');assert.equal(await audioContainer(file),null);await assert.rejects(inspectOgg(file));});
test('unsupported OGG codec and truncated identification are rejected',async()=>{const header=new Uint8Array(28);header.set(new TextEncoder().encode('OggS'));header[26]=1;await assert.rejects(inspectOgg(new File([header],'bad.ogg')));});
test('OGG page reader bounds allocations and rejects damaged/truncated audio',async()=>{const[f]=await oggFixtures(),bytes=await readFile(f.output);let end=0;for await(const page of oggPages(new File([bytes],'valid.ogg'))){assert.ok(page.bytes.length<=65307);end=page.end;}assert.equal(end,bytes.length);const broken=new Uint8Array(bytes);broken[broken.length-1]^=1;await assert.rejects(async()=>{for await(const page of oggPages(new File([broken],'bad.ogg'))){}},/checksum/);await assert.rejects(async()=>{for await(const page of oggPages(new File([bytes.subarray(0,bytes.length-3)],'short.ogg'))){}},/Truncated/);});
