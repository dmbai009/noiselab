import {mkdir,writeFile}from'node:fs/promises';import os from'node:os';import path from'node:path';
import {startServer}from'../server/index.mjs';import {launch}from'./browser-utils.mjs';
await mkdir('test-output',{recursive:true});const {server,url}=await startServer();let browser;
const report={date:new Date().toISOString(),hardware:{cpu:os.cpus()[0].model,logicalCores:os.cpus().length,ramGiB:os.totalmem()/1024**3,platform:os.platform(),arch:os.arch()},node:process.version,input:'Official DeepFilterNet assets/noisy_snr0.wav (10.596 s), repeated to 1/5/20 min. Repeated speech is not a unique long recording.',results:[],estimates:[],limitations:'No GPU. Wall timings include resampling, stats and PCM24 encoding, but not disk flush. Subjective speech quality and user-owned 1/5/20 minute recordings were not evaluated.'};
try{
  browser=await launch();report.browser=await browser.version();const page=await browser.newPage();await page.goto(url);await (await page.$('#file')).uploadFile(path.resolve('research/reference-speech.wav'));
  await page.waitForFunction(()=>noiseLab.snapshot().info&&!noiseLab.snapshot().busy);
  for(const seconds of [60,300,1200])for(const algorithm of ['rnnoise','gtcrn']){
    const result=await page.evaluate(async({seconds,algorithm})=>{
      const {inspectWav,wavHeader,encodePCM}=await import('/js/audio/wav.js');const {processWav}=await import('/js/audio/pipeline.js');
      const source=document.querySelector('#file').files[0],inf=await inspectWav(source),body=source.slice(inf.dataOffset,inf.dataOffset+inf.dataBytes);
      const frames=seconds*inf.sampleRate,parts=[wavHeader({sampleRate:inf.sampleRate,channels:inf.channels,frames,encoding:'pcm16'})];let remaining=frames;
      while(remaining){const n=Math.min(remaining,inf.frames);parts.push(n===inf.frames?body:body.slice(0,n*inf.blockAlign));remaining-=n;}
      const file=new File(parts,'repeated-reference.wav'),info=await inspectWav(file);let encodeMs=0,clipped=0,encodedBytes=0;
      const metrics=await processWav({file,info,algorithm,onChunk:async pcm=>{const t=performance.now();const out=encodePCM(pcm,'pcm24');encodeMs+=performance.now()-t;clipped+=out.clipped;encodedBytes+=out.bytes.length;}});
      return {seconds,algorithm,...metrics,encodeMs,clipped,encodedBytes,jsHeap:performance.memory?.usedJSHeapSize??null};
    },{seconds,algorithm});
    report.results.push(result);await writeFile('test-output/benchmark.json',JSON.stringify(report,null,2));
    console.log(`${algorithm} ${seconds}s: compute ${(result.computeMs/1000).toFixed(2)}s, total ${(result.totalMs/1000).toFixed(2)}s, RTF ${result.rtf.toFixed(4)}, WASM ${(result.memoryBytes/1024/1024).toFixed(1)}MiB`);
  }
  for(const algorithm of ['rnnoise','gtcrn']){
    const b=report.results.find(r=>r.algorithm===algorithm&&r.seconds===1200);
    report.estimates.push({algorithm,twentyMinutesComputeSeconds:b.computeMs/1000,hundredFiveSecondUtterancesComputeSeconds:b.computeMs/1200/1000*500,warning:'Linear estimates from warm continuous processing; short independent clips add state init and 250 ms context per clip.'});
  }
  await writeFile('test-output/benchmark.json',JSON.stringify(report,null,2));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
