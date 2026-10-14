import test from'node:test';import assert from'node:assert/strict';import{ABPlayer}from'../public/js/player/player.js';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve};};
class Context{
 static created=[];constructor({sampleRate}){this.sampleRate=sampleRate;this.currentTime=0;this.destination={};this.closed=false;this.gate=null;this.sources=[];Context.created.push(this);}
 createGain(){return{context:this,connect(){},disconnect(){},gain:{cancelAndHoldAtTime(){},linearRampToValueAtTime(){},setValueAtTime(){}}};}
 createBuffer(channels,frames,rate){return{sampleRate:rate,duration:frames/rate,copyToChannel(){}};}
 createBufferSource(){const source={connect(){},disconnect(){},start(){source.started=true;},stop(){}};this.sources.push(source);return source;}
 async resume(){if(this.gate)await this.gate.promise;}
 async close(){this.closed=true;}
}
test('a delayed old load cannot overwrite the replacement sample rate or buffer',async()=>{
 globalThis.AudioContext=Context;Context.created=[];const player=new ABPlayer(),gate=deferred();
 const ensure=player.ensure.bind(player);player.ensure=async(...args)=>{const promise=ensure(...args);await new Promise(r=>setTimeout(r,0));if(Context.created.length===1&&Context.created[0].sampleRate===48000)Context.created[0].gate=gate;return promise;};
 // Gate the context before its async resume completes.
 const originalResume=Context.prototype.resume;Context.prototype.resume=async function(){if(this.sampleRate===48000)await gate.promise;};
 const old=player.load([new Float32Array(480)],{sampleRate:48000},0,480);await new Promise(r=>setTimeout(r,0));player.reset();const newer=player.load([new Float32Array(441)],{sampleRate:44100},0,441);gate.resolve();await Promise.all([old,newer]);assert.equal(player.context.sampleRate,44100);assert.equal(player.buffers.original.sampleRate,44100);assert.equal(Context.created[0].closed,true);Context.prototype.resume=originalResume;await player.close();
});
test('an old play/close wait cannot start or close a newly loaded source',async()=>{
 globalThis.AudioContext=Context;Context.created=[];const player=new ABPlayer();await player.load([new Float32Array(480)],{sampleRate:48000},0,480);const original=player.context,gate=deferred();original.gate=gate;
 const oldPlay=player.play();await new Promise(r=>setTimeout(r,0));const oldClose=player.close(),newLoad=player.load([new Float32Array(441)],{sampleRate:44100},0,441);gate.resolve();await Promise.all([oldPlay,oldClose,newLoad]);assert.equal(original.sources.length,0);assert.equal(player.context.sampleRate,44100);assert.equal(player.context.closed,false);await player.play();assert.equal(player.playing,true);await player.close();
});
