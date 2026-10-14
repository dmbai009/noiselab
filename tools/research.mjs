import {mkdir,writeFile,readFile} from 'node:fs/promises';
const root=new URL('../',import.meta.url);
await mkdir(new URL('research/',root),{recursive:true});await mkdir(new URL('licenses/',root),{recursive:true});
async function get(url){const r=await fetch(url,{headers:{'User-Agent':'NoiseLab-license-research'}});if(!r.ok)throw new Error(`${r.status} ${url}`);return r;}
const specs=[
 ['rnnoise-upstream.txt','https://raw.githubusercontent.com/xiph/rnnoise/70f1d256acd4b34a572f999a05c87bf00b67730d/COPYING'],
 ['gtcrn-model.txt','https://raw.githubusercontent.com/Xiaobin-Rong/gtcrn/main/LICENSE'],
 ['deepfilternet-upstream.txt','https://raw.githubusercontent.com/Rikorose/DeepFilterNet/main/LICENSE'],
 ['deepfilternet-mit.txt','https://raw.githubusercontent.com/Rikorose/DeepFilterNet/main/LICENSE-MIT']
];
for(const [name,url]of specs)await writeFile(new URL('licenses/'+name,root),await(await get(url)).text());
for(const repo of ['sapphi-red/gtcrn-wasm','kdrkdrkdr/DeepFilterNet3.c.wasm','Rikorose/DeepFilterNet']){
 const commits=await(await get(`https://api.github.com/repos/${repo}/commits?per_page=1`)).json();const commit=commits[0].sha;
 const tree=await(await get(`https://api.github.com/repos/${repo}/git/trees/${commit}?recursive=1`)).json();
 await writeFile(new URL(`research/${repo.split('/')[1]}-tree.json`,root),JSON.stringify({commit,tree:tree.tree},null,2));
 console.log(repo,commit,tree.tree.filter(x=>/licen[cs]e|wasm|models\/|gtcrn$|\.gitmodules/.test(x.path)).map(x=>({path:x.path,sha:x.sha})).slice(0,35));
}
const source=await readFile(new URL('public/vendor/gtcrn/index.js',root),'utf8');
await writeFile(new URL('licenses/pffft-and-model.txt',root),source.slice(0,source.indexOf('const F32')));
console.log('License evidence saved. DeepFilterNet binaries/weights were not downloaded.');
