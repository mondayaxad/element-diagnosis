'use strict';
// 分析用の計測（js/ga.js の EdAnalytics）：設問の回答・進み具合・所要時間・申込ボタンの表示・レポートの章・納得度・ユーザー属性・内部トラフィック
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));

function memStore() { const m = {}; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; } }; }
function ga({ search = '', now = Date.parse('2026-11-17T10:00:00+09:00'), local = memStore() } = {}) {
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { super(...(a.length ? a : [now])); } static now() { return now; } }
  const window = { sessionStorage: memStore(), localStorage: local };
  const ctx = { window, Date: FakeDate, location: { hostname: 'element-diagnosis-five.vercel.app', origin: 'https://element-diagnosis-five.vercel.app', pathname: '/', search },
    document: { referrer: '', head: { appendChild() {} }, createElement() { return {}; } }, URLSearchParams };
  vm.createContext(ctx); vm.runInContext(read('js/ga.js'), ctx);
  const events = () => window.dataLayer.filter((a) => a[0] === 'event').map((a) => [a[1], plain(a[2])]);
  return { w: window, events, local };
}

test('quiz_answers：全設問の回答を50問ずつの数字の列で送る（個人を特定しない）。消毒の規則で消えない', () => {
  const { w, events } = ga();
  const order = Array.from({ length: 100 }, (_, i) => `Q${i + 1}`);
  const answers = Object.fromEntries(order.map((id, i) => [id, (i % 5) - 2]));
  delete answers.Q7; // 未回答は 0
  w.EdAnalytics.answers('eti', 'ETI-ITEM-2.0.0', order, answers, (v) => v + 3);
  const [name, p] = events().at(-1);
  assert.equal(name, 'quiz_answers');
  assert.equal(p.diagnosis_type, 'eti'); assert.equal(p.answer_set, 'ETI-ITEM-2.0.0'); assert.equal(p.answer_count, 100);
  assert.equal(p.ans_001_050.length, 50); assert.equal(p.ans_051_100.length, 50);
  assert.equal(p.ans_001_050.slice(0, 7), '123451' + '0');
  assert.equal(Object.keys(p).filter((k) => k.startsWith('ans_')).length, 2);
  // 邪眼（50問）は1列
  const order50 = Array.from({ length: 50 }, (_, i) => `J${i}`);
  w.EdAnalytics.answers('jagan', 'jagan-items', order50, Object.fromEntries(order50.map((id) => [id, 4])), Number);
  const [, q] = events().at(-1);
  assert.equal(q.ans_001_050, '4'.repeat(50)); assert.equal(q.ans_051_100, undefined);
  // 回答の列以外の長い英数字（診断コードなど）は、これまでどおり落とす
  w.gtag('event', 'diagnosis_result', { code: 'x', note: 'q8tfdsyv0j9w30o6ezwid4nhcl7zm2wsros01rod63eq6', ans_001_050: '9'.repeat(50) });
  const [, r] = events().at(-1);
  assert.equal(r.note, undefined); assert.equal(r.ans_001_050, undefined, '0〜5 以外の数字の列は送らない');
});

test('quiz_answers は施行日（2026-11-17 0:00 JST）より前は送らない', () => {
  const { w, events } = ga({ now: Date.parse('2026-11-16T23:59:00+09:00') });
  w.EdAnalytics.answers('eti', 'v', ['a', 'b'], { a: 1, b: 2 }, (v) => v + 3);
  assert.equal(events().filter(([n]) => n === 'quiz_answers').length, 0);
});

test('quiz_progress：10%の区切りを初めて越えた時だけ（戻って答え直しても重ねない）。完了時に所要時間', () => {
  const { w, events } = ga();
  w.EdAnalytics.start('jagan');
  for (const n of [1, 4, 5, 5, 4, 6, 26, 49, 50]) w.EdAnalytics.progress('jagan', n, 50);
  assert.deepEqual(plain(events().filter(([n]) => n === 'quiz_progress').map(([, p]) => p.progress_pct)), [10, 20, 30, 40, 50, 60, 70, 80, 90]);
  const d = w.EdAnalytics.durationParams('jagan');
  assert.equal(d.duration_min, 0); assert.equal(d.duration_band, 'under5');
  assert.deepEqual(plain(w.EdAnalytics.durationParams('jagan')), {}, '1回だけ');
});

