import {readFile,readdir,mkdir,cp,writeFile}from'node:fs/promises';import path from'node:path';
const lock=JSON.parse(await readFile('package-lock.json','utf8')),inventory=[];
for(const [location,metadata]of Object.entries(lock.packages)){
  if(!location)continue;
  try{
    const pkg=JSON.parse(await readFile(path.join(location,'package.json'),'utf8'));
    const name=pkg.name||location,version=pkg.version;
    const dest=path.join('licenses','npm',name.replaceAll('/','__').replace('@','')+'-'+version);
    const files=(await readdir(location,{withFileTypes:true})).filter(f=>f.isFile()&&/^(licen[cs]e|copying|notice)([.\-_]|$)/i.test(f.name)).map(f=>f.name);
    if(files.length){await mkdir(dest,{recursive:true});for(const f of files)await cp(path.join(location,f),path.join(dest,f));}
    inventory.push({name,version,license:pkg.license??metadata.license??null,development:!!metadata.dev,source:metadata.resolved,integrity:metadata.integrity,notices:files.map(f=>`${dest.replaceAll('\\','/')}/${f}`)});
  }catch(e){if(e.code!=='ENOENT')throw e;}
}
await mkdir('licenses',{recursive:true});await writeFile('licenses/dependencies.json',JSON.stringify(inventory,null,2));console.log(`Recorded ${inventory.length} installed npm dependencies and their supplied notice files.`);
