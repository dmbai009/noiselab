export class ABPlayer {
  constructor(onEnded=()=>{}) {this.context=null;this.contextQueue=Promise.resolve();this.revision=0;this.voices=[];this.buffers={};this.active='original';this.wet=1;this.matchGain=1;this.loop=false;this.playing=false;this.cursor=0;this.start=0;this.end=0;this.onEnded=onEnded;this.stream=false;this.segments=[];this.underruns=0;}
  async ensure(rate,revision=this.revision) {
    const operation=async()=>{
      if(revision!==this.revision)return false;
      if(this.context && this.context.sampleRate!==rate){const previous=this.context;this.pause();this.context=null;await previous.close();if(revision!==this.revision)return false;}
      if(!this.context) this.context=new AudioContext({sampleRate:rate});
      const context=this.context;
      if(!this.dryGain || this.dryGain.context!==context) {
        this.dryGain=context.createGain();this.wetGain=context.createGain();
        this.dryGain.connect(context.destination);this.wetGain.connect(context.destination);
      }
      await context.resume();return revision===this.revision&&context===this.context;
    };
    this.contextQueue=this.contextQueue.catch(()=>{}).then(operation);return this.contextQueue;
  }
  stop(){this.revision++;this.pause();this.stream=false;this.segments=[];}
  reset(){this.stop();this.buffers={};this.active='original';this.matchGain=1;this.cursor=0;this.start=0;this.end=0;this.scheduleTime=null;}
  buffer(pcm,rate) {const b=this.context.createBuffer(pcm.length,pcm[0].length,rate);pcm.forEach((c,i)=>b.copyToChannel(c,i));return b;}
  async load(dry,info,start,end) {
    const revision=++this.revision;this.pause();if(!await this.ensure(info.sampleRate,revision)||revision!==this.revision||this.context?.sampleRate!==info.sampleRate)return false;this.buffers={original:this.buffer(dry,info.sampleRate)};
    this.start=start/info.sampleRate;this.end=end/info.sampleRate;this.cursor=this.start;this.active='original';this.stream=false;this.applyGains(false);
  }
  add(id,pcm,rate){this.buffers[id]=this.buffer(pcm,rate);}
  get position() {
    if(!this.playing) return this.cursor;
    if(this.stream) {const t=this.context.currentTime;const s=[...this.segments].reverse().find(s=>s.when<=t);return s ? Math.min(s.end,s.start+t-s.when) : this.start;}
    const delta=this.context.currentTime-this.anchor;
    const span=this.end-this.start;
    if(delta<0)return this.cursor;
    return this.loop ? this.start+((this.cursor-this.start+delta)%span+span)%span : Math.min(this.end,this.cursor+delta);
  }
  applyGains(ramp=true) {
    if(!this.context || !this.dryGain) return;
    const dry=this.active==='original' ? 1 : (1-this.wet)*this.matchGain;
    const wet=this.active==='original' ? 0 : this.wet*this.matchGain;
    for(const [gain,value] of [[this.dryGain,dry],[this.wetGain,wet]]) {
      const now=this.context.currentTime;gain.gain.cancelAndHoldAtTime(now);
      if(ramp) gain.gain.linearRampToValueAtTime(value,now+0.02);else gain.gain.setValueAtTime(value,now);
    }
  }
  spawn(buffer,gain,when,offset=0) {
    const source=this.context.createBufferSource();source.buffer=buffer;source.connect(gain);
    source.loop=!this.stream && this.loop;source.loopStart=0;source.loopEnd=buffer.duration;
    source.start(when,offset);this.voices.push(source);
    source.onended=()=>{source.disconnect();this.voices=this.voices.filter(s=>s!==source);};
    return source;
  }
  async play(){if(this.stream) return;const revision=this.revision;if(!await this.ensure(this.buffers.original?.sampleRate || 48000,revision)||revision!==this.revision)return;if(this.playing||!this.buffers.original)return;
    if(this.cursor>=this.end) this.cursor=this.start;
    this.playing=true;this.anchor=this.context.currentTime+0.01;this.applyGains(false);
    this.spawn(this.buffers.original,this.dryGain,this.anchor,this.cursor-this.start);
    if(this.active!=='original') this.spawn(this.buffers[this.active],this.wetGain,this.anchor,this.cursor-this.start);
  }
  switch(id) {
    if(!this.stream && !this.buffers[id]) return false;
    if(this.playing && !this.stream && id!==this.active && id!=='original') {
      const position=this.position,now=this.context.currentTime;
      const old=this.wetGain;old.gain.cancelAndHoldAtTime(now);old.gain.linearRampToValueAtTime(0,now+0.02);
      const sources=this.voices.filter(s=>s!==this.voices[0]);sources.forEach(s=>{try{s.stop(now+0.025);}catch{}});
      this.wetGain=this.context.createGain();this.wetGain.gain.value=0;this.wetGain.connect(this.context.destination);
      this.spawn(this.buffers[id],this.wetGain,now,position-this.start);
      setTimeout(()=>old.disconnect(),40);
    }
    this.active=id;this.matchGain=1;this.applyGains();return true;
  }
  pause(){if(this.playing) this.cursor=this.position;this.playing=false;for(const s of this.voices){try{s.stop();}catch{}s.disconnect();}this.voices=[];}
  seek(position){if(this.stream) return;const resume=this.playing;this.pause();this.cursor=Math.max(this.start,Math.min(this.end,position));if(resume)void this.play();}
  setLoop(value){this.loop=value;if(this.playing&&!this.stream){const p=this.position;this.pause();this.cursor=p;void this.play();}}
  poll(){if(this.playing && !this.stream && !this.loop && this.position>=this.end){this.pause();this.cursor=this.end;this.onEnded();}}
  async beginStream(info,start,end,algorithm,prebuffer=1) {
    const revision=++this.revision;this.pause();if(!await this.ensure(info.sampleRate,revision)||revision!==this.revision||this.context?.sampleRate!==info.sampleRate)return false;this.stream=true;this.active=algorithm;this.start=start/info.sampleRate;this.end=end/info.sampleRate;this.cursor=this.start;
    this.playing=true;this.segments=[];this.underruns=0;this.prebuffer=prebuffer;this.scheduleTime=null;this.streamDone=false;this.applyGains(false);
  }
  async streamChunk(pcm,dry,offset,rate) {
    if(!this.stream || !this.playing) throw new Error('Cancelled');
    const revision=this.revision;
    const now=this.context.currentTime;
    if(this.scheduleTime===null) this.scheduleTime=now+this.prebuffer;
    if(this.scheduleTime<now+0.01) {this.underruns++;this.scheduleTime=now+0.02;}
    const duration=pcm[0].length/rate;
    this.spawn(this.buffer(dry,rate),this.dryGain,this.scheduleTime);
    this.spawn(this.buffer(pcm,rate),this.wetGain,this.scheduleTime);
    this.segments.push({when:this.scheduleTime,start:this.start+offset/rate,end:this.start+(offset+pcm[0].length)/rate});
    if(this.segments.length>160) this.segments.splice(0,this.segments.length-160);
    this.scheduleTime+=duration;
    const ahead=this.scheduleTime-this.context.currentTime;
    if(ahead>this.prebuffer+0.2) await new Promise(resolve=>setTimeout(resolve,(ahead-this.prebuffer)*1000));
    if(revision!==this.revision)throw new Error('Cancelled');
  }
  async close(){this.reset();const revision=this.revision;await this.contextQueue.catch(()=>{});if(revision!==this.revision)return;const context=this.context;this.context=null;await context?.close();}
}
