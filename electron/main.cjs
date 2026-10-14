const {app,BrowserWindow,ipcMain,dialog,session,crashReporter}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {createDiagnostics}=require('./diagnostics.cjs');
const stabilityTest=process.argv.includes('--stability-test');
const recoveryTest=process.argv.includes('--recovery-test');
const deepFilterTest=process.argv.includes('--deepfilter-test');
const testMode=process.argv.some(a=>/^--(smoke|close|stability|recovery|deepfilter)-test$/.test(a));
if(testMode){const profile=path.join(app.getPath('temp'),'noiselab-tests',randomUUID());require('node:fs').mkdirSync(profile,{recursive:true});app.setPath('userData',profile);}
// Audio inference is CPU-only; software painting avoids a GPU-driver dependency for the small UI.
app.disableHardwareAcceleration();
const diagnostic={...createDiagnostics(path.join(app.getPath('userData'),'logs'))};
const log=diagnostic.log;
log('startup',{version:app.getVersion(),electron:process.versions.electron,test:testMode,softwareRendering:true});
app.on('child-process-gone',(_event,details)=>log('child-process-gone',details));
app.on('render-process-gone',(_event,_contents,details)=>log('render-process-gone',details));
app.on('will-quit',()=>log('will-quit'));
process.on('uncaughtExceptionMonitor',error=>log('main-exception',{message:error.message,stack:error.stack}));
process.on('unhandledRejection',error=>log('unhandled-rejection',{message:String(error?.message||error),stack:error?.stack}));
let window,server,origin,quitting=false;
let closingWindow=false,recoveries=[];
const saves=new Map();
const protectedSources=new Set();
async function canonical(filePath){try{return (await fs.realpath(filePath)).toLowerCase();}catch(e){if(e.code!=='ENOENT')throw e;return path.resolve(filePath).toLowerCase();}}
const smoke=process.argv.includes('--smoke-test');
const closeTest=process.argv.includes('--close-test');let closeDir;
if(!testMode){
  if(!app.requestSingleInstanceLock()){app.exit(0);return;}
  app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.show();window.focus();}});
}
// Native dumps stay on this computer; no submit URL and no upload or telemetry.
const crashDirectory=path.join(app.getPath('userData'),'logs','crashes');
require('node:fs').mkdirSync(crashDirectory,{recursive:true});app.setPath('crashDumps',crashDirectory);
crashReporter.start({productName:'NoiseLab',uploadToServer:false});
function authorize(event) {if(!window || event.sender!==window.webContents || event.senderFrame?.url!==origin+'/') throw new Error('Unauthorized sender');}
async function abort(token) {const item=saves.get(token); if(!item) return; saves.delete(token); await item.handle.close().catch(()=>{}); await fs.unlink(item.temp).catch(()=>{});}
function registerIPC() {
  const modelBookmark=path.join(app.getPath('userData'),'deepfilter-model.json');
  const readModel=async filePath=>{
    if(typeof filePath!=='string'||filePath.length>32768||!/\.tar\.gz$/i.test(filePath))throw new Error('Invalid model path');
    const handle=await fs.open(filePath,'r');let bytes,stat;
    try{stat=await handle.stat();if(!stat.isFile()||stat.size!==7983136)throw new Error('Unexpected model size');const bounded=Buffer.alloc(7983137);let offset=0;while(offset<bounded.length){const {bytesRead}=await handle.read(bounded,offset,bounded.length-offset,offset);if(!bytesRead)break;offset+=bytesRead;}bytes=bounded.subarray(0,offset);}finally{await handle.close();}
    if(bytes.length!==7983136||createHash('sha256').update(bytes).digest('hex')!=='c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616')throw new Error('Unexpected DeepFilterNet3 model hash');
    return{bytes:new Uint8Array(bytes),name:path.basename(filePath),lastModified:stat.mtimeMs};
  };
  ipcMain.handle('model:remember',async(e,filePath)=>{authorize(e);if(!filePath)return false;await readModel(filePath);await fs.writeFile(modelBookmark,JSON.stringify({path:filePath}),{encoding:'utf8',mode:0o600});log('deepfilter-model-selected',{name:path.basename(filePath)});return true;});
  ipcMain.handle('model:load',async e=>{authorize(e);try{const stat=await fs.stat(modelBookmark);if(stat.size>65536)throw new Error('Invalid model bookmark');const saved=JSON.parse(await fs.readFile(modelBookmark,'utf8'));return await readModel(saved.path);}catch(error){if(error.code!=='ENOENT')log('deepfilter-model-unavailable',{message:error.message});return null;}});
  ipcMain.handle('diagnostic:renderer',async(e,details)=>{authorize(e);if(!details||typeof details!=='object')throw new Error('Invalid diagnostic');const clean={};for(const field of ['algorithm','adapter','stage','message','stack','modelVersion','libraryVersion','wasmVersion','resourceURL'])if(typeof details[field]==='string')clean[field]=details[field].slice(0,field==='stack'?16384:2048);for(const field of ['sampleRate','channels','frames'])if(Number.isSafeInteger(details[field]))clean[field]=details[field];log('renderer-algorithm-error',clean);});
  ipcMain.handle('source:protect',async(e,filePath)=>{authorize(e);if(typeof filePath!=='string'||filePath.length>32768)throw new Error('Invalid source');if(filePath)protectedSources.add(await canonical(filePath));});
  ipcMain.handle('versions',e=>{authorize(e); return {electron:process.versions.electron,node:process.versions.node,chrome:process.versions.chrome};});
  ipcMain.handle('memory',async e=>{authorize(e); const m=await process.getProcessMemoryInfo(); return {mainPrivateKiB:m.private, mainResidentKiB:m.residentSet ?? null};});
  ipcMain.handle('save:begin',async(e,req)=> {
    authorize(e);
    if(saves.size || !req || typeof req.name!=='string' || req.name.length>180 || !/^[^<>:"/\\|?*\x00-\x1f]+\.(wav|ogg)$/i.test(req.name) || !Number.isSafeInteger(req.bytes) || req.bytes<44 || req.bytes>0x100000010) throw new Error('Invalid save request');
    const extension=/\.ogg$/i.test(req.name)?'ogg':'wav';
    const {canceled,filePath}=await dialog.showSaveDialog(window,{defaultPath:req.name,filters:[{name:extension.toUpperCase()+' audio',extensions:[extension]}],properties:['showOverwriteConfirmation']});
    if(canceled || !filePath) return null;
    if(protectedSources.has(await canonical(filePath)))throw new Error('Choose another destination: the source WAV is protected');
    let existing=null;
    try {const s=await fs.stat(filePath); existing={size:s.size,mtimeMs:s.mtimeMs};} catch(e) {if(e.code!=='ENOENT') throw e;}
    if(existing) {const answer=await dialog.showMessageBox(window,{type:'question',buttons:['Cancel','Replace'],defaultId:0,cancelId:0,message:'Replace the existing audio file?',detail:path.basename(filePath)}); if(answer.response!==1) return null;}
    const token=randomUUID(),temp=path.join(path.dirname(filePath),`.noiselab-${token}.tmp`);
    const handle=await fs.open(temp,'wx'); saves.set(token,{handle,temp,dest:filePath,bytes:req.bytes,written:0,existing}); return token;
  });
  ipcMain.handle('save:write',async(e,{token,bytes}={})=> {
    authorize(e); const s=saves.get(token);
    if(!s || !(bytes instanceof Uint8Array) || bytes.byteLength>2*1024*1024 || s.written+bytes.byteLength>s.bytes) throw new Error('Invalid export chunk');
    let offset=0; while(offset<bytes.length) {const {bytesWritten}=await s.handle.write(bytes,offset,bytes.length-offset,null); if(!bytesWritten) throw new Error('Write failed'); offset+=bytesWritten;}
    s.written+=bytes.length; return s.written;
  });
  ipcMain.handle('save:finish',async(e,token)=> {
    authorize(e); const s=saves.get(token); if(!s || s.written!==s.bytes) throw new Error('Incomplete export');
    try {
      let current=null; try {const stat=await fs.stat(s.dest);current={size:stat.size,mtimeMs:stat.mtimeMs};} catch(err) {if(err.code!=='ENOENT') throw err;}
      if(JSON.stringify(current)!==JSON.stringify(s.existing)) throw new Error('Destination changed while exporting; retry Save As');
      if(protectedSources.has(await canonical(s.dest)))throw new Error('Source WAV cannot be overwritten');
      await s.handle.sync(); await s.handle.close(); await fs.rename(s.temp,s.dest); saves.delete(token); return path.basename(s.dest);
    } catch(err) {await abort(token);throw err;}
  });
  ipcMain.handle('save:abort',async(e,token)=>{authorize(e);await abort(token);});
}
app.whenReady().then(async()=> {
  // Only this application's browser filesystem contains disposable decoded PCM.
  await session.defaultSession.clearStorageData({storages:['filesystem']});
  const local=await import('../server/index.mjs'); const host=await local.startServer(); server=host.server; origin=host.url;
  session.defaultSession.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));
  session.defaultSession.setPermissionCheckHandler(()=>false);
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>callback({cancel:!(details.url.startsWith(origin+'/') || details.url.startsWith('devtools:'))}));
  registerIPC();
  window=new BrowserWindow({width:1240,height:830,minWidth:850,minHeight:650,backgroundColor:'#11151d',show:!testMode,skipTaskbar:testMode,
    title:'NoiseLab',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',(e,url)=>{if(url!==origin+'/') e.preventDefault();});
  window.on('minimize',()=>log('window-minimized'));
  window.on('restore',()=>log('window-restored'));
  window.on('close',()=>{closingWindow=true;log('window-close');});
  window.on('closed',()=>{log('window-closed');window=null;});
  window.webContents.on('unresponsive',()=>log('renderer-unresponsive'));
  window.webContents.on('render-process-gone',(_event,details)=>{
    if(closingWindow||quitting||!window||details.reason==='clean-exit')return;
    const owner=window;recoveries=recoveries.filter(t=>Date.now()-t<60000);recoveries.push(Date.now());
    void Promise.all([...saves.keys()].map(abort)).then(async()=>{
      if(recoveries.length>2){await dialog.showMessageBox(owner,{type:'error',message:'The NoiseLab interface has crashed repeatedly.',detail:'Restart the application. Details are saved in the local log.',buttons:['OK']});return;}
      await new Promise(r=>setTimeout(r,250));if(closingWindow||owner.isDestroyed())return;
      await owner.loadURL(origin+'/');
      await owner.webContents.executeJavaScript(`document.querySelector('#status').textContent='The interface recovered after a crash. Open your audio file again.';document.querySelector('#status').classList.add('error');`);
      log('renderer-recovered',{reason:details.reason});
    }).catch(error=>log('recovery-error',{message:error.message}));
  });
  await window.loadURL(origin+'/');
  if(deepFilterTest){const result=await require('./deepfilter-test.cjs')(window);console.log('NOISELAB_DEEPFILTER='+JSON.stringify(result));window.close();return;}
  if(recoveryTest){
    const recovered=new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Renderer did not recover')),10000);window.webContents.once('did-finish-load',()=>{clearTimeout(timeout);resolve();});});
    window.webContents.forcefullyCrashRenderer();await recovered;await new Promise(r=>setTimeout(r,150));
    const healthy=await window.webContents.executeJavaScript(`!!noiseLab&&document.querySelector('#status').textContent.includes('recovered')`);
    if(!healthy)throw new Error('Renderer recovery UI is not usable');console.log('NOISELAB_RECOVERY='+JSON.stringify({recovered:true,uploadToServer:crashReporter.getUploadToServer()}));window.close();return;
  }
  if(stabilityTest){
    const duration=Number(process.env.NOISELAB_STABILITY_MS||120000);
    window.minimize();log('stability-start',{minimized:window.isMinimized(),duration});
    const started=Date.now();
    while(Date.now()-started<duration){await new Promise(r=>setTimeout(r,500));if(!window||window.isDestroyed())throw new Error('Window disappeared while minimized');}
    const rejected=await window.webContents.executeJavaScript(`(async()=>{try{await noiseLab.loadFile(new File([new Uint8Array([26,69,223,163,0,0,0,0])],'video.webm'));return false;}catch{return true;}})()`);
    const healthy=await window.webContents.executeJavaScript(`({alive:!!noiseLab,hasWav:!!noiseLab.snapshot().info,busy:noiseLab.snapshot().busy})`);
    if(!rejected||!healthy.alive||healthy.hasWav||healthy.busy)throw new Error('Unsupported file left app broken');
    console.log('NOISELAB_STABILITY='+JSON.stringify({minimized:window.isMinimized(),duration:Date.now()-started,webmRejected:rejected,healthy}));window.close();return;
  }
  if(closeTest){
    closeDir=await fs.mkdtemp(path.join(app.getPath('temp'),'noiselab-close-'));
    dialog.showSaveDialog=async()=>({canceled:false,filePath:path.join(closeDir,'closed.wav')});
    const busy=await window.webContents.executeJavaScript(`(async()=>{const m=await import('/js/audio/wav.js');const n=48000*30;const header=m.wavHeader({sampleRate:48000,channels:1,frames:n,encoding:'pcm16'});const pcm=m.encodePCM([Float32Array.from({length:n},(_,i)=>.2*Math.sin(i*.05))],'pcm16').bytes;await noiseLab.loadFile(new File([header,pcm],'close-test.wav'));const token=await desktop.beginSave({name:'closed.wav',bytes:header.length+pcm.length});await desktop.write(token,header);document.querySelector('[data-id="rnnoise"] [data-action="process"]').click();for(let i=0;i<400;i++){const progress=document.querySelector('#progress').value;if(noiseLab.snapshot().busy&&progress>0&&progress<1)return true;await new Promise(r=>setTimeout(r,5));}return false;})()`);
    if(!busy)throw new Error('Close test did not start Worker');window.close();return;
  }
  if(smoke) {
    try {const result=await window.webContents.executeJavaScript(`(async()=>{const m=await import('/js/audio/wav.js');const a=await import('/js/audio/pipeline.js');const channels=[Float32Array.from({length:48000},(_,i)=>0.15*Math.sin(i*2*Math.PI*220/48000)+(Math.sin(i*9137)*0.025))];const pcm=m.encodePCM(channels,'pcm16');const f=new File([m.wavHeader({sampleRate:48000,channels:1,frames:48000,encoding:'pcm16'}),pcm.bytes],'тест.wav');const info=await m.inspectWav(f);const results=[],playback=new Float32Array(48000);for(const algorithm of ['rnnoise','gtcrn']){results.push(await a.processWav({file:f,info,algorithm,onChunk:async(c,p)=>{if(algorithm==='rnnoise')playback.set(c[0],p);}}));}const context=new AudioContext({sampleRate:48000});await context.resume();const buffer=context.createBuffer(1,48000,48000);buffer.copyToChannel(playback,0);const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);source.start();await new Promise(r=>setTimeout(r,150));const state=context.state;await context.close();return {versions:await desktop.versions(),contextState:state,playedPeak:Math.max(...playback.map(Math.abs)),results,nodeIntegration:typeof require};})()`);
      if(result.contextState!=='running'||result.playedPeak<=0||result.nodeIntegration!=='undefined'||result.results.some(r=>r.frames!==48000||!Number.isFinite(r.stats.rms))) throw new Error('Electron smoke assertions failed');
      const smokeDir=await fs.mkdtemp(path.join(app.getPath('temp'),'noiselab-smoke-'));
      const outputPath=path.join(smokeDir,'голос_результат.wav');
      const oggOutput=path.join(smokeDir,'ogg-output.wav'),oggCopy=path.join(smokeDir,'copy.ogg');
      const originalSaveDialog=dialog.showSaveDialog;dialog.showSaveDialog=async()=>({canceled:false,filePath:outputPath});
      try{
        const saved=await window.webContents.executeJavaScript(`(async()=>{const m=await import('/js/audio/wav.js');const samples=[new Float32Array([.25,-.5,0])];const header=m.wavHeader({sampleRate:48000,channels:1,frames:3,encoding:'pcm24'});const pcm=m.encodePCM(samples,'pcm24').bytes;const token=await desktop.beginSave({name:'результат.wav',bytes:54});await desktop.write(token,header);await desktop.write(token,pcm);await desktop.write(token,new Uint8Array(1));return await desktop.finish(token);})()`);
        const data=await fs.readFile(outputPath);if(data.length!==54||data.toString('ascii',0,4)!=='RIFF'||saved!=='голос_результат.wav')throw new Error('IPC export integrity');
        window.webContents.debugger.attach('1.3');
        const dom=await window.webContents.debugger.sendCommand('DOM.getDocument');
        const input=await window.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#file'});
        await window.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[outputPath]});
        const loaded=await window.webContents.executeJavaScript(`(async()=>{for(let i=0;i<100;i++){const s=noiseLab.snapshot();if(s.info?.name==='голос_результат.wav'&&!s.busy)return s;await new Promise(r=>setTimeout(r,30));}throw new Error(document.querySelector('#status').textContent);})()`);
        window.webContents.debugger.detach();
        if(loaded.info.frames!==3 || !protectedSources.has(await canonical(outputPath)))throw new Error('Native file input or source protection failed');
        dialog.showSaveDialog=async()=>({canceled:false,filePath:path.join(smokeDir,'отмена.wav')});
        const token=await window.webContents.executeJavaScript(`desktop.beginSave({name:'отмена.wav',bytes:54})`);
        await window.webContents.executeJavaScript(`desktop.abort(${JSON.stringify(token)})`);
        const leftovers=(await fs.readdir(smokeDir)).filter(f=>f.endsWith('.tmp'));if(leftovers.length)throw new Error('Temp cleanup failed');
        dialog.showSaveDialog=async()=>({canceled:false,filePath:outputPath});
        let denied=false;try{await window.webContents.executeJavaScript(`desktop.beginSave({name:'защита.wav',bytes:54})`);}catch{denied=true;}if(!denied)throw new Error('Source protection failed');
        const unchanged=await fs.readFile(outputPath);if(!data.equals(unchanged))throw new Error('Source overwritten');
        result.exportTest={bytes:data.length,unicode:true,nativeFileInput:true,abortCleanup:true,sourceProtection:true};
        if(process.env.NOISELAB_OGG_FIXTURE){
          window.webContents.debugger.attach('1.3');const dom=await window.webContents.debugger.sendCommand('DOM.getDocument');
          const input=await window.webContents.debugger.sendCommand('DOM.querySelector',{nodeId:dom.root.nodeId,selector:'#file'});
          await window.webContents.debugger.sendCommand('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[process.env.NOISELAB_OGG_FIXTURE]});window.webContents.debugger.detach();
          const decoded=await window.webContents.executeJavaScript(`(async()=>{for(let i=0;i<1000;i++){const s=noiseLab.snapshot();if(s.info?.sourceFormat==='ogg'&&!s.busy)return s;await new Promise(r=>setTimeout(r,10));}throw new Error(document.querySelector('#status').textContent);})()`);
          await window.webContents.executeJavaScript(`(async()=>{document.querySelector('[data-id="rnnoise"] [data-action="process"]').click();for(let i=0;i<1000;i++){if(noiseLab.snapshot().previewAlgorithms.includes('rnnoise')&&!noiseLab.snapshot().busy)return;await new Promise(r=>setTimeout(r,10));}throw new Error(document.querySelector('#status').textContent);})()`);
          dialog.showSaveDialog=async()=>({canceled:false,filePath:oggOutput});
          await window.webContents.executeJavaScript(`(async()=>{document.querySelector('[data-id="rnnoise"] [data-action="save"]').click();for(let i=0;i<1000;i++){if(document.querySelector('#status').textContent.includes('WAV saved'))return;await new Promise(r=>setTimeout(r,10));}throw new Error(document.querySelector('#status').textContent);})()`);
          const exported=await fs.readFile(oggOutput),view=new DataView(exported.buffer,exported.byteOffset,exported.byteLength);
          if(view.getUint32(40,true)/view.getUint16(32,true)!==decoded.info.frames)throw new Error('OGG export sample count changed');
          dialog.showSaveDialog=async()=>({canceled:false,filePath:oggCopy});
          await window.webContents.executeJavaScript(`(async()=>{document.querySelector('[data-id="original"] [data-action="copy"]').click();for(let i=0;i<1000;i++){if(document.querySelector('#status').textContent.includes('OGG copy saved'))return;await new Promise(r=>setTimeout(r,10));}throw new Error(document.querySelector('#status').textContent);})()`);
          if(!(await fs.readFile(oggCopy)).equals(await fs.readFile(process.env.NOISELAB_OGG_FIXTURE)))throw new Error('Original OGG copy changed bytes');
          result.oggTest={codec:decoded.info.codec,channels:decoded.info.channels,frames:decoded.info.frames,localStorage:true,nativeExport:true,originalCopy:true};
        }
      }finally{dialog.showSaveDialog=originalSaveDialog;await fs.unlink(outputPath).catch(()=>{});await fs.unlink(oggOutput).catch(()=>{});await fs.unlink(oggCopy).catch(()=>{});await fs.rmdir(smokeDir).catch(()=>{});}
      console.log('NOISELAB_SMOKE='+JSON.stringify(result)); app.exit(0);
    } catch(error) {console.error(error);app.exit(1);}
  }
}).catch(error=>{log('startup-error',{message:error.message,stack:error.stack});console.error(error);app.exit(1);});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',e=>{
  if(!quitting && saves.size){e.preventDefault();quitting=true;Promise.all([...saves.keys()].map(abort)).then(async()=>{
    if(closeTest){const leftovers=await fs.readdir(closeDir);if(leftovers.length)throw new Error('Close left unfinished export');await fs.rmdir(closeDir);console.log('NOISELAB_CLOSE_TEST='+JSON.stringify({workerRunningAtClose:true,tempCleaned:true}));}
    app.quit();
  }).catch(error=>{console.error(error);app.exit(1);});} else server?.close();
});
