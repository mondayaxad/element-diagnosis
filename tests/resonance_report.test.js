// 共鳴診断｜人物像レポート（Phase C の C-1。販売 OFF）の試験：lib/resonance_report_v1.js
//   設計書 docs/eti-mini/phase_c/共鳴診断_PhaseC_設計指示書_v1.md §7「必須テスト」のうち、C-1 で確かめられるもの
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const R = require('../lib/resonance_report_v1.js');
const PROTO = require('../js/eti_v2_prototypes.js');
const CHARS = require('../js/characters118_v2_1.js');
const MAP = require('../js/eti_mini_auto_map_v1.js');
const E = ['炎', '水', '氷', '雷', '風', '岩', '草'], W = ['片手剣', '両手剣', '長柄', '法器', '弓'];
const N = ['モンド', '璃月', '稲妻', 'スメール', 'フォンテーヌ', 'ナタ', 'スネージナヤ', 'ナドクライ'];
const ALL = []; for (const element of E) for (const weapon of W) for (const nation of N) ALL.push({ element, weapon, nation });
const PURCHASE = { orderId: '00000000-0000-4000-8000-000000000000', createdAt: '2026-11-07T00:00:00.000Z' };

function engine() {
  const ctx = {}; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(['js/ETI_v2_QUESTIONS_100.js', 'js/eti_v2_prototypes.js', 'js/eti_v2_engine.js'].map(read).join('\n;\n') + ';globalThis.__E = { ETIv2, ETI_V2_META };', ctx);
  return ctx.__E;
}

test('1. 280 回答すべてが固定割当表と同じ人物を返し、66名がそれぞれ 4〜5 回', () => {
  const n = {};
  for (const a of ALL) {
    const m = R.modelVectors(a);
    assert.equal(m.mirror, MAP.rows[`${a.element}|${a.weapon}|${a.nation}`]);
    n[m.mirror] = (n[m.mirror] || 0) + 1;
  }
  assert.equal(Object.keys(n).length, 66);
  for (const [k, v] of Object.entries(n)) assert.ok(v === 4 || v === 5, k);
  assert.throws(() => R.modelVectors({ element: '光', weapon: '弓', nation: 'モンド' }), /INVALID_ANSWERS/);
});

test('2. 代表モデルの 5/5/10 軸は正本（eti_v2_prototypes）から、人物は ETI-CHAR-2.1.0 から再現される。軸の並びは本家 ETI_V2_META と同じ', () => {
  const { ETI_V2_META } = engine();
  assert.deepEqual(Array.from(ETI_V2_META.personalityAxes), R.AXES.persona);
  assert.deepEqual(Array.from(ETI_V2_META.styleAxes), R.AXES.style);
  assert.deepEqual(Array.from(ETI_V2_META.valueAxes), R.AXES.values);
  for (const a of ALL) {
    const m = R.modelVectors(a), ch = CHARS.find((c) => c.name === m.mirror);
    assert.deepEqual(m.you.persona, PROTO.ELEMENT_PROTOTYPES_V2[a.element]);
    assert.deepEqual(m.you.style, PROTO.WEAPON_PROTOTYPES_V2[a.weapon]);
    assert.deepEqual(m.you.values, PROTO.NATION_PROTOTYPES_V2[a.nation]);
    assert.deepEqual(m.char, { persona: ch.personality, style: ch.style, values: ch.values });
  }
});

test('3. pSim・sSim は RMSE、vSim だけ平均中心化コサイン。本家 computeMirrorV2 と 280 件で一致し、零ベクトルは 0.5', () => {
  const { ETIv2, ETI_V2_META } = engine();
  for (const a of ALL) {
    const m = R.modelVectors(a), an = R.analyze(m);
    const ch = CHARS.find((c) => c.name === m.mirror);
    const [row] = ETIv2.computeMirrorV2({ personality: m.you.persona, style: m.you.style, values: m.you.values }, [ch], ETI_V2_META);
    assert.equal(an.sims.persona, row.pSim);
    assert.equal(an.sims.style, row.sSim);
    assert.equal(an.sims.values, row.vSim);
    assert.ok(Math.abs(an.mirrorRef * 100 - row.mirrorScoreRaw) < 1e-9);
  }
  const flat = Object.fromEntries(R.AXES.values.map((k) => [k, 50]));
  assert.equal(R._internal.vSimOf(flat, CHARS[0].values), 0.5);
  const [z] = ETIv2.computeMirrorV2({ personality: CHARS[0].personality, style: CHARS[0].style, values: flat }, [CHARS[0]], ETI_V2_META);
  assert.equal(z.vSim, 0.5);
});

