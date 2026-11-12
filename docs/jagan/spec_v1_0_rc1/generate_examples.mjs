import fs from 'node:fs';
import {computeDiagnosis,explainCharacter,publicSummary,makeShareText} from './runtime.mjs';
const read=f=>JSON.parse(fs.readFileSync(new URL('data/'+f,import.meta.url),'utf8'));
const bundle={items:read('items.json'),interpretation:read('interpretation.json'),characters:read('characters.json'),product:read('product.json')};
function pattern(overrides={}) {
 const result={};
 for(const d of bundle.items.domains) {
   const value=overrides[d.id]??3;
   for(const q of bundle.items.items.filter(i=>i.domain===d.id))result[q.id]=value;
 }
 return result;
}
const cases=[
 ['中間回答','全て3。明確な型・元素差を捏造しない。',pattern()],
 ['全て最低','全て1。困難が低いことと、充足が高いことは同じではない。',Object.fromEntries(bundle.items.items.map(q=>[q.id,1]))],
 ['全て最高','全て5。矛盾と断定せず、複数場面の混在・拮抗を表示する。',Object.fromEntries(bundle.items.items.map(q=>[q.id,5]))],
 ['表出抑制が多い仮例','表出抑制の5問だけを5。他の感情の困難まで高いと解釈しない。',pattern({SUPPR:5})],
 ['捉え直しが多い仮例','捉え直しの5問だけを5。対処が必ず成功すると解釈しない。',pattern({REAPP:5})],
 ['衝動調整が難しい仮例','衝動調整の4問だけを5。危険性・善悪を判定しない。',pattern({IMP_D:5})],
 ['関係の阻害感がある仮例','関係性阻害4問を5、関係性充足4問を2。愛着タイプや原因を推定しない。',pattern({REL_F:5,REL_S:2})],
 ['回答不足','回答しないを選んだ場面のUI用。',{}],
];
const examples=cases.map(([name,purpose,answers],i)=>{
 const input={answers,resultId:`fictional-case-${i+1}`,itemSetVersion:bundle.items.item_set_version};
 const result=computeDiagnosis(input,bundle);
 const element=result.elements.rankings.find(r=>r.id===result.elements.primary);
 const character=result.characters.rankings.find(r=>r.id===result.characters.primary);
 let shared=null,shareText=null;
 if(element&&character&&result.types.status!=='insufficient'){
   shared=publicSummary(result);
   shareText=makeShareText(result,`https://example.invalid/jagan/s/fictional_case_0${i+1}`,'https://example.invalid');
 }
 return {name,purpose,fictional:true,input,result,explanation:explainCharacter(result,bundle.characters),publicSummary:shared,shareText};
});
fs.writeFileSync(new URL('examples.json',import.meta.url),JSON.stringify(examples,null,2)+'\n');
const lines=['# 架空の回答例による動作・解説の確認','',
'全て開発用に作った回答であり、人が受検した結果ではありません。キャラクターは作品解釈による参照パターンとの近さです。代表例の納得感と心理測定上の妥当性は別です。',
'','| 回答例 | 元素の代表 | 型 | 人物の代表 | 類似度 | 近接人物候補数 |','|---|---|---|---|---:|---:|'];
for(const e of examples){
 const r=e.result,a=r.elements.rankings.find(x=>x.id===r.elements.primary),c=r.characters.rankings.find(x=>x.id===r.characters.primary);
 lines.push(`| ${e.name} | ${a?.label??'回答不足'}${r.elements.ties?.length>1?'（同率）':''} | ${r.types.label??'回答不足'}${r.types.differentiation==='co_dominant'?'（拮抗）':''} | ${c?.label??'回答不足'} | ${c?c.displayScore+'%':'—'} | ${r.characters.closeCandidates?.length??0} |`);
}
for(const e of examples){
 lines.push('','## '+e.name,'',e.purpose);
 if(e.result.characters.status==='available') {
   lines.push('',`人物の1位と2位の差：${e.result.characters.gapToSecond.toFixed(2)}ポイント。差が小さければ、一人の人物像を強く断定しない。`);
   const labels=Object.fromEntries(bundle.items.domains.map(d=>[d.id,d.label]));
   lines.push('','参照パターンと近い項目：'+(e.explanation.aligned.map(x=>labels[x.axis]).join('、')||'明確な項目なし')+'。');
   lines.push('','参照パターンと差がある項目：'+(e.explanation.different.map(x=>labels[x.axis]).join('、')||'大きな差として示す項目なし')+'。');
 }
 if(e.shareText)lines.push('','共有文（架空URL）：','','```text',e.shareText,'```');
}
lines.push('','中間回答での代表元素は真の同率群から結果IDで選んだもの。少しの差や、設定のない内面を発見した結果と説明しない。');
fs.writeFileSync(new URL('EXAMPLES.md',import.meta.url),lines.join('\n')+'\n');
console.log(JSON.stringify({fictional_examples:examples.length,real_participants:0}));
