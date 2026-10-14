import { createDenoiser, algorithms } from '../algorithms/index.js';
import { SincKernel, readResampled, OutputResampler } from './resample.js';
import { readFrames, createStats } from './wav.js';
export const yieldTask = () => new Promise(resolve=>setTimeout(resolve,0));

export async function processWav({file, info, algorithm, start=0, end=info.frames, wet=1, blockFrames=32,
  modelFile,attenuationLimit=100,onStage=()=>{},onChunk=async()=>{}, onProgress=()=>{}, cancelled=()=>false}) {
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end>info.frames||end<=start||!Number.isFinite(wet)||wet<0||wet>1||!Number.isInteger(blockFrames)||blockFrames<1||blockFrames>128) throw new Error('Invalid processing range or settings');
  if(algorithm!=='original'&&!algorithms.some(a=>a.id===algorithm&&a.available))throw new Error('Unknown or unavailable algorithm');
  const wallStart=performance.now(), stats=createStats(), dryStats=createStats();
  let processor, computeMs=0, outputOffset=0, maxBufferedSamples=0;
  const emit=async pcm=> {
    const length=pcm[0].length; // Transferable buffers may be detached by onChunk.
    if(!length) return;
    const dry=await readFrames(file,info,start+outputOffset,length); dryStats.add(dry);
    if(wet!==1) for(let c=0;c<pcm.length;c++) for(let i=0;i<pcm[c].length;i++) pcm[c][i]=wet===0 ? dry[c][i] : (1-wet)*dry[c][i]+wet*pcm[c][i];
    stats.add(pcm); await onChunk(pcm,outputOffset); outputOffset+=length;
    onProgress(outputOffset/(end-start));
  };
  try {
    if(algorithm==='original' || wet===0) {
      for(let p=start;p<end;p+=Math.min(info.sampleRate,end-p)) {
        if(cancelled()) throw new Error('Cancelled');
        await emit(await readFrames(file,info,p,Math.min(info.sampleRate,end-p))); await yieldTask();
      }
      return {algorithm, initMs:0, computeMs:0, totalMs:performance.now()-wallStart, duration:(end-start)/info.sampleRate, frames:outputOffset, stats:stats.value,dryStats:dryStats.value,rtf:0,speed:null,cached:false,memoryBytes:0,maxBufferedSamples:info.sampleRate*info.channels};
    }
    processor=await createDenoiser({algorithm,channels:info.channels,modelFile,attenuationLimit,onStage});
    const {rate,frameSize,delay}=processor.metadata;
    const prefixStart=Math.max(0,start-Math.floor(info.sampleRate*0.25));
    const sourceCount=end-prefixStart, nativeCount=Math.ceil(sourceCount*rate/info.sampleRate);
    const kernel=new SincKernel(info.sampleRate,rate);
    const resampler=new OutputResampler(rate,info.sampleRate,info.channels,end-start,(start-prefixStart)*rate/info.sampleRate);
    const framesToRun=Math.ceil((nativeCount+delay+64)/frameSize), chunkSize=frameSize*blockFrames;
    let discard=delay;
    for(let p=0;p<framesToRun*frameSize;p+=chunkSize) {
      if(cancelled()) throw new Error('Cancelled');
      const count=Math.min(chunkSize,framesToRun*frameSize-p);
      const input=await readResampled(file,info,prefixStart,end,p,count,rate,kernel);
      const output=Array.from({length:info.channels},()=>new Float32Array(count));
      const tick=performance.now();
      for(let q=0;q<count;q+=frameSize) {
        const result=processor.process(input.map(c=>c.subarray(q,q+frameSize)));
        result.forEach((c,i)=>output[i].set(c,q));
      }
      computeMs+=performance.now()-tick;
      const drop=Math.min(discard,count); discard-=drop;
      resampler.append(output.map(c=>c.subarray(drop)));
      maxBufferedSamples=Math.max(maxBufferedSamples,(resampler.buffers[0].length+2*count)*info.channels);
      await emit(resampler.pull()); await yieldTask();
    }
    await emit(resampler.pull(true));
    if(outputOffset!==end-start) throw new Error('Output sample count mismatch');
    const duration=(end-start)/info.sampleRate;
    return {...processor.metadata,algorithm,computeMs,totalMs:performance.now()-wallStart,duration,frames:outputOffset,
      rtf:computeMs/1000/duration,speed:duration*1000/Math.max(computeMs,0.001),memoryBytes:processor.memoryBytes,
      maxBufferedSamples,stats:stats.value,dryStats:dryStats.value};
  } finally { processor?.destroy(); }
}
