import{writeFile}from'node:fs/promises';import path from'node:path';import{startServer}from'../server/index.mjs';import{launch}from'./browser-utils.mjs';
const{server,url}=await startServer();let browser;
try{browser=await launch();const page=await browser.newPage();await page.goto(url);await(await page.$('#file')).uploadFile(path.resolve('research/reference-speech.wav'));await page.waitForFunction(()=>noiseLab.snapshot().info&&!noiseLab.snapshot().busy);
const results=await page.evaluate(async()=>{
const{inspectWav,readFrames}=await import('/js/audio/wav.js');const{processWav}=await import('/js/audio/pipeline.js');const file=document.querySelector('#file').files[0],info=await inspectWav(file),input=(await readFrames(file,info,0,info.frames))[0];
function bandEnergy(pcm){const n=1024,re=new Float64Array(n),im=new Float64Array(n);let high=0,total=0;
 for(let p=0;p+n<pcm.length;p+=4096){for(let i=0;i<n;i++){re[i]=pcm[p+i]*(.5-.5*Math.cos(2*Math.PI*i/(n-1)));im[i]=0;}
 for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){[re[i],re[j]]=[re[j],re[i]];}}
 for(let len=2;len<=n;len*=2){const a=-2*Math.PI/len;for(let p=0;p<n;p+=len)for(let j=0;j<len/2;j++){const c=Math.cos(a*j),s=Math.sin(a*j),k=p+j,l=k+len/2,tr=re[l]*c-im[l]*s,ti=re[l]*s+im[l]*c;re[l]=re[k]-tr;im[l]=im[k]-ti;re[k]+=tr;im[k]+=ti;}}
 for(let k=1;k<n/2;k++){const e=re[k]**2+im[k]**2;total+=e;if(k*info.sampleRate/n>=8000)high+=e;}}
 return{highPower:high,totalPower:total,highFraction:high/Math.max(total,1e-30)};}
const original=bandEnergy(input),results=[];
for(const algorithm of['rnnoise','gtcrn']){const out=new Float32Array(info.frames);const metrics=await processWav({file,info,algorithm,onChunk:async(c,p)=>out.set(c[0],p)});const wet=bandEnergy(out);results.push({algorithm,duration:info.duration,original,wet,highBandChangeDb:10*Math.log10(Math.max(1e-30,wet.highPower/original.highPower)),rms:metrics.stats.rms,peak:metrics.stats.peak});}return results;});
await writeFile('test-output/high-frequency.json',JSON.stringify({source:'Official noisy speech reference, 10.596s, 48kHz mono',method:'1024-point Hann FFT every 4096 samples; power in bins >=8kHz; no perceptual quality score',results},null,2));console.log(JSON.stringify(results));
}finally{await browser?.close();await new Promise(r=>server.close(r));}
