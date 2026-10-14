import{spawn}from'node:child_process';import{writeFile,mkdir,readFile}from'node:fs/promises';import path from'node:path';
import{fixture}from'../tests/fixtures.mjs';
export async function oggFixtures(){
  await mkdir('test-output/ogg',{recursive:true});const files=[];
  for(const codec of['vorbis','opus'])for(const channels of[1,2]){
    const rate=codec==='vorbis'?44100:48000,n=Math.round(rate*2.123);
    const source=fixture({rate,channels,seconds:2.123,encoding:'float32'});
    const input=path.resolve(`test-output/ogg/source-${codec}-${channels}.wav`),output=path.resolve(`test-output/ogg/голос_${codec}_${channels}.ogg`),decoded=path.resolve(`test-output/ogg/reference-${codec}-${channels}.wav`);
    await writeFile(input,new Uint8Array(await source.arrayBuffer()));
    await ffmpeg(['-hide_banner','-loglevel','error','-y','-i',input,'-c:a',codec==='vorbis'?'libvorbis':'libopus',output]);
    await ffmpeg(['-hide_banner','-loglevel','error','-y','-i',output,'-c:a','pcm_f32le',decoded]);
    files.push({codec,channels,rate,frames:n,input,output,decoded});
  }
  return files;
}
async function ffmpeg(args){const child=spawn(process.env.NOISELAB_FFMPEG||'ffmpeg',args,{windowsHide:true,stdio:['ignore','ignore','pipe']});let error='';child.stderr.on('data',d=>error+=d);const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve);});if(code)throw new Error(error||'FFmpeg fixture encoder failed');}
