import {algorithms} from '../algorithms/index.js';
import {validateDeepFilterModel} from '../algorithms/deepfilternet3.js';
import {readFrames,wavHeader,inspectWav} from '../audio/wav.js';
import {audioContainer} from '../audio/file-validation.js';
import {removeOggTemp,inspectOgg} from '../audio/ogg.js';
import {integratedLoudness} from '../audio/loudness.js';
import {ABPlayer} from '../player/player.js';
import {Jobs} from './jobs.js';
import {t,setLanguage} from './i18n.js';
const $=id=>document.getElementById(id);
const state={file:null,sourceFile:null,decodedTemp:null,modelFile:null,modelLoading:false,attenuationLimit:100,info:null,peaks:null,start:0,end:0,viewStart:0,viewEnd:0,busy:false,loading:false,preparing:false,generation:0,dry:null,results:new Map(),strengths:new Map(algorithms.map(a=>[a.id,1])),active:'original',lastWet:'rnnoise',streamMetrics:null};
const temporaryAudio=new Set();
const isBusy=()=>!!jobs.pending||state.busy||state.loading||state.preparing||state.modelLoading||player.stream;
const player=new ABPlayer(()=>refresh()),jobs=new Jobs();
const time=s=>{s=Math.max(0,s);return `${String(Math.floor(s/60)).padStart(2,'0')}:${(s%60).toFixed(3).padStart(6,'0')}`;};
const ms=x=>`${x.toFixed(1)} ms`;
const message=(text,error=false)=>{$('status').textContent=text;$('status').classList.toggle('error',error);};
const showError=e=>{if(e.message==='Cancelled')return;if(e.diagnostic&&window.desktop)void desktop.diagnostic(e.diagnostic).catch(()=>{});message(e.diagnostic?.algorithm==='deepfilternet3'&&e.diagnostic.stage!=='model-validation'?t('dfError'):e.message,true);};
const guard=fn=>(...args)=>{try{return Promise.resolve(fn(...args)).catch(showError);}catch(e){showError(e);}};
function progress(value){$('progress').value=value;$('progress-text').textContent=`${Math.round(value*100)}%`;}
const previewLimit=()=>state.info ? Math.min(60,12*1024*1024/(4*state.info.sampleRate*state.info.channels)) : 60;
const rangeKey=()=>`${state.generation}:${state.start}:${state.end}`;
let loadedRange=null;
let fileRequest=0;
const modelInput=document.createElement('input');modelInput.type='file';modelInput.id='deepfilter-model';modelInput.accept='.tar.gz,.gz';modelInput.hidden=true;document.body.append(modelInput);
const modelOptions=()=>({modelFile:state.modelFile,attenuationLimit:state.attenuationLimit});
const usable=a=>a.available&&(a.id!=='deepfilternet3'||state.modelFile);
function modelStage({algorithm,stage}){const card=$('cards').querySelector(`[data-id="${algorithm}"] .state`);const text=t(stage==='initializing'?'initializing':stage==='processing'?'processing':'modelLoading');if(card)card.textContent=text;message(`${algorithms.find(a=>a.id===algorithm)?.name}: ${text}`);}
async function loadModel(file,remember=true){
  if(!file)return;state.modelLoading=true;refresh();
  try{await validateDeepFilterModel(file);if(remember&&window.desktop)await desktop.rememberModel(file);state.modelFile=file;
    if(state.active==='deepfilternet3'){player.switch('original');state.active='original';}
    state.results.delete('deepfilternet3');delete player.buffers.deepfilternet3;buildCards();message(t('modelSelected'));
  }catch(error){error.diagnostic={algorithm:'deepfilternet3',adapter:'official-rust-wasm',stage:'model-validation',message:error.message,stack:error.stack,modelVersion:'DeepFilterNet3 epoch 120',libraryVersion:'libDF 0.5.7-pre / Tract 0.21.4',wasmVersion:'Rust 1.98.1 / wasm-bindgen 0.2.92'};throw error;}finally{state.modelLoading=false;refresh();}
}
modelInput.onchange=guard(()=>loadModel(modelInput.files[0]));
function buildCards(){
  $('cards').replaceChildren();
  const original=document.createElement('article');original.className='card';original.dataset.id='original';
  const sourceLabel=state.info?.sourceFormat==='ogg'?`OGG · ${state.info.codec==='vorbis'?'Vorbis':'Opus'}`:'WAV · PCM / Float32';
  original.innerHTML=`<h3>${t('original')}</h3><div class="version">${sourceLabel}</div><div class="state">${state.info?t('ready'):'—'}</div><p class="note">${t('privacy')}</p><div class="metrics">Dry = 100%<br>Wet = 0%</div><div class="card-actions"><button data-action="listen">${t('listen')}</button><button data-action="save">${t('save')}</button><button data-action="copy">${t('copy')}</button></div>`;
  $('cards').append(original);
  for(const a of algorithms){
    const card=document.createElement('article');card.className='card'+(a.available?'':' unavailable');card.dataset.id=a.id;
    const result=state.results.get(a.id),strength=state.strengths.get(a.id)*100;
    card.innerHTML=`<h3>${a.name}</h3><div class="version">${a.version}</div><div class="state">${a.available?(result?t('ready'):t('idle')):t('unavailable')}</div><p class="note"></p><label class="strength">${t('strength')}<output>${Math.round(strength)}%</output></label><input type="range" min="0" max="100" value="${strength}" aria-label="${a.name} Dry/Wet" ${a.available?'':'disabled'}><div class="metrics"></div><div class="card-actions"><button data-action="process">${t('preview')}</button><button data-action="listen">${t('listen')}</button><button data-action="save">${t('save')}</button></div>`;
    card.querySelector('.note').textContent=a.id==='deepfilternet3'?t(state.modelFile?'dfNote':'dfNeedsModel'):a.note;
    if(a.id==='deepfilternet3'){
      if(!state.modelFile)card.querySelector('.state').textContent=t('modelMissing');
      card.insertAdjacentHTML('beforeend',`<label class="strength">${t('attenuationLimit')}<input id="df-attenuation" type="number" min="0" max="100" step="5" value="${state.attenuationLimit}" aria-label="DeepFilterNet3 attenuation limit in dB"></label>`);
      const button=document.createElement('button');button.dataset.action='model';button.textContent=t(state.modelFile?'changeModel':'selectModel');card.querySelector('.card-actions').prepend(button);
      card.querySelector('#df-attenuation').onchange=guard(()=>{const raw=$('df-attenuation').value,value=Number(raw);if(!raw.trim()||!Number.isFinite(value)||value<0||value>100){$('df-attenuation').value=state.attenuationLimit;throw new Error(t('invalidAttenuation'));}state.attenuationLimit=value;if(state.active==='deepfilternet3'){player.switch('original');state.active='original';}state.results.delete('deepfilternet3');delete player.buffers.deepfilternet3;buildCards();message(t('needPreview'));});
    }
    const m=result?.metrics;card.querySelector('.metrics').textContent=m ? `${ms(m.computeMs)} · RTF ${m.rtf.toFixed(3)} · ${m.speed.toFixed(1)}× | Total ${ms(m.totalMs)}` : t('missing');
    $('cards').append(card);
  }
  $('cards').querySelectorAll('button').forEach(button=>button.onclick=guard(async()=>{
    const id=button.closest('.card').dataset.id;
    if(button.dataset.action==='model'){modelInput.click();return;}
    if(button.dataset.action==='process')await preview(id);
    if(button.dataset.action==='listen')await choose(id);
    if(button.dataset.action==='save')await exportAudio(id);
    if(button.dataset.action==='copy')await exportAudio('original',true);
  }));
  $('cards').querySelectorAll('input[type=range]').forEach(input=>{
    input.oninput=()=>{const id=input.closest('.card').dataset.id;state.strengths.set(id,Number(input.value)/100);input.previousElementSibling.querySelector('output').textContent=input.value+'%';if(player.active===id){player.wet=Number(input.value)/100;player.applyGains();}};
    input.onchange=()=>updateMatch();
  });refresh();
}
function refresh(){
  $('cards').querySelectorAll('.card').forEach(card=>{
    const id=card.dataset.id,a=algorithms.find(a=>a.id===id);card.classList.toggle('active',state.active===id);
    card.querySelectorAll('button').forEach(b=>b.disabled=b.dataset.action==='model'?isBusy():!state.info||isBusy()||(a&&!usable(a)));
    card.querySelectorAll('input').forEach(input=>input.disabled=isBusy()||(a&&!usable(a)));
  });
  for(const id of ['benchmark','stream','ab'])$(id).disabled=!state.info||isBusy();
  $('play').disabled=!state.dry||isBusy();
  $('play').textContent=player.playing?t('pause'):t('play');
  $('cancel').hidden=!state.busy && !jobs.pending && !player.stream;
  ['start','end','zoom','loop','match'].forEach(id=>$(id).disabled=isBusy());
  if(player.stream){$('ab').disabled=false;$('play').disabled=true;}
  $('active').textContent=state.active==='original'?t('original'):algorithms.find(a=>a.id===state.active)?.name;
}
jobs.onBusy=value=>{state.busy=value;refresh();};
function updateRangeInputs(){
  if(!state.info)return;
  $('start').value=(state.start/state.info.sampleRate).toFixed(3);$('end').value=(state.end/state.info.sampleRate).toFixed(3);
  $('start').max=state.info.duration;$('end').max=state.info.duration;
  $('selection-duration').textContent=`${((state.end-state.start)/state.info.sampleRate).toFixed(3)} s · preview ≤ ${previewLimit().toFixed(1)} s`;
}
async function prepare(){
  if(!state.info)throw new Error('Open WAV first');
  if((state.end-state.start)/state.info.sampleRate>previewLimit()+1/state.info.sampleRate)throw new Error(t('tooLong'));
  const key=rangeKey();if(loadedRange===key&&state.dry)return;
  state.preparing=true;refresh();
  try{
  const dry=await readFrames(state.file,state.info,state.start,state.end-state.start);
  if(key!==rangeKey())return;
  state.dry=dry;state.results.clear();await player.load(dry,state.info,state.start,state.end);
  if(key!==rangeKey())return;
  loadedRange=key;state.active='original';$('levels').textContent='';buildCards();
  }finally{if(key===rangeKey()){state.preparing=false;refresh();}}
}
async function invalidate(){
  player.pause();state.results.clear();state.dry=null;player.buffers={};loadedRange=null;state.active='original';updateRangeInputs();buildCards();draw();
  if((state.end-state.start)/state.info.sampleRate<=previewLimit())await prepare();
}
async function loadFile(file){
  if(!file)return;
  const request=++fileRequest;
  const container=await audioContainer(file);
  if(request!==fileRequest)return;
  if(!container)throw new Error(t('wavOnly'));
  // Validate the audio encoding before stopping playback or discarding the source.
  try{await (container==='wav'?inspectWav(file):inspectOgg(file));}
  catch(error){if(request!==fileRequest)return;throw new Error(`${t('audioRejected')} ${error.message}`);}
  if(request!==fileRequest)return;
  state.generation++;const generation=state.generation;state.preparing=false;pointer=null;jobs.cancel();player.reset();
  const oldTemp=state.decodedTemp;state.decodedTemp=null;
  if(oldTemp){temporaryAudio.delete(oldTemp);void removeOggTemp(oldTemp).catch(()=>{});}
  state.loading=true;state.file=file;state.sourceFile=file;state.info=null;state.dry=null;state.peaks=null;state.active='original';state.results.clear();loadedRange=null;
  message(t('loading'));progress(0);buildCards();
  let storageName;
  try{
    if(window.desktop)await desktop.protectSource(file);
    if(generation!==state.generation)return;
    let decodedMeta=null;
    if(container==='ogg'){
      message(t('decodingOgg'));storageName=`decoded-${crypto.randomUUID()}.wav`;temporaryAudio.add(storageName);
      const decoded=await jobs.run({type:'decode-ogg',file,storageName},{progress:({value})=>progress(value)});
      if(generation!==state.generation)return;
      state.file=decoded.file;state.decodedTemp=storageName;decodedMeta=decoded.info;
    }
    await jobs.run({type:'inspect',file:state.file},{info:({info})=>{
      if(decodedMeta)info={...info,...decodedMeta};
      state.info=info;state.start=0;state.end=Math.min(info.frames,Math.floor(info.sampleRate*Math.min(15,previewLimit())));state.viewStart=0;state.viewEnd=info.duration;
      delete $('filename').dataset.i18n;delete $('filemeta').dataset.i18n;
      const encoding=info.sourceFormat==='ogg'?`OGG ${info.codec==='vorbis'?'Vorbis':'Opus'} → Float32 PCM`:`${info.format===3?'Float':'PCM'} ${info.bits}-bit`;
      $('filename').textContent=info.name;$('filemeta').textContent=`${time(info.duration)} · ${info.sampleRate.toLocaleString()} Hz · ${info.channels===1?'Mono':'Stereo'} · ${encoding} · ${((info.originalSize??info.size)/1024/1024).toFixed(2)} MiB`;
      $('empty').hidden=true;$('zoom').value=1;updateRangeInputs();draw();
    },waveform:({peaks})=>{state.peaks=peaks;draw();},progress:({value})=>progress(value)});
    if(generation!==state.generation)return;await prepare();if(generation!==state.generation)return;message(t('idleMessage'));progress(0);
  }catch(error){if(storageName){temporaryAudio.delete(storageName);await removeOggTemp(storageName).catch(()=>{});if(state.decodedTemp===storageName)state.decodedTemp=null;}if(generation!==state.generation)return;if(error.message!=='Cancelled'){state.info=null;state.dry=null;$('filename').textContent=file.name;$('filemeta').textContent='';$('empty').hidden=false;draw();buildCards();}throw error;}
  finally{if(generation===state.generation){state.loading=false;refresh();}}
}
async function preview(algorithm){
  const key=rangeKey();await prepare();if(key!==rangeKey())return;const pcm=Array.from({length:state.info.channels},()=>new Float32Array(state.end-state.start));
  player.pause();message(`${algorithms.find(a=>a.id===algorithm).name}: ${t('processing')}`);progress(0);
  let result;try{result=await jobs.run({type:'process',mode:'preview',file:state.file,info:state.info,algorithm,start:state.start,end:state.end,...modelOptions()},{stage:modelStage,chunk:({pcm:chunk,offset})=>chunk.forEach((c,i)=>pcm[i].set(c,offset)),progress:({value})=>progress(value)});}catch(error){if(key!==rangeKey())return;throw error;}const {metrics}=result;
  if(key!==rangeKey())return;
  state.results.set(algorithm,{pcm,metrics});player.add(algorithm,pcm,state.info.sampleRate);buildCards();await choose(algorithm);
  if(key===rangeKey())message(`${algorithms.find(a=>a.id===algorithm).name}: ${t('ready')} · ${ms(metrics.computeMs)} · RTF ${metrics.rtf.toFixed(3)} · ${metrics.speed.toFixed(1)}×`);
}
async function choose(id){
  if(player.stream){if(id!==state.lastWet&&id!=='original')throw new Error('Stop streaming before choosing another model');player.switch(id);state.active=id;refresh();return;}
  const key=rangeKey();await prepare();if(key!==rangeKey())return;if(id!=='original'&&!state.results.has(id)){message(t('needPreview'));return;}
  if(id!=='original')state.lastWet=id;
  player.wet=state.strengths.get(id)??1;player.switch(id);state.active=id;updateMatch();refresh();
  const result=state.results.get(id);if(result){const {stats,dryStats}=result.metrics;$('levels').textContent=`RMS Dry ${dryStats.rmsDb.toFixed(1)} dBFS → Wet ${stats.rmsDb.toFixed(1)} dBFS · Peak ${stats.peakDb.toFixed(1)} dBFS`;}
}
function updateMatch(){
  player.matchGain=1;
  const wet=state.results.get(state.active)?.pcm;
  if($('match').checked && wet && state.dry && !player.stream){
    const dryL=integratedLoudness(state.dry,null,0,state.info.sampleRate),wetL=integratedLoudness(state.dry,wet,player.wet,state.info.sampleRate);
    if(dryL!==null&&wetL!==null){player.matchGain=Math.min(10**(12/20),10**((dryL-wetL)/20));message(`LUFS: ${dryL.toFixed(1)} / ${wetL.toFixed(1)} · audition gain ${(20*Math.log10(player.matchGain)).toFixed(1)} dB (export unaffected)`);}
  }
  player.applyGains();
}
async function createSink(name,total){
  if(window.desktop){const token=await desktop.beginSave({name,bytes:total});if(!token)throw new Error('Cancelled');return {write:bytes=>desktop.write(token,bytes),close:()=>desktop.finish(token),abort:()=>desktop.abort(token)};}
  if(window.showSaveFilePicker){
    const handle=await showSaveFilePicker({suggestedName:name,types:[{description:'WAV audio',accept:{'audio/wav':['.wav']}}]});
    const destination=await handle.getFile?.();
    const original=state.sourceFile??state.file;
    if(destination && original && destination.name===original.name && destination.size===original.size && destination.lastModified===original.lastModified)throw new Error('Choose another destination: source audio is protected');
    const writer=await handle.createWritable();return {write:bytes=>writer.write(bytes),close:()=>writer.close(),abort:()=>writer.abort()};
  }
  if(total>128*1024*1024)throw new Error('Browser download is limited to 128 MiB. Use Chrome/Edge Save As or Electron for streaming export.');
  const chunks=[];return {write:async bytes=>chunks.push(bytes),close:async()=>{const url=URL.createObjectURL(new Blob(chunks,{type:/\.(ogg|opus)$/i.test(name)?'audio/ogg':'audio/wav'}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);chunks.length=0;},abort:async()=>{chunks.length=0;}};
}
async function exportAudio(algorithm,copy=false){
  if(!state.info)return;
  const exportFile=copy?(state.sourceFile??state.file):state.file,exportGeneration=state.generation,exportInfo=state.info,options=modelOptions(),exportWet=state.strengths.get(algorithm)??1;
  const full=copy || $('export-range').value==='full',start=full?0:state.start,end=full?state.info.frames:state.end;
  const extension=copy&&state.info.sourceFormat==='ogg'?'ogg':'wav';
  const encoding=$('encoding').value,name=state.info.name.replace(/\.(wav|ogg|opus)$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,120)+`_${algorithm}.${extension}`;
  const header=copy?null:wavHeader({sampleRate:state.info.sampleRate,channels:state.info.channels,frames:end-start,encoding});
  const step=encoding==='pcm16'?2:encoding==='pcm24'?3:4,dataBytes=(end-start)*state.info.channels*step;
  const total=copy?exportFile.size:header.length+dataBytes+(dataBytes&1);
  let sink;try{sink=await createSink(name,total);}catch(e){if(e.name==='AbortError')throw new Error('Cancelled');throw e;}
  if(exportGeneration!==state.generation){await sink.abort();return;}
  player.pause();message(t('processing'));progress(0);let clipped=0;
  try{
    if(copy){state.busy=true;refresh();for(let p=0;p<exportFile.size;p+=1024*1024){if(!state.busy||exportGeneration!==state.generation)throw new Error('Cancelled');await sink.write(new Uint8Array(await exportFile.slice(p,p+1024*1024).arrayBuffer()));progress(Math.min(1,(p+1024*1024)/exportFile.size));}}
    else{
      const result=await jobs.run({type:'process',mode:'export',file:exportFile,info:exportInfo,algorithm,start,end,encoding,wet:exportWet,...options},{stage:modelStage,bytes:({bytes})=>sink.write(bytes),progress:({value})=>progress(value)});clipped=result.clipped;
    }
    if(exportGeneration!==state.generation)throw new Error('Cancelled');await sink.close();if(exportGeneration===state.generation)message(`${extension==='ogg'?t('oggSaved'):t('exported')}: ${name}${clipped?` · clipped samples: ${clipped} (no normalization)`:''}`);
  }catch(e){await sink.abort().catch(()=>{});throw e;}
  finally{if(exportGeneration===state.generation&&!jobs.pending)state.busy=false;refresh();}
}
async function benchmark(){
  const key=rangeKey();await prepare();if(key!==rangeKey())return;player.pause();$('results').hidden=false;$('results').querySelector('tbody').replaceChildren();
  for(const a of algorithms.filter(usable)){
    const measurements=[];
    for(let i=0;i<2;i++){
      message(`${a.name}: ${i===0?t('cold'):t('warm')} · ${t('processing')}`);
      if(key!==rangeKey())return;const {metrics}=await jobs.run({type:'process',mode:'benchmark',file:state.file,info:state.info,algorithm:a.id,start:state.start,end:state.end,...modelOptions()},{stage:modelStage,progress:({value})=>progress(value)});if(key!==rangeKey())return;measurements.push(metrics);
    }
    const [first,warm]=measurements,row=document.createElement('tr');
    [a.name,`${ms(first.initMs)}${first.cached?' (cached)':''}`,`${ms(first.computeMs)} / ${ms(first.totalMs)}`,`${ms(warm.computeMs)} / ${ms(warm.totalMs)}`,warm.rtf.toFixed(3),warm.speed.toFixed(1),warm.memoryBytes?`${(warm.memoryBytes/1024/1024).toFixed(1)} MiB`:'n/a'].forEach(value=>{const cell=document.createElement('td');cell.textContent=value;row.append(cell);});$('results').querySelector('tbody').append(row);
  }
  message('Inference / total pipeline · actual timings · CPU load unavailable');
}
async function stream(){
  if(!state.info)return;
  const generation=state.generation;
  const streamFile=state.file,streamInfo=state.info,start=state.start,end=state.end,options=modelOptions();
  const id=state.active==='original'?state.lastWet:state.active;
  if(id==='deepfilternet3'&&!state.modelFile)throw new Error(t('dfNeedsModel'));
  const prebuffer=Number($('prebuffer').value);if(!Number.isFinite(prebuffer)||prebuffer<0.5||prebuffer>2)throw new Error('Buffer must be 0.5–2 seconds');
  $('match').checked=false;player.matchGain=1;player.wet=state.strengths.get(id);state.active=id;state.lastWet=id;
  await player.beginStream(streamInfo,start,end,id,prebuffer);if(generation!==state.generation)return;message(t('streamMessage'));progress(0);
  try{
    const result=await jobs.run({type:'process',mode:'stream',file:streamFile,info:streamInfo,algorithm:id,start,end,...options},{stage:modelStage,stream:async({pcm,dry,offset})=>{await player.streamChunk(pcm,dry,offset,streamInfo.sampleRate);if(generation===state.generation)message(`${t('streamMessage')}: ${player.underruns} · buffer ${(player.scheduleTime-player.context.currentTime).toFixed(2)} s`);},progress:({value})=>progress(value)});
    if(generation!==state.generation)return;
    state.streamMetrics=result.metrics;
    while(generation===state.generation&&player.playing&&player.context.currentTime<player.scheduleTime)await new Promise(r=>setTimeout(r,50));
    if(generation!==state.generation)return;
    const underruns=player.underruns;player.pause();player.stream=false;player.cursor=player.end;refresh();message(`Real time: ${underruns} underruns · RTF ${result.metrics.rtf.toFixed(3)} · algorithm ${(result.metrics.delay/result.metrics.rate*1000).toFixed(1)} ms + buffer ${prebuffer}s`);
  }catch(e){if(generation===state.generation){player.pause();player.stream=false;refresh();}throw e;}
}
function draw(){
  const canvas=$('wave'),rect=canvas.getBoundingClientRect(),dpr=devicePixelRatio||1;
  canvas.width=Math.max(1,Math.round(rect.width*dpr));canvas.height=Math.max(1,Math.round(rect.height*dpr));
  const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const width=rect.width,height=rect.height;
  ctx.clearRect(0,0,width,height);ctx.strokeStyle='#233045';ctx.lineWidth=1;
  for(let i=1;i<8;i++){ctx.beginPath();ctx.moveTo(width*i/8,0);ctx.lineTo(width*i/8,height);ctx.stroke();}
  if(!state.info)return;
  const span=state.viewEnd-state.viewStart,x=s=>(s-state.viewStart)/span*width;
  ctx.fillStyle='#68dbb617';ctx.fillRect(x(state.start/state.info.sampleRate),0,x(state.end/state.info.sampleRate)-x(state.start/state.info.sampleRate),height);
  if(state.peaks){ctx.strokeStyle='#76bdbe';ctx.beginPath();const bins=state.peaks.length/2;
    for(let p=0;p<width;p++){const index=Math.min(bins-1,Math.max(0,Math.floor((state.viewStart+p/width*span)/state.info.duration*bins)));ctx.moveTo(p,height/2+state.peaks[index*2]*height*.42);ctx.lineTo(p,height/2+state.peaks[index*2+1]*height*.42);}ctx.stroke();}
  ctx.strokeStyle='#68dbb6';for(const s of [state.start/state.info.sampleRate,state.end/state.info.sampleRate]){ctx.beginPath();ctx.moveTo(x(s),0);ctx.lineTo(x(s),height);ctx.stroke();}
  ctx.strokeStyle='#e7e5ff';ctx.beginPath();ctx.moveTo(x(player.position),0);ctx.lineTo(x(player.position),height);ctx.stroke();
  $('view-start').textContent=time(state.viewStart);$('view-end').textContent=time(state.viewEnd);
}
$('open').onclick=()=>$('file').click();$('file').onchange=guard(()=>loadFile($('file').files[0]));
for(const type of ['dragenter','dragover'])$('drop').addEventListener(type,e=>{e.preventDefault();$('drop').classList.add('drag-over');});
$('drop').addEventListener('dragleave',()=>$('drop').classList.remove('drag-over'));
$('drop').addEventListener('drop',guard(e=>{e.preventDefault();$('drop').classList.remove('drag-over');return loadFile(e.dataTransfer.files[0]);}));
// Prevent browser navigation if the file is dropped outside the file panel.
window.addEventListener('dragover',e=>e.preventDefault());window.addEventListener('drop',e=>e.preventDefault());
$('play').onclick=guard(async()=>{if(player.playing)player.pause();else await player.play();refresh();});
$('loop').onchange=()=>player.setLoop($('loop').checked);
$('ab').onclick=guard(()=>choose(state.active==='original'?state.lastWet:'original'));
$('match').onchange=updateMatch;
$('cancel').onclick=()=>{jobs.cancel();state.busy=false;player.stop();refresh();message(t('cancelled'));};
$('benchmark').onclick=guard(benchmark);$('stream').onclick=guard(stream);
$('language').onchange=()=>{setLanguage($('language').value);buildCards();updateRangeInputs();};
for(const id of ['start','end'])$(id).onchange=guard(async()=>{
  if(!state.info)return;const a=Number($('start').value),b=Number($('end').value);
  if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b>state.info.duration+0.001||b<=a){updateRangeInputs();throw new Error('Invalid selection');}
  state.start=Math.min(state.info.frames-1,Math.round(a*state.info.sampleRate));state.end=Math.min(state.info.frames,Math.max(state.start+1,Math.round(b*state.info.sampleRate)));await invalidate();
});
$('zoom').oninput=()=>{if(!state.info)return;const span=state.info.duration/Number($('zoom').value),center=player.position||state.start/state.info.sampleRate;state.viewStart=Math.max(0,Math.min(state.info.duration-span,center-span/2));state.viewEnd=state.viewStart+span;draw();};
let pointer=null;
const pointerTime=e=>{const rect=$('wave').getBoundingClientRect();return Math.max(0,Math.min(state.info.duration,state.viewStart+(e.clientX-rect.left)/rect.width*(state.viewEnd-state.viewStart)));};
$('wave').onpointerdown=e=>{if(!state.info||isBusy())return;pointer={x:e.clientX,time:pointerTime(e)};$('wave').setPointerCapture(e.pointerId);};
$('wave').onpointermove=e=>{if(!pointer||Math.abs(e.clientX-pointer.x)<5)return;const now=pointerTime(e);state.start=Math.round(Math.min(pointer.time,now)*state.info.sampleRate);state.end=Math.min(state.info.frames,Math.max(state.start+1,Math.round(Math.max(pointer.time,now)*state.info.sampleRate)));updateRangeInputs();draw();};
$('wave').onpointerup=guard(async e=>{if(!pointer)return;const dragged=Math.abs(e.clientX-pointer.x)>=5;pointer=null;
  if(dragged){await invalidate();return;}
  const position=pointerTime(e);
  if(position<state.start/state.info.sampleRate||position>=state.end/state.info.sampleRate){state.start=Math.min(state.info.frames-1,Math.round(position*state.info.sampleRate));state.end=Math.min(state.info.frames,state.start+Math.floor(Math.min(15,previewLimit())*state.info.sampleRate));await invalidate();}
  player.seek(position);draw();refresh();
});
window.addEventListener('resize',draw);window.addEventListener('beforeunload',()=>{jobs.destroy();player.pause();for(const name of temporaryAudio)void removeOggTemp(name).catch(()=>{});});
document.addEventListener('keydown',guard(async e=>{if(e.code==='Space'&&!['INPUT','SELECT','BUTTON'].includes(document.activeElement.tagName)){e.preventDefault();if(!state.info||isBusy())return;const key=rangeKey();await prepare();if(key!==rangeKey()||isBusy())return;if(player.playing)player.pause();else await player.play();refresh();}}));
setLanguage('en');buildCards();
if(window.desktop)desktop.versions().then(v=>{$('runtime').textContent=`Electron ${v.electron} · Node ${v.node} · CPU`;}).catch(()=>{});
if(window.desktop)desktop.loadModel().then(model=>model&&loadModel(new File([model.bytes],model.name),false)).catch(showError);
setInterval(()=>{player.poll();$('time').textContent=`${time(player.position)} / ${time(state.info?.duration||0)}`;if(player.playing)draw();},40);
// Exposed read-only test/diagnostic snapshot, without filesystem capabilities.
window.noiseLab=Object.freeze({snapshot:()=>({info:state.info,decodedTemp:state.decodedTemp,modelReady:!!state.modelFile,attenuationLimit:state.attenuationLimit,start:state.start,end:state.end,active:state.active,busy:isBusy(),position:player.position,playing:player.playing,loop:player.loop,previewAlgorithms:[...state.results.keys()],underruns:player.underruns}),loadFile});
