// 完全解析の生成器（api/_complete/generate-report.js・api/_complete/rc1/）のテスト。外部へは接続しない。
//   実行: node --test tests/complete_report_generator.test.js
//   ブラウザ表示（320・390・1280px）は Playwright が無い環境では skip する。
//
// 代表 fixture（tests/fixtures/complete_report_F01.json）の HTML の SHA-256 を GOLDEN_SHA256 に固定している。
// 本文・テンプレート・素材を変えてこの値が変わった時は、差分をレビューしてから更新すること（安易に書き換えない）。
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

let chromium = null;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { ({ chromium } = require(p)); break; } catch (e) { /* 次を試す */ }
}

const ROOT = path.join(__dirname, '..');
const PROTO = path.join(ROOT, 'prototypes/core1_v4_result_driven');
const RC1 = path.join(ROOT, 'api/_complete/rc1');
const G = require('../api/_complete/generate-report');
const CE = require('../lib/complete-eligibility');
const CP = require('../lib/complete-payment');
const B = require('../scripts/build-public');
const { computeMaterials } = require('../scripts/complete-materials');
const eng = require('../api/_complete/rc1/src/engine').loadEngine();
const MENTOR_GOALS = require('../api/_complete/rc1/src/content/mentor-goals.json');
const FIXTURE = require('./fixtures/complete_report_F01.json').input;

// 代表 fixture の HTML の SHA-256（レビュー済みの値。変わったら差分レビューが必要）
// 2026-10-08 更新：f31ce716… → 8c5419b5…。差分レビュー：本文は同一（画像の埋め込み方を正規化し、冒頭の案内文を除いて
// 1,643行すべて一致）。変更は冒頭の案内文（スマートフォン向け）と、web.css（fit-to-width・画像の参照・紙面の余白）だけ。
// 2026-10-08 更新（判定規則4種の RC1 承認・CORE1-CONTENT-1.0.1）：8c5419b5… → 580923f8…。差分レビュー：生の HTML で4行・本文で4行だけ
// （P33 の版 DOMAIN-EDITORIAL-0.1.0 → 1.0.0、P34 の「今後、分布と安定性の検証が必要です」→「確立された心理尺度ではありません」、
// P34 の計算の注記の版と末尾を P33 の恒久的な注意書きへ、P39 の版の欄 DOMAIN-EDITORIAL-1.0.0・CONTENT-1.0.1）。他の 3,319 行は同一。
// 2026-10-09 更新（TEMPLATE-46P-WEB-1.0.1）：580923f8… → d0baa50d…。差分レビュー：画像を除いた生の HTML で36行（12 fixture すべて同じ36行）。
// 削除8行＝表紙の見出し「元素診断」・表紙の MODEL 行と「あなた｜日付｜46 ページ」行・P07 の（ETI-CHAR-2.1.0）・P08 の CORE1-HIDDEN-1.0.0・
// P33 の（CORE1-DOMAIN-EDITORIAL-1.0.0）・P34 の「計算・採用軸・版」と「版：…」・P39 の版の欄。追加は、その置き換え後の行と web.css の
// フッターの安全領域・表紙の欧文の CSS だけ。本文の文章・数値・順位は変えていない。
const GOLDEN_SHA256 = 'd0baa50d14dcbc5b53c8d4231ff94a432b7b6bde5a15e101b1c3688845ec14b9';
const GOAL_IDS = ['GOAL_VISIBLE_01', 'GOAL_BOUNDARY_01', 'GOAL_RELATION_01', 'GOAL_EXPLORE_01', 'GOAL_PACE_01'];
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const clone = (o) => JSON.parse(JSON.stringify(o));

