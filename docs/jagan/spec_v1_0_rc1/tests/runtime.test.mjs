import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {computeDiagnosis,validateBundle,explainCharacter,publicSummary,makeShareText} from '../runtime.mjs';
import {weightedSimilarity,rankEntries} from '../math.mjs';
const read=f=>JSON.parse(fs.readFileSync(new URL('../data/'+f,import.meta.url),'utf8'));
const bundle={items:read('items.json'),interpretation:read('interpretation.json'),characters:read('characters.json'),product:read('product.json')};
const answers=v=>Object.fromEntries(bundle.items.items.map(i=>[i.id,v]));
const run=(a=answers(3),id='test-result')=>computeDiagnosis({answers:a,resultId:id,itemSetVersion:bundle.items.item_set_version},bundle);
const clone=v=>JSON.parse(JSON.stringify(v));
test('fixed bundle contains fifty items, twelve domains and all eleven named targets',()=>{
 assert.equal(validateBundle(bundle),true);assert.equal(new Set(bundle.items.items.map(i=>i.id)).size,50);
 assert.deepEqual([...bundle.items.display_order].sort(),bundle.items.items.map(i=>i.id).sort());
 assert.ok(bundle.characters.characters.some(c=>c.id==='pantalone'));assert.ok(bundle.characters.characters.some(c=>c.id==='pierro'));
});
test('minimum midpoint maximum retain independent domain directions',()=>{
 for(const [v,score]of [[1,0],[3,50],[5,100]])for(const d of Object.values(run(answers(v)).domains))assert.equal(d.score,score);
});
test('four-item missing threshold preserves available mean and defers below minimum',()=>{
 const a=answers(5);a.JG001=null;let r=run(a);assert.equal(r.domains.AUT_S.score,100);assert.equal(r.domains.AUT_S.status,'partial');
 a.JG002=null;r=run(a);assert.equal(r.domains.AUT_S.score,null);assert.equal(r.characters.status,'insufficient');assert.equal(r.elements.status,'insufficient');
});
test('five-item threshold and all-missing answers do not impute neutral scores',()=>{
 const a=answers(2);a.JG025=null;assert.equal(run(a).domains.REAPP.score,25);
 a.JG026=null;assert.equal(run(a).domains.REAPP.score,null);
 const r=run({});assert.equal(r.types.status,'insufficient');assert.ok(Object.values(r.domains).every(d=>d.score===null));
});
test('invalid values, unknown item IDs and stale item versions fail',()=>{
 for(const v of [true,'3',NaN,Infinity,0,6,1.5])assert.throws(()=>run({...answers(3),JG001:v}),/invalid_answer/);
 assert.throws(()=>run({...answers(3),OLD001:3}),/unknown_item/);
 assert.throws(()=>computeDiagnosis({answers:answers(3),resultId:'x',itemSetVersion:'old'},bundle),/version_mismatch/);
});
test('model schema rejects altered roster, missing axes, invalid scores or zero weight',()=>{
 const a=clone(bundle);a.characters.characters.pop();assert.throws(()=>validateBundle(a),/roster|model/);
 const b=clone(bundle);b.characters.axes[0]='UNKNOWN';assert.throws(()=>validateBundle(b),/axes/);
 const c=clone(bundle);c.characters.characters[0].reference.AUT_S=null;assert.throws(()=>validateBundle(c),/reference/);
 const d=clone(bundle);d.characters.weights.AUT_S=0;assert.throws(()=>validateBundle(d),/weights|weight/);
});
test('single report is fixed at 1000 JPY and stays closed until release checks',()=>{
 assert.deepEqual(run().sales,{open:false,price:1000,currency:'JPY'});
 assert.equal(bundle.product.billing,'one_time');assert.equal(bundle.product.product_count,1);
 const b=clone(bundle);b.product.sales_open=true;b.product.price=null;assert.throws(()=>validateBundle(b),/sales_require_valid_price/);
});
test('calculation is reproducible, survives serialization, and does not mutate inputs',()=>{
 const a=answers(4),before=JSON.stringify(bundle),r=run(a,'saved-result-01');
 assert.deepEqual(r,run(a,'saved-result-01'));assert.equal(before,JSON.stringify(bundle));assert.deepEqual(a,answers(4));
 assert.deepEqual(r,JSON.parse(JSON.stringify(r)));assert.equal(r.publicReleaseVerified,false);
 assert.equal(r.characters.modelType,'authored_story_association');
});
test('true ties preserved and rounded percentages do not create ties',()=>{
 const r=rankEntries([{id:'a',score:87.4},{id:'b',score:87.1}],'x');assert.equal(r[0].id,'a');assert.equal(r[1].rank,2);
 const b=clone(bundle);for(const c of b.characters.characters)for(const a of b.characters.axes)c.reference[a]=50;
 const exact=computeDiagnosis({answers:answers(3),resultId:'same',itemSetVersion:b.items.item_set_version},b);
 assert.equal(exact.characters.ties.length,11);assert.equal(exact.characters.gapToSecond,0);
});
test('raw distance has mathematical endpoints and rejects missing coordinates',()=>{
 assert.equal(weightedSimilarity({a:50},{a:50},['a'],{a:1}),100);
 assert.equal(weightedSimilarity({a:0},{a:100},['a'],{a:1}),0);
 assert.throws(()=>weightedSimilarity({a:0},{a:null},['a'],{a:1}),/comparison_axis/);
});
test('weak or tied response patterns are not asserted to be a unique strong type',()=>{
 assert.equal(run(answers(1)).types.primary,null);assert.equal(run(answers(1)).types.status,'no_marked_pattern');
 assert.equal(run(answers(5)).types.close.length,6);assert.equal(run(answers(5)).types.differentiation,'co_dominant');
 assert.equal(run(answers(3)).elements.ties.length,7);
});
test('public summary is a strict projection without answers, twelve scores or private result ID',()=>{
 const r=run(answers(4),'private-result-uuid'),s=publicSummary(r),encoded=JSON.stringify(s);
 assert.ok(!encoded.includes('private-result-uuid'));
 const keys=[];const visit=o=>{if(o&&typeof o==='object')for(const [k,v] of Object.entries(o)){keys.push(k);visit(v);}};visit(s);
 for(const key of ['answers','domains','reference','referenceScore','userScore','resultId','owner','userId'])assert.ok(!keys.includes(key));
 assert.deepEqual(Object.keys(s).sort(),['kind','element','type','character','interpretationVersion','characterModelVersion'].sort());
 assert.ok(Number.isInteger(s.character.matchPercent));assert.throws(()=>publicSummary(run({})),/shareable/);
});
test('X template retains requested format and disallows arbitrary origins, tokens or query payloads',()=>{
 const r=run(answers(4));const url='https://example.invalid/jagan/s/fixture_shared_01';
 const text=makeShareText(r,url,'https://example.invalid');
 assert.ok(text.startsWith('邪眼診断をやってみました。\n私の結果は、【'));assert.ok(text.includes('最も近しいファトゥス：'));assert.ok(text.endsWith('#邪眼診断 #原神'));
 for(const bad of [url+'?answers=123',url+'#token','https://other.invalid/jagan/s/fixture_shared_01','http://example.invalid/jagan/s/fixture_shared_01','https://example.invalid/private/fixture_shared_01'])assert.throws(()=>makeShareText(r,bad,'https://example.invalid'),/invalid_share_url/);
 assert.ok(makeShareText(run(answers(3)),url,'https://example.invalid').includes('※元素に同率候補があります。'));
 assert.ok(makeShareText(run(answers(5)),url,'https://example.invalid').includes('※型に同率候補があります。'));
});
test('character explanation returns actual aligned and differing axes with an explicit interpretation notice',()=>{
 const r=run();const x=explainCharacter(r,bundle.characters);assert.equal(x.status,'available');
 for(const a of x.aligned)assert.ok(a.difference<=15);
 for(const a of x.different)assert.ok(a.difference>=20);
 assert.ok(x.caution.includes('作品解釈'));
});
test('frozen reference retains bounded experimental adjustments without changing human scale scores',()=>{
 for(const c of bundle.characters.characters)for(const a of bundle.characters.axes)assert.ok(Math.abs(c.reference[a]-c.authorial_seed[a])<=10.000001);
 assert.equal(bundle.characters.model_type,'authored_story_association');
});
