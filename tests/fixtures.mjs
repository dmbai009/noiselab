import {encodePCM,wavHeader} from '../public/js/audio/wav.js';
export function signal(rate=48000,seconds=1,channels=1){
  return Array.from({length:channels},(_,c)=>Float32Array.from({length:Math.round(rate*seconds)},(_,i)=>{
    const t=i/rate, syllable=Math.max(0,Math.sin(t*9*Math.PI));
    const voiced=syllable*(0.2*Math.sin(2*Math.PI*(180+70*c)*t)+0.1*Math.sin(2*Math.PI*(360+140*c)*t)+0.05*Math.sin(2*Math.PI*720*t));
    return voiced+0.055*Math.sin(i*1251.989+c*5)+0.018*Math.sin(2*Math.PI*61*t);
  }));
}
export function fixture({rate=48000,seconds=1,channels=1,encoding='pcm16',pcm=signal(rate,seconds,channels),name='голос_ї.wav'}={}){
  const encoded=encodePCM(pcm,encoding),header=wavHeader({sampleRate:rate,channels,frames:pcm[0].length,encoding});
  return new File([header,encoded.bytes,encoded.bytes.length&1?new Uint8Array(1):new Uint8Array(0)],name,{type:'audio/wav'});
}
