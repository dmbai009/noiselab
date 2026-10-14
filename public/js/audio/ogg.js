import{wavHeader,encodePCM,inspectWav}from'./wav.js';
const crcTable=Uint32Array.from({length:256},(_,i)=>{let crc=i<<24;for(let j=0;j<8;j++)crc=(crc&0x80000000)?(crc<<1)^0x04c11db7:crc<<1;return crc>>>0;});
export async function* oggPages(file){
  let offset=0,serial=null,sequence=0,last=false;
  while(offset<file.size){
    const header=new Uint8Array(await file.slice(offset,offset+27).arrayBuffer());
    if(header.length!==27||String.fromCharCode(...header.subarray(0,4))!=='OggS'||header[4]!==0)throw new Error('Truncated or invalid OGG page');
    const table=new Uint8Array(await file.slice(offset+27,offset+27+header[26]).arrayBuffer());
    if(table.length!==header[26])throw new Error('Truncated OGG segment table');
    const size=27+table.length+table.reduce((s,n)=>s+n,0);
    if(offset+size>file.size)throw new Error('Truncated OGG audio packet');
    const bytes=new Uint8Array(await file.slice(offset,offset+size).arrayBuffer());const view=new DataView(bytes.buffer);
    const currentSerial=view.getUint32(14,true),currentSequence=view.getUint32(18,true);
    if(serial===null){serial=currentSerial;if(!(header[5]&2))throw new Error('OGG beginning-of-stream is missing');}
    if(last||serial!==currentSerial||currentSequence!==sequence++)throw new Error('Only one complete, ordered OGG audio stream is supported');
    let crc=0;for(let i=0;i<bytes.length;i++){const b=i>=22&&i<=25?0:bytes[i];crc=((crc<<8)^crcTable[((crc>>>24)^b)&255])>>>0;}
    if(crc!==view.getUint32(22,true))throw new Error('OGG page checksum mismatch');
    last=!!(header[5]&4);offset+=size;yield{bytes,end:offset};
  }
  if(!last)throw new Error('OGG end-of-stream is missing');
}
export async function inspectOgg(file){
  const first=new Uint8Array(await file.slice(0,65536).arrayBuffer());
  if(first.length<28||String.fromCharCode(...first.subarray(0,4))!=='OggS'||first[4]!==0)throw new Error('Invalid OGG header');
  const count=first[26],begin=27+count;if(first.length<begin)throw new Error('Truncated OGG page');
  const bytes=first.subarray(begin),text=new TextDecoder('latin1').decode(bytes.subarray(0,8));let codec,channels,rate;
  if(bytes[0]===1&&text.slice(1,7)==='vorbis'){
    if(bytes.length<30)throw new Error('Truncated Vorbis identification');codec='vorbis';channels=bytes[11];rate=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(12,true);
  }else if(text==='OpusHead'){
    if(bytes.length<19)throw new Error('Truncated Opus identification');codec='opus';channels=bytes[9];rate=48000;
  }else throw new Error('Only OGG Vorbis and OGG Opus audio are supported');
  if(![1,2].includes(channels)||rate<8000||rate>192000)throw new Error('OGG supports mono/stereo at 8–192 kHz');
  return{codec,channels,rate};
}
export async function decodeOgg(file,{openSink,onProgress=()=>{},cancelled=()=>false}={}){
  const meta=await inspectOgg(file);
  const mod=meta.codec==='vorbis'?await import('../../vendor/ogg-vorbis/index.js'):await import('../../vendor/ogg-opus/index.js');
  const decoder=meta.codec==='vorbis'?new mod.OggVorbisDecoder():new mod.OggOpusDecoder({forceStereo:false});
  let sink,frames=0,complete=false;
  try{
    await decoder.ready;sink=await openSink();await sink.write(new Uint8Array(56),0);
    const emit=async result=>{
      if(cancelled())throw new Error('Cancelled');
      if(result.errors?.length)throw new Error('OGG decode error: '+result.errors[0].message);
      if(!result.samplesDecoded)return;
      if(result.channelData.length!==meta.channels||result.sampleRate!==meta.rate)throw new Error('OGG chained streams with changing format are unsupported');
      const data=encodePCM(result.channelData,'float32').bytes;
      if(56+(frames+result.samplesDecoded)*meta.channels*4>0xffffffff)throw new Error('Decoded OGG exceeds RIFF 4 GiB');
      await sink.write(data,56+frames*meta.channels*4);frames+=result.samplesDecoded;
    };
    for await(const page of oggPages(file)){if(cancelled())throw new Error('Cancelled');await emit(await decoder.decode(page.bytes));onProgress(page.end/file.size);await new Promise(r=>setTimeout(r,0));}
    await emit(await decoder.flush());if(!frames)throw new Error('OGG contains no decodable audio');
    await sink.write(wavHeader({sampleRate:meta.rate,channels:meta.channels,frames,encoding:'float32'}),0);
    const decoded=await sink.finish();const info=await inspectWav(decoded);
    complete=true;return{file:decoded,info:{...info,name:file.name,sourceFormat:'ogg',codec:meta.codec,originalSize:file.size},storageName:sink.storageName};
  }finally{
    decoder.free();if(!complete)await sink?.abort().catch(()=>{});
  }
}
export async function oggStorage(){
  if(!navigator.storage?.getDirectory)throw new Error('OGG requires local temporary storage. Use Electron, Chrome or Edge.');
  return(await navigator.storage.getDirectory()).getDirectoryHandle('noiselab-decoded',{create:true});
}
export async function createOggSink(name){
  const dir=await oggStorage(),fileHandle=await dir.getFileHandle(name,{create:true}),access=await fileHandle.createSyncAccessHandle();
  let closed=false;
  return{storageName:name,async write(bytes,position){let n=0;while(n<bytes.length){const written=access.write(bytes.subarray(n),{at:position+n});if(!written)throw new Error('Temporary audio write failed');n+=written;}},
    async finish(){access.flush();access.close();closed=true;return fileHandle.getFile();},
    async abort(){if(!closed){access.close();closed=true;}await dir.removeEntry(name);}};
}
export async function removeOggTemp(name){if(!/^decoded-[a-f0-9-]+\.wav$/.test(name))return;const dir=await oggStorage();await dir.removeEntry(name).catch(e=>{if(e.name!=='NotFoundError')throw e;});}
