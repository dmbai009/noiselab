import{writeFile,mkdir}from'node:fs/promises';import{createHash}from'node:crypto';import{gunzipSync}from'node:zlib';
const hash='0a8755f8e2d834eff6a54714ecc7d75f9932e845df35f8b59bc52a7cfe6e8b37';
const url=`https://media.xiph.org/rnnoise/models/rnnoise_data-${hash}.tar.gz`;
const response=await fetch(url);if(!response.ok)throw new Error(response.status+' '+url);
const archive=Buffer.from(await response.arrayBuffer());if(createHash('sha256').update(archive).digest('hex')!==hash)throw new Error('Official model archive hash mismatch');
const tar=gunzipSync(archive,{maxOutputLength:128*1024*1024}),entries=[];let text='';
for(let p=0;p+512<tar.length;){const name=tar.subarray(p,p+100).toString().split('\0')[0];if(!name)break;const size=parseInt(tar.subarray(p+124,p+136).toString().replaceAll('\0','').trim(),8)||0;if(size<0||p+512+size>tar.length)throw new Error('Invalid model tar');entries.push({name,size});
if(/\.([ch])$|COPYING|LICENSE/.test(name)){const head=tar.subarray(p+512,p+512+Math.min(size,6000)).toString();text+=`\nFILE ${name}\n${head.split('\n').slice(0,52).join('\n')}\n`;}
p+=512+Math.ceil(size/512)*512;}
await mkdir('research',{recursive:true});await writeFile('research/rnnoise-model-audit.json',JSON.stringify({url,verifiedSHA256:hash,archiveBytes:archive.length,entries},null,2));await writeFile('research/rnnoise-model-headers.txt',text);console.log(JSON.stringify(entries));console.log(text.slice(0,5500));
