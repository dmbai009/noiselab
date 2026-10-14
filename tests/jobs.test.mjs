import test from 'node:test';
import assert from 'node:assert/strict';
import {Jobs} from '../public/js/ui/jobs.js';

class FakeWorker {
  constructor(){this.sent=[];this.terminated=false;}
  postMessage(message){this.sent.push(message);}
  terminate(){this.terminated=true;}
  async deliver(data){await this.onmessage({data});}
}
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('a completed worker survives source replacement; destroy still releases it',async()=>{
  globalThis.Worker=FakeWorker;const jobs=new Jobs();
  const first=jobs.run({type:'inspect'}),worker=jobs.worker;await worker.deliver({type:'done'});await first;
  jobs.cancel();assert.equal(jobs.worker,worker);assert.equal(worker.terminated,false);
  const second=jobs.run({type:'decode-ogg'});await worker.deliver({type:'done'});await second;
  jobs.destroy();assert.equal(worker.terminated,true);assert.equal(jobs.worker,null);
});

for(const failed of [false,true])test(`a delayed cancelled stream handler cannot ${failed?'cancel':'acknowledge'} the replacement job`,async()=>{
  globalThis.Worker=FakeWorker;const jobs=new Jobs(),gate=deferred();
  const old=jobs.run({type:'process'},{stream:async()=>{await gate.promise;if(failed)throw new Error('Old stream failed');}});
  const rejected=assert.rejects(old,/Cancelled/),oldWorker=jobs.worker;
  const handler=oldWorker.deliver({type:'stream'});jobs.cancel();await rejected;
  const next=jobs.run({type:'inspect'}),worker=jobs.worker;
  gate.resolve();await handler;
  assert.deepEqual(worker.sent,[{type:'inspect'}]);assert.equal(worker.terminated,false);assert.ok(jobs.pending);
  await worker.deliver({type:'done',name:'new'});assert.equal((await next).name,'new');jobs.destroy();
});
