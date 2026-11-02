import {ENGINE_VERSION,scoreDomains,scoreInterpretations,weightedSimilarity,rankEntries} from './math.mjs';

export const RESULT_SCHEMA_VERSION='jagan-result-1';

export function validateBundle(bundle) {
  if(!bundle || !bundle.items || !bundle.interpretation || !bundle.characters || !bundle.product)throw new Error('missing_bundle');
  const {items,interpretation,characters,product}=bundle;
  if(items.diagnosis_key!=='jagan' || items.items.length!==50 || items.domains.length!==12)throw new Error('invalid_item_set');
  if(items.interpretation_version!==interpretation.version)throw new Error('interpretation_version_mismatch');
  if(characters.model_type!=='authored_story_association' || characters.characters.length!==11)throw new Error('invalid_character_model');
  const expected=items.domains.map(d=>d.id).sort();
  if(JSON.stringify([...characters.axes].sort())!==JSON.stringify(expected))throw new Error('invalid_model_axes');
  const ids=characters.characters.map(c=>c.id);
  if(new Set(ids).size!==11 || !ids.includes('pierro') || !ids.includes('pantalone'))throw new Error('invalid_character_roster');
  const total=characters.axes.reduce((s,a)=>s+characters.weights[a],0);
  if(!Number.isFinite(total)||Math.abs(total-1)>1e-10)throw new Error('invalid_model_weights');
  for(const a of characters.axes){
    if(!(characters.weights[a]>0))throw new Error('invalid_model_weight');
    for(const c of characters.characters)if(typeof c.reference[a]!=='number'||!Number.isFinite(c.reference[a])||c.reference[a]<0||c.reference[a]>100)throw new Error('invalid_reference');
  }
  if(product.sales_open && (!Number.isInteger(product.price)||product.price<=0))throw new Error('sales_require_valid_price');
  return true;
}

function matchStories(domains,model,resultId) {
  const missing=model.axes.filter(a=>domains[a]?.score===null||domains[a]?.score===undefined);
  if(missing.length)return {status:'insufficient',primary:null,rankings:[],missingAxes:missing,modelType:model.model_type};
  const user=Object.fromEntries(model.axes.map(a=>[a,domains[a].score]));
  const rankings=rankEntries(model.characters.map(c=>({id:c.id,label:c.name,
    score:weightedSimilarity(user,c.reference,model.axes,model.weights)})),resultId);
  const best=rankings[0].score;
  return {status:'available',modelType:model.model_type,primary:rankings[0].id,rankings,
    ties:rankings.filter(r=>r.rank===1).map(r=>r.id),
    closeCandidates:rankings.filter(r=>best-r.score<=3).map(r=>r.id),
    gapToSecond:best-rankings[1].score,notice:model.notice};
}

export function computeDiagnosis(input,bundle) {
  validateBundle(bundle);
  if(!input||input.itemSetVersion!==bundle.items.item_set_version)throw new Error('item_set_version_mismatch');
  rankEntries([],input.resultId);
  const scored=scoreDomains(input.answers,bundle.items);
  const interpretations=scoreInterpretations(scored.domains,bundle.interpretation,input.resultId);
  const answered=Object.values(scored.answers).filter(v=>v!==null);
  return {schemaVersion:RESULT_SCHEMA_VERSION,diagnosisKey:'jagan',stage:'implementation_candidate',
    publicReleaseVerified:false,resultId:input.resultId,
    versions:{engine:ENGINE_VERSION,itemSet:bundle.items.item_set_version,
      scoring:bundle.items.scoring_version,interpretation:bundle.interpretation.version,
      characterModel:bundle.characters.version,calibration:bundle.characters.calibration_version},
    ...scored,...interpretations,characters:matchStories(scored.domains,bundle.characters,input.resultId),
    quality:{answered:answered.length,missing:50-answered.length,uniformAnswers:answered.length===50&&new Set(answered).size===1},
    // This is configuration only. The server must independently validate any purchase.
    sales:{open:bundle.product.sales_open,price:bundle.product.price,currency:bundle.product.currency}};
}

// Explanations describe numerical correspondence to the fictional reference,
// without inferring hidden motives or declaring the character's actual trait score.
export function explainCharacter(result,model,characterId=result.characters.primary) {
  const c=model.characters.find(x=>x.id===characterId);
  if(!c||result.characters.status!=='available')return {status:'unavailable',aligned:[],different:[]};
  const distances=model.axes.map(axis=>({axis,userScore:result.domains[axis].score,
    referenceScore:c.reference[axis],difference:Math.abs(result.domains[axis].score-c.reference[axis])}));
  const aligned=distances.filter(x=>x.difference<=15).sort((a,b)=>a.difference-b.difference).slice(0,3);
  const different=distances.filter(x=>x.difference>=20).sort((a,b)=>b.difference-a.difference).slice(0,3);
  return {status:'available',characterId,caution:'比較先は作品解釈から作った回答参照パターンです。',
    aligned,different,thresholdMeaning:'15点・20点は説明を作るための設計値で、心理学上の基準ではありません。'};
}

export function publicSummary(result) {
  const e=result.elements.rankings.find(r=>r.id===result.elements.primary);
  if(!e||result.types.status==='insufficient'||result.characters.status!=='available')throw new Error('result_not_shareable');
  const character=result.characters.rankings.find(r=>r.id===result.characters.primary);
  const type=result.types.primary?result.types.rankings.find(r=>r.id===result.types.primary).label:'型の偏りなし';
  return {kind:'jagan-public-summary-1',element:{id:e.id,label:e.label,hasExactTie:result.elements.ties.length>1},
    type:{id:result.types.primary,label:type,hasExactTie:Boolean(result.types.primary&&result.types.rankings.filter(r=>r.rank===1).length>1)},character:{id:character.id,label:character.label,
    matchPercent:character.displayScore,hasExactTie:result.characters.ties.length>1},
    interpretationVersion:result.versions.interpretation,characterModelVersion:result.versions.characterModel};
}

export function makeShareText(result,summaryUrl,siteOrigin) {
  const url=new URL(summaryUrl), origin=new URL(siteOrigin);
  if(origin.protocol!=='https:'||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash ||
     url.origin!==origin.origin||url.username||url.password||url.search||url.hash||
     !/^\/jagan\/s\/[A-Za-z0-9_-]{16,128}$/.test(url.pathname))throw new Error('invalid_share_url');
  const s=publicSummary(result);
  const notes=[];
  if(s.element.hasExactTie)notes.push('※元素に同率候補があります。');
  if(s.type.hasExactTie)notes.push('※型に同率候補があります。');
  if(s.character.hasExactTie)notes.push('※人物に同率候補があります。');
  const tie=notes.length?'\n'+notes.join('\n'):'';
  return `邪眼診断をやってみました。\n私の結果は、【${s.element.label}×${s.type.label}】\n\n最も近しいファトゥス：${s.character.label}（${s.character.matchPercent}%一致）${tie}\n\n${url.href}\n#邪眼診断 #原神`;
}