test('納得度・ユーザー属性・内部トラフィックの印', () => {
  const local = memStore();
  let { w, events } = ga({ search: '?ed_internal=1', local });
  w.EdAnalytics.feedback('eti', 4); w.EdAnalytics.feedback('eti', 9);
  assert.deepEqual(plain(events().filter(([n]) => n === 'result_feedback').map(([, p]) => p)), [{ diagnosis_type: 'eti', fit: 4 }]);
  assert.equal(w.dataLayer.find((a) => a[0] === 'config')[2].traffic_type, 'internal');
  w.gtag('event', 'quiz_complete', {});
  w.gtag('event', 'jagan_complete', { diagnosis_type: 'jagan' });
  w.gtag('event', 'purchase_client', { transaction_id: '0123456789abcdef0123' });
  const sets = w.dataLayer.filter((a) => a[0] === 'set' && a[1] === 'user_properties').map((a) => plain(a[2]));
  assert.deepEqual(sets.at(-1), { diagnoses_done: 'both', is_purchaser: 'yes' });
  // 次のページ：同じ端末の印は読み込み時に付き、内部の印も続く。?ed_internal=0 で外れる
  ({ w } = ga({ local }));
  assert.deepEqual(plain(w.dataLayer.find((a) => a[0] === 'set')[2]), { diagnoses_done: 'both', is_purchaser: 'yes' });
  assert.equal(w.dataLayer.find((a) => a[0] === 'config')[2].traffic_type, 'internal');
  ({ w } = ga({ search: '?ed_internal=0', local }));
  assert.equal(w.dataLayer.find((a) => a[0] === 'config')[2].traffic_type, undefined);
});

