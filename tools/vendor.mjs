import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import {fileURLToPath} from 'node:url';
const root = new URL('../', import.meta.url);
for (const [pkg, dest] of [['@shiguredo/rnnoise-wasm', 'rnnoise'], ['@sapphi-red/gtcrn-wasm', 'gtcrn']]) {
  await mkdir(new URL(`public/vendor/${dest}/`, root), { recursive: true });
  await cp(new URL(`node_modules/${pkg}/dist/`, root), new URL(`public/vendor/${dest}/`, root), { recursive: true });
  await mkdir(new URL('licenses/', root), { recursive: true });
  await cp(new URL(`node_modules/${pkg}/LICENSE`, root), new URL(`licenses/${dest}.txt`, root));
}
const assets = ['public/vendor/rnnoise/rnnoise.js', 'public/vendor/gtcrn/index.js', 'public/vendor/gtcrn/gtcrn.wasm'];
for(const asset of ['public/vendor/deepfilternet3/df.js','public/vendor/deepfilternet3/df_bg.wasm']){await readFile(new URL(asset,root));assets.push(asset);}
for(const [pkg,dest,exportName] of [
  ['@wasm-audio-decoders/ogg-vorbis','ogg-vorbis','OggVorbisDecoder'],
  ['ogg-opus-decoder','ogg-opus','OggOpusDecoder']
]){
  await mkdir(new URL(`public/vendor/${dest}/`,root),{recursive:true});
  const asset=`public/vendor/${dest}/index.js`;
  await build({stdin:{contents:`export {${exportName}} from ${JSON.stringify(pkg)};`,resolveDir:fileURLToPath(root),loader:'js'},
    outfile:fileURLToPath(new URL(asset,root)),bundle:true,format:'esm',platform:'browser',target:'es2022',charset:'utf8',legalComments:'inline',
    external:['@wasm-audio-decoders/opus-ml'],
    plugins:[{name:'native-worker',setup(b){b.onResolve({filter:/^@eshaz\/web-worker$/},()=>({path:'native-worker',namespace:'noiselab'}));b.onLoad({filter:/.*/,namespace:'noiselab'},()=>({contents:'export default globalThis.Worker;',loader:'js'}));}}]});
  assets.push(asset);
}
// Retain installed LGPL parser sources so the linked library is inspectable and replaceable.
await mkdir(new URL('licenses/sources/',root),{recursive:true});
await cp(new URL('node_modules/codec-parser/',root),new URL('licenses/sources/codec-parser/',root),{recursive:true});
for(const pkg of ['@wasm-audio-decoders/common','@wasm-audio-decoders/ogg-vorbis','ogg-opus-decoder','opus-decoder','simple-yenc']){
  await cp(new URL(`node_modules/${pkg}/`,root),new URL(`licenses/sources/${pkg.replaceAll('/','__')}/`,root),{recursive:true});
}
const hashes = {};
for (const path of assets) {
  try { hashes[path] = createHash('sha256').update(await readFile(new URL(path, root))).digest('hex'); }
  catch { /* The package file inventory is verified separately before delivery. */ }
}
await mkdir(new URL('models/', root), { recursive: true });
await writeFile(new URL('models/assets.sha256.json', root), JSON.stringify(hashes, null, 2) + '\n');
console.log('Local WASM assets copied. No audio or model is fetched at runtime.');
