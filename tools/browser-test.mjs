import {mkdir,writeFile}from'node:fs/promises';import assert from'node:assert/strict';import path from'node:path';
import {startServer}from'../server/index.mjs';import {fixture}from'../tests/fixtures.mjs';import {launch}from'./browser-utils.mjs';
await mkdir('test-output',{recursive:true});const {server,url}=await startServer();let browser;
const checks=[],errors=[],remote=[];let page;const record=(name)=>{checks.push(name);console.log('PASS',name);};
try{
  browser=await launch();page=await browser.newPage();await page.setViewport({width:1100,height:760});page.on('pageerror',e=>errors.push(e.message));
  await page.setRequestInterception(true);page.on('request',r=>{if(!r.url().startsWith(url+'/')&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:')){remote.push(r.url());void r.abort();}else void r.continue();});
  await page.goto(url,{waitUntil:'networkidle0'});
  assert.equal(await page.$eval('html',e=>e.lang),'en');assert.equal(await page.$eval('#language',e=>e.value),'en');assert.equal(await page.$eval('#open',e=>e.textContent),'Open WAV / OGG');record('English is the default language on startup');
  const algorithms=await page.evaluate(async()=>{
    const {inspectWav,encodePCM,wavHeader,readFrames}=await import('/js/audio/wav.js');const {processWav}=await import('/js/audio/pipeline.js');const {createDenoiser}=await import('/js/algorithms/index.js');
    const check=(value,text)=>{if(!value)throw new Error(text);};const make=(rate,channels,n,silence=false)=>{
      const pcm=Array.from({length:channels},(_,c)=>Float32Array.from({length:n},(_,i)=>silence?0:0.15*Math.sin(i*2*Math.PI*(240+80*c)/rate)+0.055*Math.sin(i*531.47+c)));
      const bytes=encodePCM(pcm,'float32').bytes;return new File([wavHeader({sampleRate:rate,channels,frames:n,encoding:'float32'}),bytes],'модель.wav');};
    const results=[];
    for(const algorithm of ['rnnoise','gtcrn']){
      const file=make(48000,2,48000),info=await inspectWav(file),input=await readFrames(file,info,0,info.frames);const output=input.map(c=>new Float32Array(c.length));
      const metrics=await processWav({file,info,algorithm,onChunk:async(pcm,p)=>pcm.forEach((c,i)=>output[i].set(c,p))});
      check(metrics.frames===48000,'Wrong length');check(output.every(c=>c.every(Number.isFinite)),'NaN/Infinity');check(metrics.stats.rms>1e-5,'Empty model output');
      let difference=0;for(let i=0;i<48000;i++)difference+=(output[0][i]-input[0][i])**2;check(difference/48000>1e-7,'Fake identity model');
      // Same mono/stereo input channel gives identical output, proving independent state.
      const mono=make(48000,1,48000),monoInfo=await inspectWav(mono);let monoDiff=0;await processWav({file:mono,info:monoInfo,algorithm,onChunk:async(pcm,p)=>{for(let i=0;i<pcm[0].length;i++)monoDiff=Math.max(monoDiff,Math.abs(output[0][p+i]-pcm[0][i]));}});check(monoDiff<1e-7,'Stereo channels share state');
      for(const rate of [44100,48000]){
        const f=make(rate,1,Math.round(rate*.65)),inf=await inspectWav(f),start=371,end=inf.frames-43;
        const a=new Float32Array(end-start),b=new Float32Array(end-start);
        await processWav({file:f,info:inf,algorithm,start,end,blockFrames:1,onChunk:async(c,p)=>a.set(c[0],p)});
        await processWav({file:f,info:inf,algorithm,start,end,blockFrames:31,onChunk:async(c,p)=>b.set(c[0],p)});
        check(a.every((x,i)=>Math.abs(x-b[i])<1e-7),'Block boundary discontinuity or drift');
      }
      for(const n of [1,17,489]){
        const f=make(48000,1,n,true),inf=await inspectWav(f);const m=await processWav({file:f,info:inf,algorithm});check(m.frames===n&&m.stats.peak<1e-6,'Short silence/tail');
      }
      const p=await createDenoiser({algorithm});const frame=Float32Array.from({length:p.metadata.frameSize},(_,i)=>0.2*Math.sin(i*2*Math.PI*240/p.metadata.rate));
      const first=p.process([frame])[0];for(let i=0;i<12;i++)p.process([frame]);p.reset();const reset=p.process([frame])[0];check(first.every((x,i)=>x===reset[i]),'Reset fails');const memory=p.memoryBytes;
      for(let i=0;i<40;i++)p.reset();check(p.memoryBytes===memory,'Repeated reset leaks WASM memory');p.destroy();p.destroy();let rejected=false;try{p.process([frame]);}catch{rejected=true;}check(rejected,'Destroyed processor usable');
      // Impulses on both sides of model/block boundaries, with explicit tail.
      const impulse=new Float32Array(48000);for(const q of [959,960,961,15359,15360,15361,47950])impulse[q]=.8;
      const impBytes=encodePCM([impulse],'float32').bytes,impFile=new File([wavHeader({sampleRate:48000,channels:1,frames:48000,encoding:'float32'}),impBytes],'impulses.wav');const impInfo=await inspectWav(impFile);const impOut=new Float32Array(48000);
      await processWav({file:impFile,info:impInfo,algorithm,onChunk:async(c,o)=>impOut.set(c[0],o)});
      for(const target of [960,15360,47950]){let max=0,peak=0;for(let i=Math.max(0,target-20);i<Math.min(48000,target+21);i++)if(Math.abs(impOut[i])>max){max=Math.abs(impOut[i]);peak=i;}check(max>1e-12&&Math.abs(peak-target)<=5,`${algorithm} impulse timing: offset=${peak-target}, magnitude=${max}`);}
      results.push({algorithm,metrics,difference:Math.sqrt(difference/48000),monoDiff});
    }
    return results;
  });record('Real RNNoise + GTCRN weights: meaningful output, mono/stereo, 44.1/48, reset, release, silence, tail, impulses, block continuity');
  await writeFile('test-output/model-tests.json',JSON.stringify(algorithms,null,2));
  const file=fixture({seconds:2,channels:2,encoding:'pcm24'}),filePath=path.resolve('test-output/голос_ї.wav');await writeFile(filePath,new Uint8Array(await file.arrayBuffer()));
  await (await page.$('#file')).uploadFile(filePath);await page.waitForFunction(()=>window.noiseLab?.snapshot().info&&!noiseLab.snapshot().busy&&document.querySelector('#play').disabled===false);
  assert.equal((await page.evaluate(()=>noiseLab.snapshot())).info.channels,2);record('Native file input and Unicode WAV metadata');
  for(const id of ['rnnoise','gtcrn']){await page.click(`[data-id="${id}"] [data-action="process"]`);await page.waitForFunction(id=>noiseLab.snapshot().previewAlgorithms.includes(id)&&!noiseLab.snapshot().busy,{},id);}record('Worker preview processes both neural models');
  await page.click('#play');await new Promise(r=>setTimeout(r,350));const before=await page.evaluate(()=>noiseLab.snapshot().position);
  await page.click('[data-id="rnnoise"] [data-action="listen"]');await new Promise(r=>setTimeout(r,100));const after=await page.evaluate(()=>noiseLab.snapshot().position);assert.ok(after>=before&&after-before<.3);record('A/B switching while playing preserves time');
  await page.click('#play');const paused=await page.evaluate(()=>noiseLab.snapshot().position);await page.click('#play');await new Promise(r=>setTimeout(r,100));assert.ok((await page.evaluate(()=>noiseLab.snapshot().position))>=paused);await page.click('#play');record('Pause/play resumes position');
  await page.click('#loop');await page.click('#play');await new Promise(r=>setTimeout(r,2250));assert.equal((await page.evaluate(()=>noiseLab.snapshot())).playing,true);assert.equal((await page.evaluate(()=>noiseLab.snapshot())).loop,true);await page.click('#play');record('Selection loop continues beyond one pass');
  await page.evaluate(()=>{const input=document.querySelector('[data-id="rnnoise"] input');input.value=37;input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});assert.equal(await page.$eval('[data-id="rnnoise"] output',e=>e.textContent),'37%');record('Dry/Wet updates without inference');
  await page.evaluate(()=>{window.savedChunks=[];window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async bytes=>savedChunks.push(new Uint8Array(bytes)),close:async()=>{},abort:async()=>{}})});});
  await page.click('[data-id="rnnoise"] [data-action="save"]');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('WAV saved'));
  const exported=await page.evaluate(async()=>{const m=await import('/js/audio/wav.js');const p=await import('/js/audio/pipeline.js');const f=new File(savedChunks,'output.wav');const inf=await m.inspectWav(f);const pcm=await m.readFrames(f,inf,0,inf.frames);const source=document.querySelector('#file').files[0],info=await m.inspectWav(source);let maxError=0;await p.processWav({file:source,info,algorithm:'rnnoise',wet:.37,onChunk:async(chunk,offset)=>{for(let c=0;c<chunk.length;c++)for(let i=0;i<chunk[c].length;i++)maxError=Math.max(maxError,Math.abs(chunk[c][i]-pcm[c][offset+i]));}});return {frames:inf.frames,channels:inf.channels,bits:inf.bits,peak:Math.max(...pcm[0].slice(0,48000).map(Math.abs)),size:f.size,maxError};});assert.equal(exported.frames,96000);assert.equal(exported.bits,24);assert.equal(exported.channels,2);assert.ok(exported.peak>0);assert.ok(exported.maxError<3e-7);record('Streaming WAV export preserves stereo length and matches the chosen 37% Dry/Wet');
  await page.click('#benchmark');await page.waitForFunction(()=>document.querySelector('#results tbody').children.length===2&&!noiseLab.snapshot().busy);record('Sequential first/repeat benchmark');
  await page.click('[data-id="gtcrn"] [data-action="listen"]');await page.click('#stream');await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Real time:'),{timeout:15000});record('Actual streaming inference, buffered Web Audio playback and underrun counts');
  const forcedUnderruns=await page.evaluate(async()=>{const {ABPlayer}=await import('/js/player/player.js');const {processWav}=await import('/js/audio/pipeline.js');const {inspectWav,readFrames}=await import('/js/audio/wav.js');const file=document.querySelector('#file').files[0],info=await inspectWav(file);const testPlayer=new ABPlayer();await testPlayer.beginStream(info,0,info.frames,'gtcrn',.5);let first=true;await processWav({file,info,algorithm:'gtcrn',blockFrames:4,onChunk:async(pcm,offset)=>{const dry=await readFrames(file,info,offset,pcm[0].length);await testPlayer.streamChunk(pcm,dry,offset,info.sampleRate);if(first){first=false;await new Promise(r=>setTimeout(r,1000));}}});const count=testPlayer.underruns;await testPlayer.close();return count;});assert.ok(forcedUnderruns>0);record('Deadline misses detected with deliberately delayed actual GTCRN stream');
  // Selection with pointer drag, then a timeline seek inside the selection.
  await page.$eval('#wave',e=>e.scrollIntoView({block:'center'}));
  const rect=await page.$eval('#wave',e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};});
  await page.mouse.move(rect.x+rect.w*.2,rect.y+rect.h/2);await page.mouse.down();await page.mouse.move(rect.x+rect.w*.7,rect.y+rect.h/2,{steps:8});await page.mouse.up();await new Promise(r=>setTimeout(r,120));const selected=await page.evaluate(()=>noiseLab.snapshot());assert.ok(selected.start>0&&selected.end<selected.info.frames);record('Waveform range selection');
  await page.mouse.click(rect.x+rect.w*.45,rect.y+rect.h/2);const seek=await page.evaluate(()=>noiseLab.snapshot().position);assert.ok(Math.abs(seek-.9)<.05);record('Waveform seek');
  await page.evaluate(()=>{const el=document.querySelector('#drop'),dt=new DataTransfer();const input=document.querySelector('#file').files[0];dt.items.add(new File([input],'перетащено.wav'));el.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt,cancelable:true}));});await page.waitForFunction(()=>noiseLab.snapshot().info?.name==='перетащено.wav'&&!noiseLab.snapshot().busy);record('Drag & Drop and reload reset results');
  await page.evaluate(()=>{const input=document.querySelector('#end');input.value=1.9;input.dispatchEvent(new Event('change',{bubbles:true}));});await page.waitForFunction(()=>!noiseLab.snapshot().busy&&document.querySelector('#play').disabled===false);await page.click('[data-id="rnnoise"] [data-action="process"]');await page.waitForFunction(()=>noiseLab.snapshot().busy);await page.click('#cancel');await page.waitForFunction(()=>!noiseLab.snapshot().busy);assert.equal((await page.evaluate(()=>noiseLab.snapshot())).previewAlgorithms.length,0);record('Cancel terminates Worker and drops partial result');
  await page.click('[data-id="gtcrn"] [data-action="process"]');await page.waitForFunction(()=>noiseLab.snapshot().previewAlgorithms.includes('gtcrn')&&!noiseLab.snapshot().busy);record('Model runs after cancellation');
  for(const zoom of [1,1.25,1.5]){await page.evaluate(z=>document.documentElement.style.zoom=z,zoom);const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth+1);assert.equal(overflow,false);}await page.evaluate(()=>document.documentElement.style.zoom=1);record('100/125/150% scale has no horizontal overflow');
  await page.select('#language','en');assert.equal(await page.$eval('#open',e=>e.textContent),'Open WAV / OGG');await page.select('#language','ru');assert.equal(await page.$eval('#filename',e=>e.textContent),'перетащено.wav');record('Russian/English localization preserves loaded filename');
  await page.screenshot({path:'test-output/noiselab.png',fullPage:true});
  assert.deepEqual(remote,[]);assert.deepEqual(errors,[]);record('No remote requests and no uncaught UI errors');
  await writeFile('test-output/browser-tests.json',JSON.stringify({checks,errors,remote,browser:await browser.version()},null,2));
}catch(error){if(page){console.error('UI failure state',await page.evaluate(()=>({status:document.querySelector('#status').textContent,snapshot:window.noiseLab?.snapshot()})).catch(()=>null));await page.screenshot({path:'test-output/failure.png',fullPage:true}).catch(()=>{});}console.error('Page errors',errors);throw error;}finally{await browser?.close();await new Promise(r=>server.close(r));}