// 回答から、index.html が保存するのと同じ保存値（v2_scores・v2_rankings・mirror_snapshot・encoded_answers）を作る
function savedFrom(answers, over = {}) {
  const res = eng.E.computeResultsV2(answers, { questions: eng.Q, meta: eng.META, elementPrototypes: eng.EP, weaponPrototypes: eng.WP, nationPrototypes: eng.NP });
  const mir = eng.resolver.computeMirror(res, 'ETI-MIRROR-2.1.0');
  return {
    answers: clone(answers),
    encodedAnswers: eng.E.encodeAnswersV2(answers, eng.Q),
    savedScores: { personality: res.personality, style: res.style, values: res.values, valuesCentered: res.valuesCentered },
    savedRankings: { element: res.elementRanking, weapon: res.weaponRanking, nation: res.nationRanking },
    mirrorSnapshot: eng.resolver.buildMirrorSnapshot(mir),
    versions: clone(FIXTURE.versions),
    mentorGoal: clone(FIXTURE.mentorGoal),
    diagnosedAt: FIXTURE.diagnosedAt,
    ...over,
  };
}
const protoFixtures = () => fs.readdirSync(path.join(PROTO, 'fixtures/answers')).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(PROTO, 'fixtures/answers', f), 'utf8')));
const fails = (fn, code) => assert.throws(fn, (e) => e instanceof G.ReportGenerationError && e.code === code, code);
const sections = (html) => html.split(/(?=<section class="page )/).slice(1).map((s) => s.replace(/<\/main>[\s\S]*$/, ''));
// 画像の書き方（prototypes は <img src="data:…">、Web 版は var(--img-N) の背景）を、同じ表記へそろえる
function normalizeImages(section, html) {
  const vars = Object.fromEntries([...html.matchAll(/--img-(\d+):url\("(data:image\/jpeg;base64,[A-Za-z0-9+/=]+)"\)/g)].map((m) => [m[1], sha(m[2]).slice(0, 16)]));
  return section
    .replace(/<img src="(data:image\/jpeg;base64,[A-Za-z0-9+/=]+)" alt="([^"]*)" data-asset="([^"]+)">/g, (_, uri, alt, file) => `[IMG ${file} ${alt} ${sha(uri).slice(0, 16)}]`)
    .replace(/<span class="img" role="img" aria-label="([^"]*)" data-asset="([^"]+)" style="background-image:var\(--img-(\d+)\)"><\/span>/g, (_, alt, file, n) => `[IMG ${file} ${alt} ${vars[n]}]`);
}

let base;
test.before(() => { base = G.generateCompleteReport(FIXTURE); });

// ================= 素材・移動の検証
test('素材ハッシュ（lib/complete-materials.json）がサーバー生成器の実ファイルと一致する', () => {
  assert.deepEqual(require('../lib/complete-materials.json'), computeMaterials());
  assert.equal(CP.MATERIALS.templateVersion, 'CORE1-TEMPLATE-46P-WEB-1.0.1');
  assert.equal(CP.MATERIALS.contentVersion, 'CORE1-CONTENT-1.0.1');
  assert.equal(base.contentSha256, CP.MATERIALS.contentSha256);
  assert.equal(base.templateSha256, CP.MATERIALS.templateSha256);
});

test('rc1 は prototypes の複製：Web 版で変えたファイル（追加1・変更3・削除3）と判定規則4種の承認（変更7）以外はバイト単位で同一（本文素材・算出・画像・正本エンジン）', () => {
  const walk = (dir, rel = '') => fs.readdirSync(path.join(dir, rel), { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? walk(dir, path.join(rel, d.name)) : [path.join(rel, d.name)]));
  const proto = new Set(['src', 'assets', 'vendor'].flatMap((d) => walk(PROTO, d)));
  const copy = new Set(['src', 'assets', 'vendor'].flatMap((d) => walk(RC1, d)));
  // 2026-10-08 判定規則4種の RC1 承認：版 1.0.0・TEXT-BANDS の定義の一元化・DOMAIN の同点順と注意書き（tests/complete_rules_rc1.test.js）
  const APPROVED_RULES = ['src/judgments.js', 'src/models/domains.js', 'src/content/axes.json', 'src/content/experiments.json',
    'src/content/pair-element-weapon.json', 'src/content/pair-element-nation.json', 'src/content/pair-weapon-nation.json'];
  const CHANGED = ['src/templates/report-46p.js', 'src/calculate-result.js', 'src/build-claims.js', ...APPROVED_RULES];
  const ADDED = ['src/templates/web.css'];
  const REMOVED = ['src/build-report.js', 'src/templates/viewer.js', 'src/templates/viewer.css']; // build-report.js は fixture から dist/ へ書き出す CLI（サーバーでは使わない）
  assert.deepEqual([...copy].filter((f) => !proto.has(f)).sort(), ADDED);
  assert.deepEqual([...proto].filter((f) => !copy.has(f)).sort(), REMOVED.sort());
  for (const f of copy) {
    if (ADDED.includes(f)) continue;
    const same = sha(fs.readFileSync(path.join(PROTO, f))) === sha(fs.readFileSync(path.join(RC1, f)));
    assert.equal(same, !CHANGED.includes(f), f);
  }
  // 正本エンジンの同梱物はリポジトリの js/ と同一
  const man = JSON.parse(fs.readFileSync(path.join(RC1, 'vendor/eti-js/MANIFEST.json'), 'utf8'));
  for (const [f, h] of Object.entries(man.files)) assert.equal(sha(fs.readFileSync(path.join(ROOT, f))), h, f);
});

// 判定規則4種の承認（2026-10-08）で変えた紙面：版の表記と P34 の注意書き。prototypes の紙面にこの置き換えだけを当てて比べる
const APPROVED_PAGE_EDITS = [
  [/DOMAIN-EDITORIAL-0\.1\.0/g, 'DOMAIN-EDITORIAL-1.0.0'],
  ['<span>今後、分布と安定性の検証が必要です</span>', '<span>確立された心理尺度ではありません</span>'],
  ['正式な心理尺度ではなく、本番公開前に回答分布と順位の安定性の検証が必要です。', '確立された心理尺度ではなく、能力値・才能量・人口比を示すものではありません。'],
];
// TEMPLATE-46P-WEB-1.0.1（2026-10-09）で変えた紙面：表紙の欧文見出し、表紙・P39 のメタ情報（診断日だけ）、紙面からの版の削除（P07・P08・P33・P34）
const WEB_101_EDITS = [
  [/<div>MODEL　[^<]*<\/div>\s*<div>あなた　｜　(\d{4}-\d{2}-\d{2})　｜　46 ページ<\/div>/g, '<div>診断日　$1</div>'],
  ['<div class="cover-label">元素診断</div>', '<div class="cover-label">ELEMENT DIAGNOSIS</div>'],
  ['ETI人物座標（ETI-CHAR-2.1.0）と資料タグ', 'ETI人物座標と資料タグ'],
  [/<p class="small">CORE1-HIDDEN-\d+\.\d+\.\d+。各領域/g, '<p class="small">各領域'],
  ['<b>ETI編集用派生指標（CORE1-DOMAIN-EDITORIAL-1.0.0）</b>', '<b>ETI編集用派生指標</b>'],
  ['<div class="sp-k">計算・採用軸・版</div>', '<div class="sp-k">計算・採用軸</div>'],
  [/。版：CORE1-DOMAIN-EDITORIAL-1\.0\.0。/g, '。'],
];
const approvedEdits = (s) => [...APPROVED_PAGE_EDITS, ...WEB_101_EDITS].reduce((t, [a, b]) => (a instanceof RegExp ? t.replace(a, b) : t.split(a).join(b)), s);
test('全12 fixture：Web 版の46ページは prototypes の紙面と同一（違いは P39 の ID・生成日・版の欄、画像の埋め込み方、判定規則4種の承認で変えた表記・同点順、1.0.1 の表紙・版の削除だけ）', () => {
  const P = {
    calc: require(path.join(PROTO, 'src/calculate-result')), claims: require(path.join(PROTO, 'src/build-claims')),
    content: require(path.join(PROTO, 'src/content-store')), tpl: require(path.join(PROTO, 'src/templates/report-46p')),
  };
  for (const fx of protoFixtures()) {
    const goalId = fx.input.mentor_goal ? fx.input.mentor_goal.goal_id : 'GOAL_PACE_01';
    const input = savedFrom(fx.input.answers, { mentorGoal: { ...FIXTURE.mentorGoal, goalId } });
    const web = G.generateCompleteReport(input).html;
    const g = MENTOR_GOALS.goals.find((x) => x.goal_id === goalId);
    const protoHtml = P.tpl.render(P.claims.buildClaims(P.calc.calculateResult({
      session_id: 'x', display_name: 'あなた', diagnosed_at: '2026-10-04T10:00:00+09:00', generated_at: '2026-10-04T10:00:00+09:00',
      answers: fx.input.answers, versions: { diagnosis: 'ETI-2.0', items: 'ETI-ITEM-2.0.0', scoring: 'ETI-SCORE-2.0.0', translation: 'ETI-TRANS-2.0.0', characters: 'ETI-CHAR-2.1.0', mirror: 'ETI-MIRROR-2.1.0' },
      mentor_goal: { goal_id: g.goal_id, label: g.label, selected_by: 'user', selected_at: FIXTURE.mentorGoal.selectedAt, deltas: g.deltas },
    })), P.content.loadContent());
    const a = sections(web).map((x) => normalizeImages(x, web));
    const b = sections(protoHtml).map((x) => normalizeImages(x, protoHtml));
    assert.ok(a.join('').includes('[IMG assets/elements/'), '画像の正規化');
    assert.equal(a.length, 46, fx.fixture_id);
    assert.equal(b.length, 46, fx.fixture_id);
    // ドメインの平均に同点がある fixture（F04）は、P34・P35 の並びが定義順に変わる（承認済み）。他は同点なし
    const D = P.calc.calculateResult({ session_id: 'x', display_name: 'x', diagnosed_at: '2026-10-04T10:00:00+09:00', generated_at: '2026-10-04T10:00:00+09:00',
      answers: fx.input.answers, versions: { diagnosis: 'ETI-2.0', items: 'ETI-ITEM-2.0.0', scoring: 'ETI-SCORE-2.0.0', translation: 'ETI-TRANS-2.0.0', characters: 'ETI-CHAR-2.1.0', mirror: 'ETI-MIRROR-2.1.0' } }).domains.items;
    const tied = new Set(D.map((d) => d.mean)).size < D.length;
    for (let i = 0; i < 46; i++) {
      if (tied && (i === 33 || i === 34)) {
        const order = ['understanding', 'integration', 'sustain', 'expression'];
        const sorted = [...D].sort((x, y) => (y.mean - x.mean) || (order.indexOf(x.key) - order.indexOf(y.key)));
        const lead = `平均の高い${sorted[0].label}を入口に、${sorted[1].label}、${sorted[2].label}へつながる順序で読みます。`;
        if (i === 34) assert.ok(a[i].includes(lead), `${fx.fixture_id} P35 は定義順`);
        assert.equal(fx.fixture_id, 'F04', '同点は F04 だけ');
        continue;
      }
      if (i === 38) {
        const strip = (s) => s.replace(/<div class="cp-meta">[\s\S]*?<\/div>/, '');
        assert.equal(strip(a[i]), strip(b[i]), `${fx.fixture_id} P39`);
        assert.match(b[i], /<span>ID　x<\/span>/);
        assert.doesNotMatch(a[i], /<span>ID|生成日/);
      } else {
        assert.equal(a[i], approvedEdits(b[i]), `${fx.fixture_id} P${i + 1}`);
      }
    }
  }
});

// ================= 46ページ・見出し・版
test('46ページ・順序・全ページの見出しが固定（目次とページ番号が一致）', () => {
  const html = base.html;
  assert.equal(base.pages, 46);
  const ids = [...html.matchAll(/<section class="page [^"]*" id="p(\d{2})" data-page="(\d+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(ids, Array.from({ length: 46 }, (_, i) => [i + 1, i + 1]));
  const toc = [...html.matchAll(/<li><a href="#p(\d{2})"><span>P(\d{2})<\/span>([^<]+)<\/a><\/li>/g)].map((m) => [m[1], m[2], m[3]]);
  assert.equal(toc.length, 46);
  toc.forEach(([href, num], i) => { assert.equal(Number(href), i + 1); assert.equal(Number(num), i + 1); });
  const titles = toc.map((t) => t[2]);
  // 結果に左右されない見出し（固定の章）
  const FIXED = { 39: 'YOUR COMPASS', 40: '元素辞典', 41: '武器種辞典', 42: '国家辞典', 43: 'PERSONALITY辞典', 44: 'STYLE辞典', 45: 'VALUES辞典 I', 46: 'VALUES辞典 II' };
  for (const [n, t] of Object.entries(FIXED)) assert.equal(titles[n - 1], t, `P${n}`);
  assert.equal(new Set(titles).size, titles.length, '見出しは重複しない');
  for (let i = 1; i <= 46; i++) assert.match(html, new RegExp(`<span class="p-count">${String(i).padStart(2, '0')} / 46</span>`));
  // 見出しの並びは代表 fixture で固定（ページの増減・入れ替えを検出する）
  assert.equal(sha(titles.join('\n')), sha(sections(base.html).map((s, i) => titles[i]).join('\n')));
});

test('RC1 の6つの版が完全一致しなければ生成しない（1つでも違えば version_mismatch）', () => {
  for (const k of Object.keys(CE.RC1_REQUIRED_VERSIONS)) {
    fails(() => G.generateCompleteReport({ ...FIXTURE, versions: { ...FIXTURE.versions, [k]: 'X' } }), 'version_mismatch');
  }
  fails(() => G.generateCompleteReport({ ...FIXTURE, versions: { ...FIXTURE.versions, character_profile_version: 'ETI-CHAR-2.0.1', mirror_model_version: 'ETI-MIRROR-2.0.2' } }), 'version_mismatch');
  fails(() => G.generateCompleteReport({ ...FIXTURE, versions: { ...FIXTURE.versions, extra: 'x' } }), 'invalid_versions');
  const { mirror_model_version: _m, ...five } = FIXTURE.versions;
  fails(() => G.generateCompleteReport({ ...FIXTURE, versions: five }), 'invalid_versions');
  // 版は DB・ハッシュ・manifest に残し、利用者向けの HTML には出さない（TEMPLATE-46P-WEB-1.0.1）
  assert.equal(base.templateVersion, 'CORE1-TEMPLATE-46P-WEB-1.0.1');
  assert.doesNotMatch(base.html, /(?:ETI|CORE1|ITEM|SCORE|TRANS|CHAR|MIRROR|HIDDEN|MENTOR|DOMAIN-EDITORIAL|CONTENT|TEMPLATE)-[0-9A-Z-]*\d+\.\d+/);
  assert.doesNotMatch(base.html.replace(/<style>[\s\S]*?<\/style>/g, ''), /MODEL　|版：|計算・採用軸・版/); // CSS の注記（「46ページ版：」など）は対象外
});

test('5つの MENTOR 目標それぞれで生成でき、目標の文言はサーバーのカタログから入る（結果は目標ごとに違う）', () => {
  const shas = new Set();
  for (const goalId of GOAL_IDS) {
    const r = G.generateCompleteReport({ ...FIXTURE, mentorGoal: { ...FIXTURE.mentorGoal, goalId } });
    const g = MENTOR_GOALS.goals.find((x) => x.goal_id === goalId);
    assert.equal(r.pages, 46, goalId);
    assert.ok(r.html.includes(g.label), goalId);
    assert.doesNotMatch(r.html, /サンプル用の仮/);
    assert.match(r.html, /あなたが選んだ方向/);
    shas.add(r.sha256);
  }
  assert.equal(shas.size, 5);
  fails(() => G.generateCompleteReport({ ...FIXTURE, mentorGoal: { ...FIXTURE.mentorGoal, goalId: 'GOAL_UNKNOWN_99' } }), 'unknown_mentor_goal');
  fails(() => G.generateCompleteReport({ ...FIXTURE, mentorGoal: { ...FIXTURE.mentorGoal, goalCatalogVersion: 'CORE1-MENTOR-GOALS-0.9.0' } }), 'mentor_catalog_mismatch');
  fails(() => G.generateCompleteReport({ ...FIXTURE, mentorGoal: { ...FIXTURE.mentorGoal, label: '<b>x</b>' } }), 'invalid_mentor_goal');
  fails(() => G.generateCompleteReport({ ...FIXTURE, mentorGoal: null }), 'mentor_goal_required');
});

// ================= 決定性・入力ハッシュ
test('同じ入力からは常にバイト単位で同じ HTML・SHA-256（golden hash）。時刻・乱数に依存しない', () => {
  const again = G.generateCompleteReport(clone(FIXTURE));
  assert.equal(Buffer.compare(Buffer.from(again.html), Buffer.from(base.html)), 0);
  assert.equal(base.sha256, sha(base.html));
  assert.equal(base.sha256, GOLDEN_SHA256, '代表 fixture の HTML が変わった：差分をレビューしてから GOLDEN_SHA256 を更新する');
  const realNow = Date.now;
  const realRandom = Math.random;
  try {
    Date.now = () => 4102444800000;
    Math.random = () => 0.123;
    assert.equal(G.generateCompleteReport(clone(FIXTURE)).sha256, base.sha256);
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
  }
  assert.equal(Object.keys(base).includes('generatedAt'), false);
});

test('入力を1つ変えると input hash と出力が変わる（回答1問・目標・診断日）。同じ日の別時刻は同じ', () => {
  const variants = [];
  const answers = clone(FIXTURE.answers);
  answers.Q050 = answers.Q050 === 2 ? 1 : answers.Q050 + 1;
  variants.push(['answer Q050', savedFrom(answers)]);
  variants.push(['mentor goal', { ...FIXTURE, mentorGoal: { ...FIXTURE.mentorGoal, goalId: 'GOAL_PACE_01' } }]);
  variants.push(['diagnosed date', { ...FIXTURE, diagnosedAt: '2026-10-05T01:00:00.000Z' }]);
  for (const [name, input] of variants) {
    const r = G.generateCompleteReport(input);
    assert.notEqual(r.inputSha256, base.inputSha256, name);
    assert.notEqual(r.sha256, base.sha256, name);
  }
  // 日本時間で同じ日付なら同じ（HTML に出るのは日付だけ）
  const sameDay = G.generateCompleteReport({ ...FIXTURE, diagnosedAt: '2026-10-04T14:59:00.000Z' });
  assert.equal(sameDay.sha256, base.sha256);
  assert.equal(sameDay.inputSha256, base.inputSha256);
  // 目標の選択時刻は HTML に出ない（入力ハッシュにも入れない）
  const otherSel = G.generateCompleteReport({ ...FIXTURE, mentorGoal: { ...FIXTURE.mentorGoal, selectedAt: '2026-10-06T00:00:00Z' } });
  assert.equal(otherSel.sha256, base.sha256);
  // 入力ハッシュは決済（Webhook）が complete_reports.input_sha256 に保存する値と同じ規則
  assert.equal(base.inputSha256, CP.inputSha256({ encodedAnswers: FIXTURE.encodedAnswers, result: FIXTURE.versions,
    mentorGoalCatalogVersion: CE.MENTOR_CATALOG_VERSION, mentorGoalId: FIXTURE.mentorGoal.goalId, diagnosedDate: CP.jstDate(FIXTURE.diagnosedAt) }));
  assert.match(base.html, /2026-10-04/);
  // HTML の診断日とハッシュの診断日は同じ関数（jstIso → jstDate）から作る。UTC の日付境界をまたぐ値
  assert.equal(CP.jstIso('2026-10-03T15:00:00Z'), '2026-10-04T00:00:00+09:00');
  assert.equal(CP.jstIso('2026-10-03T15:00:00+00:00'), '2026-10-04T00:00:00+09:00');
  assert.equal(CP.jstIso('2026-10-04T08:59:59.999+09:00'), '2026-10-04T08:59:59+09:00');
  assert.equal(CP.jstDate('2026-10-03T14:59:59Z'), '2026-10-03');
  for (const bad of ['2026-10-04', 'yesterday', '', null, 1791200000000]) assert.equal(CP.jstIso(bad), null, String(bad));
  const edge = G.generateCompleteReport({ ...FIXTURE, diagnosedAt: '2026-10-03T15:00:00Z' });
  assert.match(edge.html, /<div class="cover-meta">\s*<div>診断日　2026-10-04<\/div>\s*<\/div>/);
  assert.match(edge.html, /<span>診断日　2026-10-04<\/span>/);
  assert.equal(edge.inputSha256, base.inputSha256, '同じ JST の日付なら同じ入力ハッシュ');
  const prev = G.generateCompleteReport({ ...FIXTURE, diagnosedAt: '2026-10-03T14:59:59Z' });
  assert.match(prev.html, /<span>診断日　2026-10-03<\/span>/);
  assert.notEqual(prev.inputSha256, base.inputSha256);
});

// ================= 入力の検証（保存値との一致・禁止項目）
test('保存済みの結果と正本の再計算が一致しなければ生成しない（スコア・順位・MIRROR・診断コード）', () => {
  const s = clone(FIXTURE.savedScores);
  s.personality.E += 1;
  fails(() => G.generateCompleteReport({ ...FIXTURE, savedScores: s }), 'saved_scores_mismatch');
  const vc = clone(FIXTURE.savedScores);
  vc.valuesCentered[Object.keys(vc.valuesCentered)[0]] += 0.5;
  fails(() => G.generateCompleteReport({ ...FIXTURE, savedScores: vc }), 'saved_scores_mismatch');
  const r = clone(FIXTURE.savedRankings);
  [r.element[0], r.element[1]] = [r.element[1], r.element[0]];
  fails(() => G.generateCompleteReport({ ...FIXTURE, savedRankings: r }), 'saved_rankings_mismatch');
  const m = clone(FIXTURE.mirrorSnapshot);
  const sel = m.find((x) => x.selected);
  const other = m.find((x) => !x.selected);
  delete sel.selected;
  other.selected = true;
  other.selection = sel.selection;
  fails(() => G.generateCompleteReport({ ...FIXTURE, mirrorSnapshot: m }), 'saved_mirror_mismatch');
  const old = clone(FIXTURE.mirrorSnapshot);
  old.find((x) => x.selected).selection.mirror_model_version = 'ETI-MIRROR-2.0.2';
  fails(() => G.generateCompleteReport({ ...FIXTURE, mirrorSnapshot: old }), 'saved_mirror_mismatch');
  fails(() => G.generateCompleteReport({ ...FIXTURE, encodedAnswers: `${FIXTURE.encodedAnswers}x` }), 'saved_code_mismatch');
  // 回答を変えて保存値を変えない（ブラウザの保存値が改ざんされた場合）
  const answers = clone(FIXTURE.answers);
  answers.Q001 = answers.Q001 === 2 ? -2 : 2;
  assert.throws(() => G.generateCompleteReport({ ...FIXTURE, answers }), G.ReportGenerationError);
});

test('入力は決められた8項目だけ（メール・表示名・本文・ハッシュ・ID などの項目があれば生成しない）', () => {
  for (const extra of [{ email: 'a@example.test' }, { displayName: '山田' }, { html: '<p>x</p>' }, { inputSha256: 'a'.repeat(64) },
    { userId: '11111111-1111-4111-8111-111111111111' }, { diagnosisSessionId: '11111111-1111-4111-8111-111111111111' },
    { stripeCheckoutSessionId: 'cs_test_x' }, { scores: {} }, { narrative: 'x' }]) {
    fails(() => G.generateCompleteReport({ ...FIXTURE, ...extra }), 'invalid_input');
  }
  for (const k of G.INPUT_KEYS) {
    const { [k]: _drop, ...rest } = FIXTURE;
    fails(() => G.generateCompleteReport(rest), 'invalid_input');
  }
  const short = clone(FIXTURE.answers);
  delete short.Q100;
  fails(() => G.generateCompleteReport({ ...FIXTURE, answers: short }), 'invalid_answers');
  fails(() => G.generateCompleteReport({ ...FIXTURE, answers: { ...FIXTURE.answers, Q001: 3 } }), 'invalid_answers');
  fails(() => G.generateCompleteReport({ ...FIXTURE, answers: { ...FIXTURE.answers, Q101: 0 } }), 'invalid_answers');
  fails(() => G.generateCompleteReport({ ...FIXTURE, diagnosedAt: 'yesterday' }), 'invalid_diagnosed_at');
  fails(() => G.generateCompleteReport(null), 'invalid_input');
});

// ================= 出力の検査
test('出力：script・イベント属性・外部 URL・iframe・form・外部フォントなし。画像は data: だけ。CSP がある', () => {
  const html = base.html;
  assert.doesNotMatch(html, /<script|<\/script|<iframe|<form|<input|<button|<link|<object|<embed|<base\b|@import|@font-face/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /https?:\/\//i);
  assert.doesNotMatch(html, /\b(src|href)\s*=\s*["']?\/\//i);
  for (const href of html.match(/href="[^"]*"/g) || []) assert.match(href, /^href="#p\d{2}"$/, href);
  assert.doesNotMatch(html, /<img\b|\ssrc=/i);
  // 画像：data: の JPEG を CSS の --img-N に1回ずつ。同じ画像を2回埋め込まない。参照はすべて定義済み
  const uris = [...html.matchAll(/data:[a-z]+\/[^"')\s]+/gi)].map((m) => m[0]);
  assert.ok(uris.length >= 9 && uris.every((u) => /^data:image\/jpeg;base64,/.test(u)));
  assert.equal(new Set(uris).size, uris.length, '同じ画像の重複');
  const refs = [...html.matchAll(/var\(--img-(\d+)\)/g)].map((m) => m[1]);
  assert.equal(refs.length, 10, '表紙1＋詳細ページ9');
  assert.deepEqual([...new Set(refs)].sort(), [...html.matchAll(/--img-(\d+):url/g)].map((m) => m[1]).sort());
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/);
  assert.ok(csp);
  const directives = Object.fromEntries(csp[1].split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v.join(' ')]));
  assert.deepEqual(directives, {
    'default-src': "'none'", 'style-src': "'unsafe-inline'", 'img-src': 'data:', 'font-src': "'none'", 'script-src': "'none'",
    'connect-src': "'none'", 'frame-src': "'none'", 'form-action': "'none'", 'base-uri': "'none'",
  });
  assert.equal(html.indexOf('Content-Security-Policy') < html.indexOf('<style>'), true, 'CSP は style より前');
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
});

test('出力：メール・UUID・Stripe ID・診断コード・本名・ID・生成日・未置換の記号が無い。呼称は「あなた」', () => {
  const text = base.html.replace(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/g, '');
  assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  assert.doesNotMatch(text, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.doesNotMatch(text, /\b(cs|pi|ch|du|evt|price)_(test|live)_/);
  assert.ok(!text.includes(FIXTURE.encodedAnswers));
  assert.doesNotMatch(text, /complete-report|session_id|answers_hash|sha256:|生成日|サンプル（承認版）|CORE1-V4-AUDITED/);
  assert.doesNotMatch(text, /\$\{|\{\{|\}\}|\bundefined\b|\bNaN\b|\[object Object\]|>\s*null\s*</);
  // 表紙・P39 のメタ情報は「診断日 YYYY-MM-DD」だけ（呼称・ページ数・版を出さない）。本文の呼称は「あなた」
  assert.match(text, /<div class="cover-meta">\s*<div>診断日　2026-10-04<\/div>\s*<\/div>/);
  assert.match(text, /<div class="cp-meta"><span>診断日　2026-10-04<\/span><\/div>/);
  assert.match(text, /あなた/);
});

test('HTML エスケープ：カタログの目標文言に記号があってもエスケープされる', () => {
  const g = MENTOR_GOALS.goals.find((x) => x.goal_id === 'GOAL_PACE_01');
  const original = g.label;
  try {
    g.label = '速さ<b class="x">&"</b>';
    const r = G.generateCompleteReport({ ...FIXTURE, mentorGoal: { ...FIXTURE.mentorGoal, goalId: 'GOAL_PACE_01' } });
    assert.ok(r.html.includes('速さ&lt;b class=&quot;x&quot;&gt;&amp;&quot;&lt;/b&gt;'));
    assert.ok(!r.html.includes('速さ<b'));
    // イベント属性に見える文字列は、エスケープ済みでも出力の検査で止める（安全側）
    g.label = '速さ<b onmouseover="x">';
    fails(() => G.generateCompleteReport({ ...FIXTURE, mentorGoal: { ...FIXTURE.mentorGoal, goalId: 'GOAL_PACE_01' } }), 'forbidden_event_handler');
  } finally {
    g.label = original;
  }
});

test('出力の検査は違反を見つけると生成を止める（script・イベント・外部 URL・記号・識別子・ページ数・順序・CSP・最大サイズ）', () => {
  const html = base.html;
  const at = html.indexOf('</main>');
  const inject = (s) => html.slice(0, at) + s + html.slice(at);
  const cases = [
    [inject('<script>x</script>'), 'forbidden_script'],
    [inject('<img src="data:image/jpeg;base64,AA" onerror="x">'), 'forbidden_event_handler'],
    [inject('<p style="background:url(https://evil.example/a.png)">x</p>'), 'forbidden_external_url'],
    [inject('<a href="//evil.example">x</a>'), 'forbidden_external_url'],
    [inject('<iframe></iframe>'), 'forbidden_iframe'],
    [inject('<form></form>'), 'forbidden_form'],
    [inject('<style>@import "x.css";</style>'), 'forbidden_css_import'],
    [inject('<p>${x}</p>'), 'unreplaced_placeholder'],
    [inject('<p>undefined</p>'), 'unreplaced_placeholder'],
    [inject('<p>NaN</p>'), 'unreplaced_placeholder'],
    [inject('<p>a@example.test</p>'), 'identifier_email'],
    [inject('<p>11111111-1111-4111-8111-111111111111</p>'), 'identifier_uuid'],
    [inject('<p>cs_test_abcdef</p>'), 'identifier_stripe_id'],
    [inject(`<p>${FIXTURE.encodedAnswers}</p>`), 'identifier_diagnosis_code'],
    [inject('<img src="x.jpg">'), 'image_not_inline'],
    [inject(`<style>:root{--img-99:url("${html.match(/data:image\/jpeg;base64,[A-Za-z0-9+/=]+/)[0]}");}</style>`), 'image_duplicated'],
    [inject('<span style="background-image:var(--img-77)"></span>'), 'image_reference'],
    [html.replace(/<section class="page [^"]*" id="p46"[\s\S]*?<\/section>/, ''), 'page_count'],
    [html.replace('id="p02" data-page="2" aria-label="P02"', 'id="p03" data-page="3" aria-label="P03"'), 'page_order'],
    [html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, ''), 'csp_missing'],
    [inject(`<p>${'あ'.repeat(Math.ceil(G.MAX_HTML_BYTES / 3))}</p>`), 'html_too_large'],
  ];
  for (const [h, code] of cases) fails(() => G.inspectHtml(h, FIXTURE), code);
  assert.deepEqual(G.inspectHtml(html, FIXTURE), { bytes: base.bytes, pages: 46 });
  assert.ok(base.bytes < G.MAX_HTML_BYTES, `${base.bytes}`);
});

test('全12 fixture で生成でき、大きさは上限の範囲内（最大・最小を記録）', () => {
  const sizes = protoFixtures().map((fx) => {
    const goalId = fx.input.mentor_goal ? fx.input.mentor_goal.goal_id : 'GOAL_PACE_01';
    const r = G.generateCompleteReport(savedFrom(fx.input.answers, { mentorGoal: { ...FIXTURE.mentorGoal, goalId } }));
    assert.equal(r.pages, 46, fx.fixture_id);
    return r.bytes;
  });
  assert.ok(Math.max(...sizes) < G.MAX_HTML_BYTES);
  assert.ok(Math.min(...sizes) > 300 * 1024);
});

// ================= 公開・配置
test('生成器・本文素材・画像は静的公開されない（dist に出ない。API からはサーバー内で読み込むだけ）', () => {
  const out = path.join(fs.mkdtempSync(path.join(require('os').tmpdir(), 'ed-gen-')), 'dist');
  const r = B.build({ outDir: out });
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.files.filter((f) => /^(api|lib|prototypes|scripts)\//.test(f) || /mentor-goals|report-46p|complete-materials|eti-js/.test(f)), []);
  assert.equal(r.files.some((f) => f.includes('_complete')), false);
  // api/_complete は関数の入口ではない（Vercel は _ で始まるものを関数にしない）。生成器は lib/complete-report-job.js 経由で
  // Webhook・状態確認の関数から読み込まれる（サーバー内だけ。dist には出ない）
  const traced = B.traceApiImports().files;
  assert.ok(traced.includes('api/_complete/generate-report.js'));
  assert.deepEqual(B.apiFilesExposed(out, traced), []);
  assert.deepEqual(B.forbiddenIn(['api/_complete/generate-report.js']).length, 1);
});

test('状態は RC1 candidate / sales closed（販売承認済みの本文として扱わない）', () => {
  assert.equal(base.releaseStatus, 'RC1 candidate / sales closed');
  assert.equal(base.generatorRelease, 'COMPLETE-RC1');
});

// ================= 紙面のはみ出し（サーバー版・全12 fixture × 46ページ）
const MIN_SLACK_PX = 24; // 中身の最下端から本文枠の下端までの余裕（フォント環境の違いを見込む）
const fixtureInputs = () => protoFixtures().map((fx) => [fx.fixture_id, savedFrom(fx.input.answers,
  { mentorGoal: { ...FIXTURE.mentorGoal, goalId: fx.input.mentor_goal ? fx.input.mentor_goal.goal_id : 'GOAL_PACE_01' } })]);

// 1ページごとに：ページの高さ、中身の自然な高さでの余裕（margin-top:auto で下へ寄せた分を除く）、切り取り、横のはみ出し、重なり
async function measurePages(page) {
  return page.evaluate(() => {
    const inners = [...document.querySelectorAll('.page .page-inner')];
    const full = inners.map((i) => i.getBoundingClientRect().height);
    const pageH = [...document.querySelectorAll('.page')].map((p) => Math.round(p.getBoundingClientRect().height));
    const clipped = inners.map((inner) => [...inner.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      return (cs.overflow === 'hidden' || cs.overflowY === 'hidden') && el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 8
        && !el.matches('.mb-t,.sqbar,.ptrack,.rbar,.dc-bar,.dma-bar,.nv-bar,.mv-bar,.td-img,.cover-img');
    }).map((el) => String(el.className)).slice(0, 3));
    const st = document.createElement('style');
    st.textContent = '.page-inner{bottom:auto !important;flex:0 0 auto !important}'; // 本文枠を中身の自然な高さにする（Web 版 1.0.1 は縦の流れで本文枠を伸ばすため、伸びも止める）
    document.head.appendChild(st);
    const rows = inners.map((inner, k) => {
      const ib = inner.getBoundingClientRect();
      let maxB = ib.top;
      let worst = '';
      inner.querySelectorAll('*').forEach((el) => { const r = el.getBoundingClientRect(); if (!r.width && !r.height) return; if (r.bottom > maxB) { maxB = r.bottom; worst = String(el.className || el.tagName); } });
      return { id: inner.closest('.page').id, slack: Math.round(full[k] - (maxB - ib.top)), worst: worst.slice(0, 30), h: pageH[k], clipped: clipped[k] };
    });
    st.remove();
    return rows;
  });
}

test('はみ出し：サーバー版の全12 fixture・46ページで、中身が本文枠に24px以上の余裕で収まり、切り取りなし（A4 の高さは不変）', { skip: !chromium && 'Playwright がありません', timeout: 600000 }, async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
    let worst = null;
    for (const [id, input] of fixtureInputs()) {
      await page.setContent(G.generateCompleteReport(input).html, { waitUntil: 'load' });
      const rows = await measurePages(page);
      assert.equal(rows.length, 46, id);
      for (const r of rows) {
        assert.ok(Math.abs(r.h - 1123) <= 2, `${id} ${r.id} の高さ ${r.h}`);
        assert.deepEqual(r.clipped, [], `${id} ${r.id} 切り取り`);
        assert.ok(r.slack >= MIN_SLACK_PX, `${id} ${r.id} 余裕 ${r.slack}px（${r.worst}）`);
        if (!worst || r.slack < worst.slack) worst = { id, ...r };
      }
    }
    assert.ok(worst.slack >= MIN_SLACK_PX);
  } finally {
    await browser.close();
  }
});

test('回帰：F05 の P08（HIDDEN SHAPE TOP10）の下端の図が本文枠に24px以上の余裕で収まる（以前は16px はみ出し）', { skip: !chromium && 'Playwright がありません' }, async () => {
  const [, input] = fixtureInputs().find(([id]) => id === 'F05');
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 1400 } });
    await page.setContent(G.generateCompleteReport(input).html, { waitUntil: 'load' });
    const p08 = (await measurePages(page)).find((r) => r.id === 'p08');
    assert.ok(p08.slack >= MIN_SLACK_PX, `F05 P08 余裕 ${p08.slack}px`);
    const shape = await page.evaluate(() => {
      const inner = document.querySelector('#p08 .page-inner').getBoundingClientRect();
      const demo = document.querySelector('#p08 .shape-demo').getBoundingClientRect();
      const foot = document.querySelector('#p08 .p-foot').getBoundingClientRect();
      return { demoBottom: demo.bottom, innerBottom: inner.bottom, footTop: foot.top };
    });
    assert.ok(shape.demoBottom <= shape.innerBottom, '図が本文枠の中');
    assert.ok(shape.demoBottom <= shape.footTop, '図がフッターに重ならない');
  } finally {
    await browser.close();
  }
});

// ================= フッターの安全領域（TEMPLATE-46P-WEB-1.0.1）
// Safari 実機で P03 の本文がフッターに重なった（2026-10-09）。紙面を「本文 → 安全領域 → フッター」の縦の流れにした。
// 座標で、本文枠の中のすべての要素の下端が、フッターの上端より 1.5mm（--foot-safe）以上 上にあることを確かめる。
const PX_PER_MM = 793.7 / 210;
const FOOT_SAFE_PX = 1.5 * PX_PER_MM - 0.5; // 端数の誤差を 0.5px 見込む
const STRESS_CSS = '<style>.page-inner p, .page-inner li, .page-inner span, .page-inner div { letter-spacing: .08em !important; } .page-inner p { line-height: 2.05 !important; }</style>';
async function measureFooter(page) {
  return page.evaluate(() => [...document.querySelectorAll('section.page')].map((pg) => {
    const pr = pg.getBoundingClientRect(); const k = pr.width / 793.7; // zoom で縮小された表示を紙面の CSS px に戻す
    const foot = pg.querySelector('.p-foot').getBoundingClientRect();
    let maxB = -Infinity; let who = '';
    pg.querySelector('.page-inner').querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect(); if (!r.width && !r.height) return;
      if (r.bottom > maxB) { maxB = r.bottom; who = String(el.className || el.tagName).slice(0, 30); }
    });
    return { id: pg.id, gap: (foot.top - maxB) / k, footInPage: foot.bottom <= pr.bottom + 0.5 && foot.top >= pr.top, h: pr.height / k, top: pr.top, bottom: pr.bottom, who };
  }));
}
async function footerRun(widths, inputs, { stress = false } = {}) {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const rows = [];
  try {
    for (const width of widths) {
      const mobile = width < 840;
      const ctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      const page = await ctx.newPage();
      for (const [id, input] of inputs) {
        let html = G.generateCompleteReport(input).html;
        if (stress) html = html.replace('</head>', `${STRESS_CSS}</head>`);
        await page.setContent(html, { waitUntil: 'load' });
        const m = await measureFooter(page);
        assert.equal(m.length, 46, `${id} ${width}px`);
        for (let i = 1; i < m.length; i++) assert.ok(m[i].top >= m[i - 1].bottom - 0.5, `${id} ${width}px ${m[i].id} が前のページに重なる`);
        for (const r of m) rows.push({ fx: id, width, ...r });
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  return rows;
}

test('フッターの安全領域：全12 fixture × 46ページ × 320・390・1280px で、本文の最下端がフッターの上端より 1.5mm 以上 上にある（座標）', { skip: !chromium && 'Playwright がありません', timeout: 900000 }, async () => {
  const rows = await footerRun([320, 390, 1280], fixtureInputs());
  assert.equal(rows.length, 12 * 46 * 3);
  for (const r of rows) {
    assert.ok(r.gap >= FOOT_SAFE_PX, `${r.fx} ${r.width}px ${r.id}：本文の下端とフッターの間 ${r.gap.toFixed(1)}px（${r.who}）`);
    assert.ok(r.footInPage, `${r.fx} ${r.width}px ${r.id}：フッターが紙面の外`);
    assert.ok(r.h >= 1122, `${r.fx} ${r.width}px ${r.id}：紙面の高さ ${r.h.toFixed(1)}px が A4 より低い`);
  }
  // 原寸（1280px）では、全ページが A4 の高さのまま（紙面が伸びるのは、縮小表示で文字の折り返しが長くなった時だけ）
  for (const r of rows.filter((x) => x.width === 1280)) assert.ok(Math.abs(r.h - 1123) <= 2, `${r.fx} ${r.id} の高さ ${r.h}`);
});

test('フッターの安全領域：overflow で隠さない（Web 版の CSS は、本文枠・フッター・紙面に overflow を足していない）', () => {
  const css = fs.readFileSync(path.join(RC1, 'src/templates/web.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const block = css.slice(css.indexOf(':root { --foot-bottom'));
  assert.match(block, /\.page \{ height: auto; min-height: var\(--page-h\); display: flex; flex-direction: column; \}/);
  assert.match(block, /\.p-foot \{ position: relative;[^}]*margin: var\(--foot-safe\) var\(--pad-x\) var\(--foot-bottom\);/);
  assert.doesNotMatch(block, /overflow|clip|max-height|text-overflow|line-clamp/);
});

for (const pid of ['p03', 'p08']) {
  test(`回帰：F05 の ${pid.toUpperCase()} は 320・390・1280px で本文とフッターが重ならない（文字の幅・行間を広げても重ならない）`, { skip: !chromium && 'Playwright がありません', timeout: 300000 }, async () => {
    const input = fixtureInputs().filter(([id]) => id === 'F05');
    for (const stress of [false, true]) {
      const rows = (await footerRun([320, 390, 1280], input, { stress })).filter((r) => r.id === pid);
      assert.equal(rows.length, 3);
      for (const r of rows) assert.ok(r.gap >= FOOT_SAFE_PX, `F05 ${pid} ${r.width}px stress=${stress}：${r.gap.toFixed(1)}px（${r.who}）`);
    }
  });
}

// ================= ブラウザ表示（JS なし・CSP あり）
test('表示：320・390px はページ全体を画面幅に縮小（横スクロールなし・比率と順序を維持）、1280px は原寸。目次で移動でき、拡大を禁止しない', { skip: !chromium && 'Playwright がありません', timeout: 300000 }, async () => {
  const vp = base.html.match(/<meta name="viewport" content="([^"]+)">/)[1];
  assert.equal(vp, 'width=device-width, initial-scale=1, viewport-fit=cover');
  assert.doesNotMatch(vp, /user-scalable|maximum-scale|minimum-scale/);
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  try {
    for (const width of [320, 390, 1280]) {
      const mobile = width < 840;
      const ctx = await browser.newContext({ viewport: { width, height: 800 }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
      const page = await ctx.newPage();
      const messages = [];
      page.on('console', (m) => messages.push(m.text()));
      const requests = [];
      page.on('request', (r) => { if (!r.url().startsWith('data:')) requests.push(r.url()); });
      await page.setContent(base.html, { waitUntil: 'load' });
      const m = await page.evaluate(async () => {
        const de = document.documentElement;
        const pages = [...document.querySelectorAll('section.page')].map((p) => p.getBoundingClientRect());
        let overlap = 0;
        for (let i = 1; i < pages.length; i++) if (pages[i].top < pages[i - 1].bottom - 0.5) overlap += 1;
        const imgs = [...document.querySelectorAll('.img[role="img"]')];
        const loaded = await Promise.all(imgs.map((el) => new Promise((resolve) => {
          const url = getComputedStyle(el).backgroundImage.replace(/^url\("?|"?\)$/g, '');
          if (!url.startsWith('data:image/jpeg;base64,')) { resolve(false); return; }
          const im = new Image();
          im.onload = () => resolve(im.naturalWidth > 0);
          im.onerror = () => resolve(false);
          im.src = url;
        })));
        const narrow = document.querySelector('.web-note.narrow');
        return {
          scrollWidth: de.scrollWidth, clientWidth: de.clientWidth, pages: pages.length,
          minLeft: Math.min(...pages.map((r) => r.left)), maxRight: Math.max(...pages.map((r) => r.right)),
          width: pages[0].width, ratio: pages[0].height / pages[0].width, overlap,
          imgs: imgs.length, imgsLoaded: loaded.every(Boolean), scripts: document.scripts.length,
          narrowNote: getComputedStyle(narrow).display !== 'none' ? narrow.textContent : null,
          tocLinks: document.querySelectorAll('.web-toc a[href^="#p"]').length,
        };
      });
      assert.equal(m.pages, 46, `${width}px`);
      assert.equal(m.scrollWidth, m.clientWidth, `${width}px：横スクロール`);
      assert.ok(m.minLeft >= 0 && m.maxRight <= width, `${width}px：ページが画面幅からはみ出す ${m.minLeft}〜${m.maxRight}`);
      assert.ok(Math.abs(m.ratio - 297 / 210) < 0.002, `${width}px：ページの比率 ${m.ratio}`);
      assert.equal(m.overlap, 0, `${width}px：ページの重なり`);
      if (mobile) {
        assert.ok(m.width <= width - 16 && m.width >= width - 60, `${width}px：画面幅への縮小 ${m.width}`);
        assert.equal(m.narrowNote, 'スマートフォンでは、指で広げて拡大してご覧ください。');
      } else {
        assert.ok(Math.abs(m.width - 793.7) < 1, `${width}px：原寸 ${m.width}`);
        assert.equal(m.narrowNote, null);
      }
      assert.equal(m.imgs, 10);
      assert.ok(m.imgsLoaded, `${width}px：画像が表示されない`);
      assert.equal(m.tocLinks, 46);
      assert.equal(m.scripts, 0);
      assert.deepEqual(requests.filter((u) => u !== 'about:blank'), [], `${width}px：外部への要求`);
      assert.deepEqual(messages.filter((t) => /Content Security Policy|Refused/i.test(t)), [], `${width}px：CSP 違反`);
      // 目次のリンクで正しいページへ移動できる（P02・P23・P46）
      await page.click('.web-toc summary');
      for (const n of ['02', '23', '46']) {
        await page.click(`.web-toc a[href="#p${n}"]`);
        // ページの上端が画面の上端に来る。最後のページで文書の終わりに達した時は、ページ全体が画面に見えていればよい
        const pos = await page.evaluate((id) => {
          const r = document.querySelector(`#p${id}`).getBoundingClientRect();
          const atEnd = Math.ceil(window.scrollY + window.innerHeight) >= document.documentElement.scrollHeight - 1;
          return { top: Math.round(r.top), bottom: Math.round(r.bottom), atEnd, vh: window.innerHeight };
        }, n);
        assert.ok(Math.abs(pos.top) < 40 || (pos.atEnd && pos.top >= 0 && pos.bottom <= pos.vh), `${width}px：P${n} へ移動できない ${JSON.stringify(pos)}`);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
});

test('Web 版の CSS：fit-to-width は CSS の zoom だけ（JS なし）。840px 未満の全段で紙面が画面幅に収まる倍率', () => {
  const css = fs.readFileSync(path.join(RC1, 'src/templates/web.css'), 'utf8');
  const steps = [...css.matchAll(/@media screen and (?:\(min-width: (\d+)px\) and )?\(max-width: ([\d.]+)px\) \{ \.page \{ zoom: ([\d.]+); \} \}/g)]
    .map((m) => ({ min: m[1] ? Number(m[1]) : 0, max: Number(m[2]), zoom: Number(m[3]) }));
  assert.ok(steps.length >= 20);
  assert.equal(steps[steps.length - 1].max, 839.98);
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    assert.ok(s.zoom > 0 && s.zoom <= 1, JSON.stringify(s));
    if (i > 0) { assert.ok(Math.abs(s.min - steps[i - 1].max - 0.02) < 1e-6, '段の隙間'); assert.ok(s.zoom >= steps[i - 1].zoom); }
    if (s.min) assert.ok(794 * s.zoom <= s.min - 16 || s.zoom === 1, `${s.min}px で収まらない`);
  }
  assert.doesNotMatch(css, /url\(\s*["']?(https?:)?\/\//);
});

// ================= 画像
test('画像：20点とも EXIF・XMP・IPTC・コメント（撮影情報・氏名・位置情報）を含まず、同じ画像ファイルの重複もない', () => {
  const dir = path.join(RC1, 'assets');
  const files = fs.readdirSync(dir).flatMap((d) => fs.readdirSync(path.join(dir, d)).map((f) => path.join(dir, d, f)));
  assert.equal(files.length, 20);
  const hashes = new Set();
  for (const f of files) {
    const b = fs.readFileSync(f);
    assert.equal(b.readUInt16BE(0), 0xffd8, `${f} は JPEG`);
    let i = 2;
    const markers = [];
    while (i < b.length && b[i] === 0xff) {
      const m = b[i + 1];
      if (m === 0xda || m === 0xd9) break;
      markers.push(m);
      i += 2 + b.readUInt16BE(i + 2);
    }
    // APP0（JFIF）・量子化表・ハフマン表・フレームだけ。APP1（EXIF／XMP）・APP2〜APP15（ICC 以外）・COM は不可
    const bad = markers.filter((m) => (m >= 0xe1 && m <= 0xef) || m === 0xfe);
    assert.deepEqual(bad.map((m) => m.toString(16)), [], path.relative(ROOT, f));
    assert.ok(!/Exif|http:\/\/ns\.adobe\.com|Photoshop|GPS/i.test(b.slice(0, 4096).toString('latin1')), path.relative(ROOT, f));
    const h = sha(b);
    assert.ok(!hashes.has(h), `重複：${f}`);
    hashes.add(h);
  }
});

// ================= 素材ハッシュのスクリプト（照合だけが既定・--write は明示した時だけ）
test('素材ハッシュのスクリプト：通常実行は照合だけ（不一致なら exit 1・書き換えない）。テストは --write を呼ばない', () => {
  const { execFileSync, spawnSync } = require('child_process');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ed-mat-'));
  fs.cpSync(path.join(ROOT, 'api/_complete'), path.join(tmp, 'api/_complete'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'lib'));
  fs.mkdirSync(path.join(tmp, 'scripts'));
  fs.copyFileSync(path.join(ROOT, 'lib/complete-materials.json'), path.join(tmp, 'lib/complete-materials.json'));
  fs.copyFileSync(path.join(ROOT, 'scripts/complete-materials.js'), path.join(tmp, 'scripts/complete-materials.js'));
  const script = path.join(tmp, 'scripts/complete-materials.js');
  const manifest = path.join(tmp, 'lib/complete-materials.json');
  const before = fs.readFileSync(manifest);
  // 一致している時：exit 0・書き換えない
  assert.match(execFileSync(process.execPath, [script], { encoding: 'utf8' }), /一致しています/);
  assert.equal(Buffer.compare(fs.readFileSync(manifest), before), 0);
  // 本文素材を1文字変える：exit 1・書き換えない（content の不一致として報告）
  const content = path.join(tmp, 'api/_complete/rc1/src/content/axes.json');
  fs.writeFileSync(content, fs.readFileSync(content, 'utf8').replace('}', ' }'));
  let r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /contentSha256/);
  assert.match(r.stderr, /書き換えていません/);
  assert.equal(Buffer.compare(fs.readFileSync(manifest), before), 0);
  r = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.equal(Buffer.compare(fs.readFileSync(manifest), before), 0);
  // テンプレートの CSS を変える：template の不一致
  fs.copyFileSync(path.join(ROOT, 'api/_complete/rc1/src/content/axes.json'), content);
  const css = path.join(tmp, 'api/_complete/rc1/src/templates/web.css');
  fs.appendFileSync(css, '\n');
  r = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /templateSha256/);
  assert.doesNotMatch(r.stderr, /contentSha256/);
  // 画像も対象
  fs.copyFileSync(path.join(ROOT, 'api/_complete/rc1/src/templates/web.css'), css);
  const img = path.join(tmp, 'api/_complete/rc1/assets/weapons/bow.jpg');
  fs.appendFileSync(img, Buffer.from([0]));
  assert.equal(spawnSync(process.execPath, [script], { encoding: 'utf8' }).status, 1);
  // 不明な引数は拒否（書き換えない）
  assert.equal(spawnSync(process.execPath, [script, '--force'], { encoding: 'utf8' }).status, 2);
  assert.equal(Buffer.compare(fs.readFileSync(manifest), before), 0);
  // 区分：content は本文素材・MENTOR カタログ、template はテンプレート・CSS・画像・組立コード・正本エンジン・入口
  const files = require('../scripts/complete-materials').materialFiles();
  assert.ok(files.content.every((f) => /rc1\/src\/content\/[^/]+\.json$/.test(f)));
  assert.ok(files.content.includes('api/_complete/rc1/src/content/mentor-goals.json'));
  for (const want of ['rc1/src/templates/web.css', 'rc1/assets/weapons/bow.jpg', 'rc1/src/build-claims.js', 'rc1/vendor/eti-js/js/eti_v2_engine.js', 'generate-report.js']) {
    assert.ok(files.template.some((f) => f.endsWith(want)), want);
  }
  // このリポジトリのテストは --write を呼ばない・スクリプトは golden hash を書き換えない
  for (const t of fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js'))) {
    const text = fs.readFileSync(path.join(__dirname, t), 'utf8');
    assert.doesNotMatch(text, /complete-materials(\.js)?['"],?\s*['"]--write|\[script,\s*['"]--write/, t);
  }
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'scripts/complete-materials.js'), 'utf8'), /GOLDEN_SHA256\s*=/);
});