test('呼び出し元：元素診断（開始・進み具合・完了・回答・申込ボタン・納得度・解析レポートの章）と邪眼（同じ＋完全解析のページ）', () => {
  const idx = read('index.html');
  assert.match(idx, /EdAnalytics\.start\('eti'\)/);
  assert.match(idx, /EdAnalytics\.progress\('eti'/);
  assert.match(idx, /EdAnalytics\.answers\('eti'/);
  assert.match(idx, /EdAnalytics\.ctaView\(aBtns, \{ diagnosis_type: 'eti', product_id: 'eti_analysis_v1'/);
  assert.match(idx, /EdAnalytics\.mountFeedback\(root\.querySelector\('#edFitBox'\), 'eti'\)/);
  assert.match(read('report.html'), /EdAnalytics\.sections\(root\.querySelectorAll\('\.sec'\)/);
  const app = read('jagan/app.mjs');
  for (const re of [/EdAnalytics\.start\('jagan'\)/, /EdAnalytics\.progress\('jagan'/, /EdAnalytics\.answers\('jagan', VERSION, ORDER, answers/, /EdAnalytics\.durationParams\('jagan'\)/, /mountFeedback\(box, 'jagan'\)/, /product_id: 'jagan_complete_v1', state: 'open'/]) assert.match(app, re);
  assert.match(read('jagan/report.mjs'), /EdAnalytics\.sections\(\$\('rpBody'\)/);
  assert.match(read('jagan/dipper.mjs'), /EdAnalytics\.sections\(\$\('dpBook'\)\.querySelectorAll\('\.dp-page'\)/);
});

test('プライバシーポリシー：回答を収集すること・個人を特定する情報と結び付けないこと・施行日を明記（「回答は送りません」の記述は残さない）', () => {
  const p = read('privacy.html');
  assert.match(p, /診断の回答・結果の傾向/);
  assert.match(p, /個人を特定する情報と結び付けずに、統計的な分析に利用/);
  assert.match(p, /施行日：2026年11月17日/);
  assert.ok(!/診断の回答・メールアドレスは、送りません/.test(p));
});

test('回答の並びの資料（docs/ga4_answer_order.json）が、送る並び（元素診断＝採点の正規順、邪眼＝表示順）と一致する', async () => {
  const doc = JSON.parse(read('docs/ga4_answer_order.json'));
  const ctx = { window: {}, console };
  vm.createContext(ctx);
  vm.runInContext(read('js/ETI_v2_QUESTIONS_100.js') + ';this.__Q=ETI_V2_QUESTIONS;this.__M=ETI_V2_META;', ctx);
  vm.runInContext(read('js/eti_v2_engine.js') + ';this.__E=(typeof ETIv2!=="undefined"?ETIv2:window.ETIv2);', ctx);
  assert.deepEqual(doc.eti.items.map((i) => i.id), plain(ctx.__E.getCanonicalOrder(ctx.__Q)));
  assert.equal(doc.eti.answer_set, ctx.__M.itemSetVersion);
  const { BUNDLE } = await import('../jagan/engine/data.mjs');
  assert.deepEqual(doc.jagan.items.map((i) => i.id), BUNDLE.items.display_order);
  assert.equal(doc.jagan.answer_set, BUNDLE.items.item_set_version);
});


test('checkoutRef：_ga と セッションの Cookie から参照を作る（GS1・GS2 の両方）。Cookie が無ければ null', () => {
  const local = memStore();
  const mk = (cookie, search = '') => {
    const window = { sessionStorage: memStore(), localStorage: local };
    const ctx = { window, location: { hostname: 'element-diagnosis-five.vercel.app', origin: 'https://element-diagnosis-five.vercel.app', pathname: '/', search },
      document: { referrer: '', cookie, head: { appendChild() {} }, createElement() { return {}; } }, URLSearchParams };
    vm.createContext(ctx); vm.runInContext(read('js/ga.js'), ctx);
    return window;
  };
  assert.equal(mk('_ga=GA1.1.987654321.1700000000; _ga_FDN7NYZW9D=GS1.1.1731700000.3.1.1731700100.0.0.0').EdAnalytics.checkoutRef('result'), 'ga1-987654321-1700000000-1731700000-0-result');
  assert.equal(mk('_ga=GA1.1.1.2; _ga_FDN7NYZW9D=GS2.1.s1731700222$o4$g1').EdAnalytics.checkoutRef('mypage_latest'), 'ga1-1-2-1731700222-0-mypage_latest');
  assert.equal(mk('_ga=GA1.1.1.2').EdAnalytics.checkoutRef('Bad Source!'), 'ga1-1-2--0-');
  assert.equal(mk('').EdAnalytics.checkoutRef('result'), null);
  // 内部の印
  mk('', '?ed_internal=1');
  assert.equal(mk('_ga=GA1.1.1.2').EdAnalytics.checkoutRef('result'), 'ga1-1-2--1-result');
  const GR = require('../lib/ga-ref');
  assert.ok(GR.valid(mk('_ga=GA1.1.987654321.1700000000; _ga_FDN7NYZW9D=GS1.1.1731700000.3.1').EdAnalytics.checkoutRef('result')), 'サーバーの検査と同じ形');
});

test('決済・ログインから戻った時の参照元は流入元にしない（ignore_referrer）。ほかの参照元はそのまま', () => {
  const mk = (referrer) => {
    const window = { sessionStorage: memStore(), localStorage: memStore() };
    const ctx = { window, location: { hostname: 'element-diagnosis-five.vercel.app', origin: 'https://element-diagnosis-five.vercel.app', pathname: '/jagan/report', search: '' },
      document: { referrer, cookie: '', head: { appendChild() {} }, createElement() { return {}; } }, URLSearchParams };
    vm.createContext(ctx); vm.runInContext(read('js/ga.js'), ctx);
    return plain(window.dataLayer.find((a) => a[0] === 'config')[2]);
  };
  for (const r of ['https://checkout.stripe.com/c/pay/cs_live_x', 'https://www.paypay.ne.jp/x', 'https://akivoobkqcnqvdumxtmg.supabase.co/auth/v1/callback', 'https://accounts.google.com/o/oauth2', 'https://api.x.com/oauth']) {
    const c = mk(r);
    assert.equal(c.ignore_referrer, 'true', r); assert.equal(c.page_referrer, '', r);
  }
  for (const r of ['https://t.co/abc', 'https://x.com/someone', 'https://www.google.com/']) {
    const c = mk(r);
    assert.equal(c.ignore_referrer, undefined, r); assert.ok(c.page_referrer.startsWith('https://'), r);
  }
});
