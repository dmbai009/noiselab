import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const securityHeaders = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
  'Permissions-Policy':'microphone=(), camera=(), geolocation=()',
  'Cross-Origin-Opener-Policy':'same-origin', 'Cross-Origin-Resource-Policy':'same-origin'
};
export async function startServer({port=0,root=fileURLToPath(new URL('../public/',import.meta.url))}={}) {
  const resolved=path.resolve(root);
  const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.json':'application/json'};
  const server=http.createServer(async(req,res)=> {
    for(const [k,v] of Object.entries(securityHeaders)) res.setHeader(k,v);
    if(!['GET','HEAD'].includes(req.method)) {res.writeHead(405); res.end(); return;}
    if(req.headers.host!==`127.0.0.1:${server.address().port}` && req.headers.host!==`localhost:${server.address().port}`) {res.writeHead(403);res.end();return;}
    try {
      const url=new URL(req.url,'http://127.0.0.1');
      let pathname=decodeURIComponent(url.pathname); if(pathname==='/') pathname='/index.html';
      const target=path.resolve(resolved,'.'+pathname);
      if(target!==resolved && !target.startsWith(resolved+path.sep)) throw new Error('Invalid path');
      const ext=path.extname(target); if(!mime[ext]) throw new Error('Not public');
      const data=await readFile(target);
      res.writeHead(200,{'Content-Type':mime[ext],'Content-Length':data.length,'Cache-Control':'no-cache'});
      res.end(req.method==='HEAD' ? undefined : data);
    } catch {res.writeHead(404); res.end('Not found');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,url:`http://127.0.0.1:${server.address().port}`};
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const {url}=await startServer({port:Number(process.env.NOISELAB_PORT || 4173)}); console.log(`NoiseLab: ${url}`);
}
