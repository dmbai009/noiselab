import { inspectWav, waveform, wavHeader, encodePCM, readFrames } from '../audio/wav.js';
import { processWav } from '../audio/pipeline.js';
import{decodeOgg,createOggSink}from'../audio/ogg.js';
let busy=false, stopped=false, ackResolve;
const acknowledge=()=>new Promise(resolve=>{ackResolve=resolve;});
const send=message=>postMessage(message);
onmessage=async({data})=> {
  if(data.type==='ack') {ackResolve?.();ackResolve=null;return;}
  if(data.type==='cancel') {stopped=true;ackResolve?.();return;}
  if(busy) return;
  busy=true;stopped=false;
  let phase='loading';
  try {
    const {file}=data;
    if(data.type==='decode-ogg'){
      const decoded=await decodeOgg(file,{openSink:()=>createOggSink(data.storageName),onProgress:value=>send({type:'progress',value}),cancelled:()=>stopped});
      send({type:'done',...decoded});return;
    }
    if(data.type==='inspect') {
      const info=await inspectWav(file);send({type:'info',info});
      const peaks=await waveform(file,info,1600,value=>send({type:'progress',value}),()=>stopped);
      postMessage({type:'waveform',peaks},[peaks.buffer]);send({type:'done'});return;
    }
    const {info,algorithm,start,end,encoding,mode,wet=1}=data;
    let clipped=0;
    if(mode==='export') {
      const header=wavHeader({sampleRate:info.sampleRate,channels:info.channels,frames:end-start,encoding});
      const wait=acknowledge();postMessage({type:'bytes',bytes:header},[header.buffer]);await wait;
    }
    const metrics=await processWav({file,info,algorithm,start,end,modelFile:data.modelFile,attenuationLimit:data.attenuationLimit,wet:mode==='preview'||mode==='stream' ? 1 : wet,
      onStage:stage=>{phase=stage;send({type:'stage',stage,algorithm});},
      blockFrames:mode==='stream' ? 4 : 32,cancelled:()=>stopped,
      onProgress:value=>send({type:'progress',value}),
      onChunk:async(pcm,offset)=> {
        if(stopped) throw new Error('Cancelled');
        if(mode==='export') {const encoded=encodePCM(pcm,encoding);clipped+=encoded.clipped;const wait=acknowledge();postMessage({type:'bytes',bytes:encoded.bytes},[encoded.bytes.buffer]);await wait;}
        else if(mode==='preview') postMessage({type:'chunk',pcm,offset},pcm.map(c=>c.buffer));
        else if(mode==='stream') {
          const dry=await readFrames(file,info,start+offset,pcm[0].length);
          const wait=acknowledge();postMessage({type:'stream',pcm,dry,offset},[...pcm,...dry].map(c=>c.buffer));await wait;
        }
      }});
    if(mode==='export') {
      const bits=encoding==='pcm16' ? 16 : encoding==='pcm24' ? 24 : 32;
      if(((end-start)*info.channels*bits/8)&1) {const wait=acknowledge();send({type:'bytes',bytes:new Uint8Array(1)});await wait;}
    }
    send({type:'done',metrics,clipped});
  } catch(error) {send({type:'error',message:error.message,diagnostic:{algorithm:data.algorithm,adapter:data.algorithm==='deepfilternet3'?'official-rust-wasm':data.algorithm,stage:phase,message:error.message,stack:error.stack,modelVersion:data.algorithm==='deepfilternet3'?'DeepFilterNet3 epoch 120':undefined,libraryVersion:data.algorithm==='deepfilternet3'?'libDF 0.5.7-pre / Tract 0.21.4':undefined,wasmVersion:data.algorithm==='deepfilternet3'?'Rust 1.98.1 / wasm-bindgen 0.2.92':undefined,sampleRate:data.info?.sampleRate,channels:data.info?.channels,frames:data.info?.frames,resourceURL:data.algorithm==='deepfilternet3'?new URL('../../vendor/deepfilternet3/df_bg.wasm',import.meta.url).href:undefined}});}
  finally {busy=false;}
};
