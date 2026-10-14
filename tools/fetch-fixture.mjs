import {mkdir,writeFile}from'node:fs/promises';
const url='https://raw.githubusercontent.com/Rikorose/DeepFilterNet/d375b2d8309e0935d165700c91da9de862a99c31/assets/noisy_snr0.wav';
const r=await fetch(url);if(!r.ok)throw new Error(r.status+' '+url);
await mkdir(new URL('../research/',import.meta.url),{recursive:true});await writeFile(new URL('../research/reference-speech.wav',import.meta.url),new Uint8Array(await r.arrayBuffer()));
console.log('Reference WAV saved for local tests only. Not bundled or redistributed. Source: '+url);
