export class Jobs {
  constructor(){this.worker=null;this.pending=null;this.onBusy=()=>{};}
  run(request,handlers={}) {
    if(this.pending) return Promise.reject(new Error('Another job is running'));
    if(!this.worker) this.worker=new Worker(new URL('../workers/processor.js',import.meta.url),{type:'module'});
    const worker=this.worker;
    return new Promise((resolve,reject)=>{
      const pending={reject};this.pending=pending;this.onBusy(true);
      const current=()=>this.pending===pending&&this.worker===worker;
      const done=()=>{this.pending=null;this.onBusy(false);};
      worker.onerror=e=>{if(!current())return;worker.terminate();this.worker=null;done();reject(new Error(e.message));};
      worker.onmessage=async({data})=> {
        if(!current())return;
        try {
          if(data.type==='error') {done();const error=new Error(data.message);error.diagnostic=data.diagnostic;reject(error);}
          else if(data.type==='done') {done();resolve(data);}
          else {await handlers[data.type]?.(data);if(current()&&(data.type==='bytes'||data.type==='stream')) worker.postMessage({type:'ack'});}
        } catch(e) {if(current())this.cancel(e);}
      };
      worker.postMessage(request);
    });
  }
  cancel(error=new Error('Cancelled')) {const p=this.pending;if(p){this.worker?.terminate();this.worker=null;this.pending=null;}this.onBusy(false);p?.reject(error);}
  destroy(){this.cancel();this.worker?.terminate();this.worker=null;}
}
