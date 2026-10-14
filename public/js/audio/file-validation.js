export async function audioContainer(file){
  if(!file || typeof file.slice!=='function' || file.size<12)return null;
  const bytes=new Uint8Array(await file.slice(0,12).arrayBuffer());
  if(bytes.length===12 && bytes[0]===82 && bytes[1]===73 && bytes[2]===70 && bytes[3]===70 && bytes[8]===87 && bytes[9]===65 && bytes[10]===86 && bytes[11]===69)return 'wav';
  if(bytes[0]===79&&bytes[1]===103&&bytes[2]===103&&bytes[3]===83&&bytes[4]===0)return 'ogg';
  return null;
}
export const isWavFile=async file=>(await audioContainer(file))==='wav';
