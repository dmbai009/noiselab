import{mkdir,writeFile}from'node:fs/promises';import path from'node:path';import assert from'node:assert/strict';
import{startServer}from'../server/index.mjs';import{launch}from'./browser-utils.mjs';import{oggFixtures}from'./ogg-fixtures.mjs';
const files=await oggFixtures();const{server,url}=await startServer();let browser;const results=[];
try{browser=await launch();const page=await browser.newPage();const errors=[],remote=[];page.on('pageerror',e=>errors.push(e.message));await page.setRequestInterception(true);page.on('request',r=>{if(!r.url().startsWith(url+'/')&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:')){remote.push(r.url());void r.abort();}else void r.continue();});await page.goto(url);
if(process.env.NOISELAB_DF_MODEL){await(await page.$('#deepfilter-model')).uploadFile(path.resolve(process.env.NOISELAB_DF_MODEL));await page.waitForFunction(()=>noiseLab.snapshot().modelReady&&!noiseLab.snapshot().busy);}
for(const f of files){
 await(await page.$('#file')).uploadFile(f.output);await page.waitForFunction(name=>noiseLab.snapshot().info?.name===name&&!noiseLab.snapshot().busy,{timeout:20000},path.basename(f.output));
 const snapshot=await page.evaluate(()=>noiseLab.snapshot());assert.equal(snapshot.info.codec,f.codec);assert.equal(snapshot.info.channels,f.channels);assert.ok(Math.abs(snapshot.info.duration-2.123)<.02);
 for(const algorithm of['rnnoise','gtcrn',...(process.env.NOISELAB_DF_MODEL?['deepfilternet3']:[])]){await page.click(`[data-id="${algorithm}"] [data-action="process"]`);await page.waitForFunction(id=>noiseLab.snapshot().previewAlgorithms.includes(id)&&noiseLab.snapshot().active===id&&!noiseLab.snapshot().busy,{timeout:15000},algorithm);}
 await page.click('#play');await new Promise(r=>setTimeout(r,100));assert.equal((await page.evaluate(()=>noiseLab.snapshot())).playing,true);await page.click('#play');
 await page.evaluate(()=>{window.savedChunks=[];window.showSaveFilePicker=async()=>({createWritable:async()=>({write:async bytes=>savedChunks.push(new Uint8Array(bytes)),close:async()=>{},abort:async()=>{}})});});
 await page.click('[data-id="gtcrn"] [data-action="save"]');await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('WAV saved'));
 const exported=await page.evaluate(async()=>{const{inspectWav}=await import('/js/audio/wav.js');return inspectWav(new File(savedChunks,'out.wav'));});assert.equal(exported.frames,snapshot.info.frames);assert.equal(exported.channels,f.channels);
 const preserved=await page.evaluate(async()=>{const before=noiseLab.snapshot();try{await noiseLab.loadFile(new File([new Uint8Array(200)],'video.webm'));}catch{}return{before,after:noiseLab.snapshot()};});assert.equal(preserved.after.info.name,preserved.before.info.name);assert.deepEqual(preserved.after.previewAlgorithms,preserved.before.previewAlgorithms);
 // Unsupported encodings inside recognized containers must also preserve playing wet audio.
 await page.click('#play');
 const rejected=await page.evaluate(async()=>{
   const {wavHeader}=await import('/js/audio/wav.js');const header=wavHeader({sampleRate:48000,channels:1,frames:10,encoding:'pcm16'});new DataView(header.buffer).setUint16(20,6,true);
   const ogg=new Uint8Array(60);ogg.set(new TextEncoder().encode('OggS'));ogg[26]=1;ogg[27]=32;ogg.set(new TextEncoder().encode('theora'),28);
   const before=noiseLab.snapshot(),messages=[];
   for(const file of [new File([new Uint8Array(100)],'audio.mp3'),new File([header,new Uint8Array(20)],'compressed.wav'),new File([ogg],'video.ogg')]){
     try{await noiseLab.loadFile(file);messages.push('unexpected success');}catch(error){messages.push(error.message);}
     const after=noiseLab.snapshot();if(after.info.name!==before.info.name||!after.playing||after.active!==before.active||after.previewAlgorithms.join()!==before.previewAlgorithms.join())throw new Error('Rejected file disrupted processed audio');
   }
   return messages;
 });assert.equal(rejected.length,3);assert.ok(rejected.every(message=>message!=='unexpected success'));assert.ok(rejected.slice(1).every(message=>message.includes('Текущая запись сохранена')));await page.click('#play');
 results.push({codec:f.codec,channels:f.channels,frames:snapshot.info.frames,exportFrames:exported.frames});console.log('PASS OGG',f.codec,f.channels,'decode / both neural models / playback / WAV export / reject WebM without data loss');
}
assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);await writeFile('test-output/ogg-browser.json',JSON.stringify({results,errors,remote},null,2));
}catch(error){const pages=await browser?.pages();if(pages?.length)console.error(await pages.at(-1).evaluate(()=>({status:document.querySelector('#status')?.textContent,snapshot:window.noiseLab?.snapshot()})).catch(()=>null));throw error;}finally{await browser?.close();await new Promise(r=>server.close(r));}
