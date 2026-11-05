/* ETI Mini Phase B — reference-only pure algorithm; no DOM and no mutation.
   Use current V2 coordinate snapshots, NOT legacy CHARACTERS.
   options: {element,weapon,nation, characterName}; return {element,weapon,nation}.
*/
'use strict';
function computeMiniManual(options, prototypes, characters, weight=0.50) {
  if (!(weight >= 0 && weight <= 1)) throw new Error('invalid blend weight');
  const axes={element:['O','C','E','A','N'],weapon:['AGY','REL','ROL','REF','AUT'],nation:['SD','ST','HE','AC','PO','SE','CO','TR','BE','UN']};
  const domains={element:'personality',weapon:'style',nation:'values'};
  const ch=characters.find(x => x.name === options.characterName);
  if(!ch) throw new Error('unknown character');
  const out={};
  for(const dimension of ['element','weapon','nation']) {
    const dic=prototypes[dimension];
    const selected=options[dimension];
    if(!Object.prototype.hasOwnProperty.call(dic,selected)) throw new Error('invalid '+dimension);
    const aa=axes[dimension];
    const merged=aa.map(ax => (1-weight)*dic[selected][ax]+weight*ch[domains[dimension]][ax]);
    if(merged.some(v=>!Number.isFinite(v))) throw new Error('invalid coordinates');
    function distance(v) {
      const proto=aa.map(ax=>v[ax]);
      if(dimension !== 'nation') return Math.sqrt(merged.reduce((s,x,i)=>s+((x-proto[i])/100)**2,0)/aa.length);
      const center=x=>{const avg=x.reduce((s,v)=>s+v,0)/x.length;return x.map(v=>v-avg)};
      const a=center(merged),b=center(proto);
      const denominator=Math.hypot(...a)*Math.hypot(...b);
      const sim=denominator>1e-12?a.reduce((s,x,i)=>s+x*b[i],0)/denominator:0;
      return (1-Math.max(-1,Math.min(1,sim)))/2;
    }
    // Object insertion order is the V2 prototype order, stable tie-break.
    let best=Infinity,chosen=null;
    for(const name of Object.keys(dic)) {const d=distance(dic[name]); if(d<best){best=d;chosen=name}}
    out[dimension]=chosen;
  }
  return out;
}
if(typeof module!=='undefined') module.exports={computeMiniManual};