test('4. 図は実際の値から描き、見本のダミー図とは別物。図に数字（目盛り・値）を出さない', () => {
  const html = read('resonance.html');
  const seen = new Set();
  for (const a of ALL) {
    const s = R.buildSnapshot(a, PURCHASE, { allowMissing: true });
    const svg = R.renderFigures(s.figures);
    for (const [k, v] of Object.entries(svg)) {
      const texts = [...v.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((x) => x[1]);
      for (const t of texts) assert.doesNotMatch(t, /[0-9０-９%％]/, `${k}: ${t}`);
      assert.doesNotMatch(v, /<title|data-value|aria-valuenow/);
      assert.ok(!html.includes(v));
    }
    seen.add(svg.persona + svg.style + svg.values);
    // 選んだ元素は距離 0 で先頭（設計書§3-4 の既知の性質）
    assert.equal(s.figures.symbols.elements[0].key, a.element);
    assert.equal(s.figures.symbols.elements[0].bar, 1);
  }
  assert.ok(seen.size > 200, String(seen.size)); // 人ごとに図が変わる（同じ代表モデル×同じ人物の組み合わせだけ同じ）
});

test('5. 非購入者は有料の本文・描画データを取れない：計算器は lib/（公開しない）にあり、公開ページ・公開 API から読まれていない', () => {
  const B = require('../scripts/build-public.js');
  const forb = read('scripts/build-public.js');
  assert.match(forb, /\^\(docs\|tests\|prototypes\|lib\|scripts\|api/);
  assert.ok(!B.PUBLIC_FILES.some((f) => /resonance_report/.test(f)));
  for (const f of B.PUBLIC_FILES.filter((x) => /\.(html|js)$/.test(x) && fs.existsSync(path.join(ROOT, x)))) assert.doesNotMatch(read(f), /resonance_report/, f);
  for (const f of fs.readdirSync(path.join(ROOT, 'api')).filter((x) => /\.(m?js)$/.test(x))) assert.doesNotMatch(read('api/' + f), /resonance_report/, f);
});

test('6. 販売 OFF：共鳴診断の購入ボタンは押せず、Checkout を作る API は無い', () => {
  const html = read('resonance.html');
  assert.ok(html.includes('<button type="button" class="cta buy" id="buyBtn" disabled>'));
  assert.doesNotMatch(html, /checkout|stripe|fetch\(/i);
  assert.ok(!fs.readdirSync(path.join(ROOT, 'api')).some((f) => /resonance/i.test(f)));
  assert.doesNotMatch(read('api/complete-checkout.js'), /resonance/);
});

test('7. スナップショット：同じ入力なら同じ内容。再閲覧の表示は保存済みスナップショットだけから作る。金額・商品は固定、個人情報を持たない', () => {
  const a = { element: '氷', weapon: '法器', nation: 'ナドクライ' };
  const s1 = R.buildSnapshot(a, PURCHASE, { allowMissing: true }), s2 = R.buildSnapshot(a, PURCHASE, { allowMissing: true });
  assert.deepEqual(s1, s2);
  assert.equal(s1.schema_version, 'RESONANCE-REPORT-SNAPSHOT-1');
  assert.deepEqual(s1.input, a);
  assert.equal(s1.result.nation_display, 'ナド・クライ');
  assert.equal(s1.result.mirror_character, MAP.rows['氷|法器|ナドクライ']);
  assert.deepEqual(s1.purchase, { product_code: 'resonance_report_v1', amount_jpy: 500, currency: 'jpy', order_id: PURCHASE.orderId, created_at: PURCHASE.createdAt });
  assert.equal(s1.model.assignmentSha256, 'cf67efa6b5d3bbeaff67a2c36e69e45b266685b44df52dad4c8401714b5b4946');
  assert.match(s1.model.prototypeSha256, /^[0-9a-f]{64}$/);
  assert.doesNotMatch(JSON.stringify(s1), /email|mail|card|token|stripe|customer|name"\s*:\s*"(?!.)/i);
  // 表示は保存済みの値だけ：保存済みの図を書き換えると表示も変わる（その場で計算し直していない）
  const html1 = R.renderReportHtml(s1);
  const s3 = JSON.parse(JSON.stringify(s1)); s3.figures.persona.you = s3.figures.persona.you.map(() => 0); s3.text.persona = '保存済みの文';
  const html3 = R.renderReportHtml(s3);
  assert.notEqual(html1, html3);
  assert.ok(html3.includes('保存済みの文'));
  const src = R.renderReportHtml.toString() + R.renderFigures.toString();
  assert.doesNotMatch(src, /modelVectors|analyze\(|symbols\(|composeText|PROTO|CHARS/);
});

test('本文：辞書が無い所は〔未執筆〕で示して販売用には作れない。数値・一致率・「最も似る」などの言葉を出さない。章の順は人物名 → PERSONA → RESONANCE → …', () => {
  assert.throws(() => R.buildSnapshot({ element: '水', weapon: '法器', nation: 'フォンテーヌ' }, PURCHASE), (e) => e.code === 'DICTIONARY_INCOMPLETE' && e.missing.length > 0);
  const families = new Set();
  for (const a of ALL) {
    const s = R.buildSnapshot(a, PURCHASE, { allowMissing: true });
    s.draft_missing.forEach((k) => families.add(k.split(':')[0]));
    const all = Object.values(s.text).join('') + R.renderReportHtml(s).replace(/<svg[\s\S]*?<\/svg>/g, '');
    assert.doesNotMatch(all.replace(/〔未執筆：[^〕]*〕/g, '').split(R.DISCLAIMER).join(''), /[0-9０-９]+\s*(%|％|点|位)|一致率|類似度|最も似|最も近|一番高|精密|測定した結果です|診断します/);
    assert.ok(all.includes(R.DISCLAIMER));
  }
  assert.deepEqual([...families].sort(), Object.keys(R.DICT).sort()); // 不足辞書の一覧＝辞書の全種類
  // 辞書がそろえば〔未執筆〕は消え、同じ辞書なら同じ文
  const dict = Object.fromEntries(Object.keys(R.DICT).map((k) => [k, new Proxy({}, { get: (_, key) => `［${k}/${String(key)}］` })]));
  const full = R.buildSnapshot({ element: '水', weapon: '法器', nation: 'フォンテーヌ' }, PURCHASE, { dict });
  assert.ok(!('draft_missing' in full));
  assert.doesNotMatch(JSON.stringify(full.text), /未執筆/);
  assert.deepEqual(full.text, R.buildSnapshot({ element: '水', weapon: '法器', nation: 'フォンテーヌ' }, PURCHASE, { dict }).text);
  const order = R.CHAPTERS.map((c) => c[1]);
  assert.deepEqual(order, ['PERSONA', 'RESONANCE', 'STYLE', 'VALUES', 'SYMBOLS', 'JOURNEY']);
});

test('監査ファイル（280件）は計算器と一致している（作り直し忘れの検出）', () => {
  const rows = JSON.parse(read('docs/eti-mini/phase_c/audit_280.json'));
  assert.equal(rows.length, 280);
  for (const r of rows) {
    const [element, weapon, nation] = r.key.split('|');
    const an = R.analyze(R.modelVectors({ element, weapon, nation }));
    assert.equal(r.flat, an.flat, r.key);
    assert.deepEqual(r.common, an.common, r.key);
    assert.equal(r.pSim, +an.sims.persona.toFixed(4));
  }
});

test('辞書の雛形（ChatGPT へ渡す dictionary_template_v1.json）は計算器の辞書と同じキーで、280件に要るキーがすべてある', () => {
  const t = JSON.parse(read('docs/eti-mini/phase_c/dictionary_template_v1.json'));
  const fams = Object.keys(t).filter((k) => !k.startsWith('_'));
  assert.deepEqual(fams.sort(), Object.keys(R.DICT).sort());
  const need = new Set();
  for (const a of ALL) R.buildSnapshot(a, PURCHASE, { allowMissing: true }).draft_missing.forEach((k) => need.add(k));
  const have = new Set(fams.flatMap((f) => Object.keys(t[f]).map((k) => f + ':' + k)));
  assert.deepEqual([...need].sort(), [...have].sort());
  assert.equal(need.size, 456);
});
