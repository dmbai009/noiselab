import{spawn}from'node:child_process';import electron from'electron';import{mkdir,writeFile}from'node:fs/promises';
await mkdir('test-output',{recursive:true});
const child=spawn(process.argv[2]||electron,process.argv[2]?['--stability-test']:['.','--stability-test'],{cwd:process.cwd(),windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',d=>{output+=d;process.stdout.write(d);});child.stderr.on('data',d=>{output+=d;process.stderr.write(d);});
const timer=setTimeout(()=>child.kill(),Number(process.env.NOISELAB_STABILITY_MS||120000)+30000);
const result=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);});clearTimeout(timer);await writeFile('test-output/stability-test.log',output);
if(result!==0||!output.includes('NOISELAB_STABILITY='))throw new Error('Stability test failed: '+result);
