// BS.1770 K weighting + 400 ms blocks, absolute/relative gates.
// Mono/stereo only; output gain affects audition only, never stored PCM.
function coefficients(rate,type,f,q,gain=0) {
  const w=2*Math.PI*f/rate,cos=Math.cos(w),sin=Math.sin(w),a=sin/(2*q);
  if(type==='highpass') {const d=1+a;return [(1+cos)/2/d,-(1+cos)/d,(1+cos)/2/d,-2*cos/d,(1-a)/d];}
  const A=10**(gain/40),s=2*Math.sqrt(A)*a,d=(A+1)-(A-1)*cos+s;
  return [A*((A+1)+(A-1)*cos+s)/d,-2*A*((A-1)+(A+1)*cos)/d,A*((A+1)+(A-1)*cos-s)/d,2*((A-1)-(A+1)*cos)/d,((A+1)-(A-1)*cos-s)/d];
}
function filter(coeff){let x1=0,x2=0,y1=0,y2=0;return x=>{const y=coeff[0]*x+coeff[1]*x1+coeff[2]*x2-coeff[3]*y1-coeff[4]*y2;x2=x1;x1=x;y2=y1;y1=y;return y;};}
export function integratedLoudness(dry,wet,amount,rate) {
  const count=dry[0].length,step=Math.round(rate*0.1),window=4*step;
  if(count<window) return null;
  const energies=new Float64Array(Math.ceil(count/step));
  for(let c=0;c<dry.length;c++) {
    const shelf=filter(coefficients(rate,'shelf',1681.974,0.707175,4));
    const hp=filter(coefficients(rate,'highpass',38.135,0.500327));
    for(let i=0;i<count;i++){const x=hp(shelf(wet ? (1-amount)*dry[c][i]+amount*wet[c][i] : dry[c][i]));energies[Math.floor(i/step)]+=x*x;}
  }
  const blocks=[];for(let i=0;i+window<=count;i+=step){let e=0;for(let b=i/step;b<i/step+4;b++)e+=energies[b];e/=window;if(-0.691+10*Math.log10(Math.max(1e-20,e))>=-70)blocks.push(e);}
  if(!blocks.length)return null;
  const mean=blocks.reduce((s,e)=>s+e,0)/blocks.length,threshold=mean/10;
  const gated=blocks.filter(e=>e>=threshold);return -0.691+10*Math.log10(gated.reduce((s,e)=>s+e,0)/gated.length);
}
