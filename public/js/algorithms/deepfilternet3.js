export const MODEL_SHA256='c94d91f70911001c946e0fabb4aa9adc37045f45a03b56008cb0c8244cb63616';
export const MODEL_BYTES=7983136;
export async function validateDeepFilterModel(file){
  if(!file||file.size!==MODEL_BYTES)throw new Error('Select the official DeepFilterNet3_onnx.tar.gz archive (7,983,136 bytes).');
  const bytes=new Uint8Array(await file.arrayBuffer());
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==MODEL_SHA256)throw new Error('The model does not match the verified DeepFilterNet3 weights. Select the official DeepFilterNet3_onnx.tar.gz.');
  return bytes;
}
let runtime;
export async function deepFilterRuntime(){
  if(!runtime){
    runtime=(async()=>{
      const api=await import('../../vendor/deepfilternet3/df.js'),url=new URL('../../vendor/deepfilternet3/df_bg.wasm',import.meta.url);
      let input=url;
      if(url.protocol==='file:'&&typeof process!=='undefined'&&process.versions?.node){input=await(await import('node:fs/promises')).readFile(url);}
      const exports=await api.default(input);
      if(typeof api.df_free!=='function')throw new Error('DeepFilterNet3 lifecycle bridge is missing');
      return{api,exports};
    })();runtime.catch(()=>runtime=null);
  }
  return runtime;
}
