// 共鳴診断（RESONANCE。旧 元素診断 Mini）の試験（C-0 → Character Reveal Edition）：
//   758 は3問だけで決まり、選んだ人物（SELF IMAGE）で変わらない／回答に映る人物（MIRROR）は 280 固定割当
//   シェア m2（2人表示）・旧 m1 の互換・/mini → /resonance・候補の差し替え口
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const imp = (f) => import(pathToFileURL(path.join(ROOT, f)).href);
const plain = (x) => JSON.parse(JSON.stringify(x));
const SHARE_CODE = require('../js/eti_mini_share.js');
const SHARE_PAGE = require('../api/share.js');
const CHARS = require('../js/characters118_v2_1.js');
const MAP_JSON = JSON.parse(read('docs/eti-mini/handoff_v1/data/eti_mini_758_5star_280_mapping.json'));

function loadPage() {
  const ctx = {}; ctx.globalThis = ctx; ctx.window = ctx; vm.createContext(ctx);
  const files = ['js/characters118_v2_1.js', 'js/eti_mini_auto_map_v1.js', 'js/eti_v2_prototypes.js', 'js/eti_mini_choices_v1.js', 'js/eti_mini_core.js', 'js/eti_mini_share.js'];
  vm.runInContext(files.map(read).join('\n;\n'), ctx, { filename: 'resonance-scripts.js' });
  return ctx;
}
function callShare(query) {
  return new Promise((resolve) => {
    const res = { headers: {}, statusCode: 0, setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, status(c) { this.statusCode = c; return this; }, send(b) { resolve({ status: this.statusCode, body: b }); } };
    SHARE_PAGE({ url: '/api/share?' + query, headers: { host: 'example.test' } }, res);
  });
}
const idx = (n) => CHARS.findIndex((c) => c.name === n);

test('758 は3問だけで決まり、共鳴する人物は 280 固定割当（66名×4〜5回）。核の関数は人物を渡されても 758・人物を変えない（280×119 通り）', () => {
  const ctx = loadPage();
  const M = ctx.ETIMini;
  assert.equal(M.isManualSelectionReady(), false); // 50:50 の結合はページに読み込まれていない
  const byKey = Object.fromEntries(MAP_JSON.rows.map((r) => [r.key, r.mirror_character]));
  let n = 0;
  for (const element of M.ELEMENT_KEYS) for (const weapon of M.WEAPON_KEYS) for (const nation of M.NATION_KEYS) {
    const a = { element, weapon, nation };
    for (const self of [null, ...CHARS.map((c) => ({ name: c.name }))]) {
      const r = M.resonanceResult(a, self);
      assert.deepEqual([r.element, r.weapon, r.nation], [element, weapon, nation]);
      assert.equal(r.mirror.name, byKey[`${element}|${weapon}|${nation}`]);
      assert.deepEqual(plain(r.self), self ? { name: self.name, role: 'self' } : null);
      assert.equal(r.versions.resonance, 'RESONANCE-C0');
      assert.ok(!('character' in r));
      n++;
    }
  }
  assert.equal(n, 280 * 119);
  // 66名×4〜5回（固定割当の分布）
  const counts = {};
  for (const element of M.ELEMENT_KEYS) for (const weapon of M.WEAPON_KEYS) for (const nation of M.NATION_KEYS) { const k = M.resonanceResult({ element, weapon, nation }, null).mirror.name; counts[k] = (counts[k] || 0) + 1; }
  assert.equal(Object.keys(counts).length, 66);
  assert.ok(Object.values(counts).every((c) => c === 4 || c === 5));
  assert.throws(() => M.resonanceResult({ element: '炎', weapon: '弓', nation: 'モンド' }, { name: '' }), (e) => e.code === 'INVALID_CHARACTER');
  assert.throws(() => M.resonanceResult({ element: '炎', weapon: '弓' }, null), (e) => e.code === 'INVALID_ANSWERS');
});

test('m2 の符号：ブラウザ・画像（_og-data.mjs）・シェアページ（share.js）の計算が全 3,931,760 通りで一致し、正規形だけを受け付ける', async () => {
  const D = await imp('api/_og-data.mjs');
  assert.equal(SHARE_CODE.TOTAL2, 280 * 118 * 119);
  let n = 0;
  for (const element of SHARE_CODE.ELEMENTS) for (const weapon of SHARE_CODE.WEAPONS) for (const nation of SHARE_CODE.NATIONS) for (let m = 0; m < 118; m++) for (let s = -1; s < 118; s++) {
    const self = s < 0 ? null : s;
    const code = SHARE_CODE.packResonance(element, weapon, nation, m, self);
    const b = SHARE_CODE.unpackResonance(code);
    if (b.element !== element || b.weapon !== weapon || b.nation !== nation || b.mirrorIndex !== m || b.selfIndex !== self) assert.fail(`browser ${code}`);
    const o = D.unpackResonanceShare(code);
    if (o.el !== element || o.w !== weapon || o.nat !== nation || o.mirrorIdx !== m || o.selfIdx !== self) assert.fail(`og ${code}`);
    const p = SHARE_PAGE._unpackResonanceShare(code);
    if (p.el !== element || p.w !== weapon || p.nat !== nation || p.mirrorIdx !== m || p.selfIdx !== self) assert.fail(`share ${code}`);
    if (code.length > 5) assert.fail(`long ${code}`);
    n++;
  }
  assert.equal(n, SHARE_CODE.TOTAL2);
  const one = SHARE_CODE.packResonance('炎', '弓', 'モンド', 3, 5);
  for (const bad of ['', '0' + one, one.toUpperCase(), (SHARE_CODE.TOTAL2).toString(36), 'zzzzz', 'zzzzzz', '-1', 'a b']) {
    assert.equal(SHARE_CODE.unpackResonance(bad), null, bad);
    assert.equal(D.unpackResonanceShare(bad), null, bad);
    assert.equal(SHARE_PAGE._unpackResonanceShare(bad), null, bad);
  }
  assert.equal(SHARE_CODE.packResonance('炎', '弓', 'モンド', 118, null), null);
  assert.equal(SHARE_CODE.packResonance('炎', '弓', 'モンド', 0, 119), null);
  assert.equal(SHARE_CODE.packResonance('炎', '弓', 'ナド・クライ', 0, null), null);
});

test('シェアページ（/api/share?m2=）：2人表示の画像、人は /resonance?r= へ。「最も近しい」と断定しない・数値なし', async () => {
  const code = SHARE_CODE.packResonance('水', '法器', 'ナドクライ', idx('アルベド'), idx('アイノ'));
  const r = await callShare('m2=' + code);
  assert.equal(r.status, 200);
  assert.match(r.body, new RegExp(`<meta property="og:image" content="https://example\\.test/api/og-image\\?m2=${code}">`));
  assert.match(r.body, new RegExp(`window\\.location\\.replace\\("https://example\\.test/resonance\\?r=${code}"\\)`));
  assert.match(r.body, /<title>共鳴診断 — 私の結果は【水 × 法器 × ナド・クライ】<\/title>/);
  assert.match(r.body, /私が選んだ人物：アイノ／回答に映る人物：アルベド/);
  assert.doesNotMatch(r.body, /最も近しい|近しいキャラクター|一致|%/);
  const none = await callShare('m2=' + SHARE_CODE.packResonance('炎', '弓', 'モンド', 0, null));
  assert.match(none.body, /content="回答に映る人物：ディルック。/);
  assert.doesNotMatch(none.body, /私が選んだ人物/);
  const bad = await callShare('m2=zzzzz');
  assert.match(bad.body, /window\.location\.replace\("https:\/\/example\.test\/resonance"\)/);
  assert.doesNotMatch(bad.body, /og-image\?m2=/);
  // 旧 m1 は従来の画像（og-image?m1=）のまま、人は /resonance?s= へ
  const m1 = SHARE_CODE.pack('水', '法器', 'ナドクライ', idx('アイノ'), true);
  const old = await callShare('m1=' + m1);
  assert.match(old.body, new RegExp(`og-image\\?m1=${m1}`));
  assert.match(old.body, new RegExp(`/resonance\\?s=${m1}`));
});

test('画像（/api/og-image?m2=）：本家と同じ描き方に、SELF IMAGE と MIRROR を並べる（m2 の判定は本家の p より先）', async () => {
  const src = read('api/og-image.mjs');
  const iM2 = src.indexOf("searchParams.get('m2')"), iP = src.indexOf("searchParams.get('p')");
  assert.ok(iM2 > 0 && iM2 < iP);
  assert.match(src, /\[person\(u\.selfIdx, 'SELF IMAGE'\), person\(u\.mirrorIdx, 'MIRROR'\)\] : \[person\(u\.mirrorIdx, 'MIRROR'\)\]/);
  assert.match(src, /brand: '共鳴診断 RESONANCE'/);
  assert.match(src, /Location: `\$\{origin\}\/api\/og-image\?m2=\$\{m2\}`/);
  const { buildOgpCardTree } = await imp('js/ogp-card.mjs');
  const texts = (node, out = []) => { if (node == null) return out; if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; } const k = node.props && node.props.children; (Array.isArray(k) ? k : [k]).forEach((c) => texts(c, out)); return out; };
  const base = { code: 'HYCT', typeName: '深識者', element: '水', weapon: '法器', nation: 'ナド・クライ', mirrorName: '', match: '', brand: '共鳴診断 RESONANCE' };
  for (const o of [{}, { part: 'overlay', baseUrl: 'data:,' }]) {
    const two = texts(buildOgpCardTree({ ...base, pair: [{ label: 'SELF IMAGE', name: 'アイノ', element: '水' }, { label: 'MIRROR', name: 'アルベド', element: '岩' }] }, o)).join('|');
    assert.match(two, /SELF IMAGE\|アイノ\|MIRROR\|アルベド/);
    assert.match(two, /共鳴診断 RESONANCE — 私の結果は【水 × 法器 × ナド\|クライ】/);
    assert.doesNotMatch(two, /最も近しい|一致|・/);
    const one = texts(buildOgpCardTree({ ...base, pair: [{ label: 'MIRROR', name: 'アルベド', element: '岩' }] }, o)).join('|');
    assert.match(one, /MIRROR\|アルベド/);
    assert.doesNotMatch(one, /SELF IMAGE|最も近しい/);
  }
});

test('画像のフォント：共鳴診断で新しく描く文字は、同梱フォントに収録済みの文字だけ（日本語の見出しは使わず英字）', async () => {
  const D = await imp('api/_og-data.mjs');
  const covered = new Set([...Object.keys(D.ELEMENT_CODE), ...Object.keys(D.WEAPON_CODE), ...D.PACK_NATIONS, ...Object.values(D.TYPE_NAME).flatMap(Object.values),
    ...D.CHAR_NAMES, '最も近しいキャラクター', '元素診断 — 私の結果は【】×', '元素診断 — MY RESULT', '0123456789%一致', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ '].join(''));
  for (const s of ['共鳴診断 RESONANCE', 'SELF IMAGE', 'MIRROR']) for (const ch of s) assert.ok(covered.has(ch), `「${ch}」（${s}）`);
});

test('/mini は /resonance へ恒久転送（クエリは Vercel の既定で引き継ぐ：旧リンク /mini?s= も開ける）', () => {
  const v = JSON.parse(read('vercel.json'));
  for (const src of ['/mini', '/mini.html']) {
    const r = (v.redirects || []).find((x) => x.source === src);
    assert.ok(r, src);
    assert.equal(r.destination, '/resonance');
    assert.equal(r.permanent, true);
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'mini.html')));
  assert.ok(fs.existsSync(path.join(ROOT, 'resonance.html')));
  // 共鳴診断のページは c（m3）・r（旧 m2）・s（旧 m1）を表示できる（旧リンクは当時の人物を主役に、選ばれた人物は小さく添える）
  const html = read('resonance.html');
  assert.match(html, /var c3 = params\.get\('c'\), r2 = params\.get\('r'\), s1 = params\.get\('s'\)/);
  assert.match(html, /u = S\.unpackReveal\(c3\)/);
  assert.match(html, /u = S\.unpackResonance\(r2\)/);
  assert.match(html, /u = S\.unpack\(s1\)/);
  assert.match(html, /r\.note = 'シェアした人が選んだ人物：'/);
  assert.match(html, /r\.note = 'この人物は、シェアした人が選んだ人物です'/);
});

test('名称・コピー：共鳴診断・RESONANCE・ELEMENT DIAGNOSIS PRESENTS、「3つの問いから、アナタに共鳴する人物を。」、3問で細かく測ると誤認させない', () => {
  const html = read('resonance.html');
  assert.match(html, /<title>共鳴診断 — RESONANCE<\/title>/);
  assert.match(html, /<h1 class="title">共鳴診断<\/h1>/);
  assert.match(html, /<p class="sub">RESONANCE<\/p>/);
  assert.match(html, />Element Diagnosis Presents</);
  assert.match(html, /3つの問いから、アナタに共鳴する人物を。/);
  assert.match(html, /3つの問いで心の特性を細かく測るものではありません/);
  assert.match(html, /アナタに共鳴する人物は――/);
  assert.doesNotMatch(html, /元素診断 Mini|最も近しいキャラクター|類似度1位|心理学的|測定された/);
});

test('登場演出：本家 OGP の元素の円（正式背景）を、現れたキャラの元素の星座として使う／名前はキャラの元素カラーのグラデーション／順に現れる／タップで省略／繰り返さない', async () => {
  const html = read('resonance.html');
  const T = await imp('js/ogp-theme.mjs');
  const key = vm.runInNewContext('(' + /var ELEMENT_KEY = (\{[^}]+\});/.exec(html)[1] + ')');
  assert.deepEqual(plain(key), plain(T.ELEMENT_KEY));
  for (const k of Object.values(key)) assert.ok(fs.existsSync(path.join(ROOT, `assets/ogp/backgrounds/${k}.jpg`)), k);
  assert.ok(html.includes("var charEl = ETI_V2_CHARACTERS_2_1_0[CHAR_INDEX[name]].element;"));
  assert.ok(html.includes(`$('rOrb').style.backgroundImage = "url('/assets/ogp/backgrounds/" + ELEMENT_KEY[charEl] + ".jpg')"`)); // キャラの元素の星座
  assert.ok(html.includes('setGlow(ELEMENT_GLOW[lastResult.charElement]);'));
  // 名前のグラデーション：本家 OGP の元素テーマ（accentSoft・accent）と、ページの元素の深い色
  const nameColor = vm.runInNewContext('(' + /var NAME_COLOR = (\{[\s\S]*?\});/.exec(html)[1] + ')');
  const glow = vm.runInNewContext('(' + /var ELEMENT_GLOW = (\{[^}]+\});/.exec(html)[1] + ')');
  for (const [jp] of Object.entries(T.ELEMENT_KEY)) {
    const th = T.themeFor(jp);
    assert.deepEqual(Array.from(nameColor[jp]), [th.accentSoft, th.accent, glow[jp]], jp);
  }
  assert.ok(html.includes("background-clip: text"));
  assert.ok(html.includes("'linear-gradient(100deg, ' + nameColor[0] + ' 0%, ' + nameColor[1] + ' 55%, ' + nameColor[2] + ' 100%)'"));
  const order = ['.rv-orb { animation: rvOrb 1s ease-out .2s', '.orb-glow { opacity: 0; animation: rvGlow 1.4s ease-out .8s', '.rv-lead { animation: rvFade .7s ease-out 1.3s', '.rv-name { animation: rvName 1s ease-out 1.85s', '.rv-info { animation: rvFade .7s ease-out 2.5s'];
  let last = -1;
  for (const o of order) { const i = html.indexOf(o); assert.ok(i > last, o); last = i; }
  assert.ok(html.includes('@media (prefers-reduced-motion: reduce) { .reveal.play .rv, .reveal.play .orb-glow { animation: none; opacity: 1; }'));
  assert.ok(html.includes('if (play && !REDUCED)'));
  assert.ok(html.includes("if (this.classList.contains('play')) finishReveal();")); // タップで省略
  assert.ok(html.includes('setGlow(ELEMENT_GLOW[r.charElement]);\n    setReveal(false);')); // 共有リンクは演出なし
  assert.ok(html.includes('setReveal(playNext);\n    playNext = false;')); // 3問目のあとだけ演出、戻る・進むでは繰り返さない
  assert.doesNotMatch(html, /Math\.random/); // 再抽選・ランダム排出なし
});

test('結果の並び：登場演出 → 説明 → ¥500 レポートの見本（非販売・数値なし）→ 購入（準備中・押せない）→ Xでシェア → 100問の元素診断', () => {
  const html = read('resonance.html');
  const pos = ['id="reveal"', 'id="rAbout"', 'id="reportDemo"', 'id="buyBtn"', 'id="tweetShareBtn"', '元素診断で、もっと深く自分を知る'].map((t) => html.indexOf(t));
  pos.forEach((p, i) => assert.ok(p > 0 && (i === 0 || p > pos[i - 1]), String(i)));
  assert.ok(html.includes('<button type="button" class="cta buy" id="buyBtn" disabled>'));
  assert.match(html, /共鳴診断｜人物像レポート/);
  assert.match(html, /税込500円・買い切り/);
  assert.match(html, /見本の表示です。図の形は実際のレポートとは異なります（購入後に、アナタの結果で描かれます）。/);
  assert.doesNotMatch(html, /1,?000円|checkout|stripe/i);
  // 見本：項目ごとの図（PERSONA・STYLE・VALUES・SYMBOLS・RESONANCE・JOURNEY）。軸・項目名は見せ、中身はぼかして鍵
  const demo = html.slice(html.indexOf('id="reportDemo"'), html.indexOf('id="buyBtn"'));
  const labels = [...demo.matchAll(/<p class="lk-en">([A-Z]+)<\/p>/g)].map((m) => m[1]);
  assert.deepEqual(labels, ['PERSONA', 'STYLE', 'VALUES', 'SYMBOLS', 'RESONANCE', 'JOURNEY']);
  assert.equal((demo.match(/class="lock-badge"/g) || []).length, 6);
  assert.equal((demo.match(/filter="url\(#lockBlur\)"/g) || []).length, 4); // 図の中身だけをぼかす
  for (const ax of ['開放性', '誠実性', '外向性', '協調性', '感受性', '主導性', '関係調整', '役割持続', '媒介思考', '自律距離']) assert.ok(demo.includes(ax), ax);
  assert.match(demo, /象徴的な近さ/);
  assert.match(demo, /心の測定値ではありません/);
  // 固定の見本（利用者のデータから数値・図を作らない）：スクリプトは見本の図の形に触れない。見える文字に数値・割合は無い
  assert.doesNotMatch(html, /querySelector[^;]*\.(viz|lk|locks)\b|getElementById\('(demo|locks)/);
  const visible = demo.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
  assert.doesNotMatch(visible, /\d+\s*(%|％|点)/);
  assert.doesNotMatch(demo, /<ol|demo-list/); // 01〜05 の番号付きリストはやめた
});

test('m3 の符号：ブラウザ・画像（_og-data.mjs）・シェアページ（share.js）の計算が全 33,040 通りで一致し、正規形だけ（最大3文字）。m1・m2 とはパラメータ名で分ける', async () => {
  const D = await imp('api/_og-data.mjs');
  assert.equal(SHARE_CODE.TOTAL3, 280 * 118);
  assert.equal(SHARE_CODE.REVEAL_VERSION, 'RESONANCE-SHARE-3');
  let n = 0;
  for (const element of SHARE_CODE.ELEMENTS) for (const weapon of SHARE_CODE.WEAPONS) for (const nation of SHARE_CODE.NATIONS) for (let c = 0; c < 118; c++) {
    const code = SHARE_CODE.packReveal(element, weapon, nation, c);
    assert.ok(code.length <= 3, code);
    assert.deepEqual(SHARE_CODE.unpackReveal(code), { element, weapon, nation, charIndex: c });
    const o = D.unpackRevealShare(code), p = SHARE_PAGE._unpackRevealShare(code);
    for (const x of [o, p]) assert.deepEqual([x.el, x.w, x.nat, x.charIdx], [element, weapon, nation, c]);
    n++;
  }
  assert.equal(n, 33040);
  const one = SHARE_CODE.packReveal('炎', '弓', 'モンド', 3);
  for (const bad of ['', '0' + one, one.toUpperCase(), (280 * 118).toString(36), 'zzz', 'zzzz', '-1', 'a b']) {
    assert.equal(SHARE_CODE.unpackReveal(bad), null, bad);
    assert.equal(D.unpackRevealShare(bad), null, bad);
    assert.equal(SHARE_PAGE._unpackRevealShare(bad), null, bad);
  }
  assert.equal(SHARE_CODE.packReveal('炎', '弓', 'モンド', 118), null);
  assert.equal(SHARE_CODE.packReveal('炎', '弓', 'ナド・クライ', 0), null);
  // 結果とシェアカードの人物名が一致：ページの結果（固定割当）から作る m3 を、シェアページ・画像が同じ名前に読む
  const ctx = loadPage();
  const r = ctx.ETIMini.resonanceResult({ element: '氷', weapon: '法器', nation: 'ナタ' }, null);
  const code = SHARE_CODE.packReveal('氷', '法器', 'ナタ', idx(r.mirror.name));
  assert.equal(D.CHAR_NAMES[D.unpackRevealShare(code).charIdx], r.mirror.name);
  assert.equal(D.CHAR_NAMES[SHARE_PAGE._unpackRevealShare(code).charIdx], r.mirror.name);
});

test('シェアページ（/api/share?m3=）：人物名入りのタイトル、人物名を大きく描いた画像、人は /resonance?c= へ。数値なし・壊れた値は画像を出さない', async () => {
  const code = SHARE_CODE.packReveal('氷', '片手剣', 'スネージナヤ', idx('アルレッキーノ'));
  const r = await callShare('m3=' + code);
  assert.equal(r.status, 200);
  assert.ok(r.body.includes(`<meta property="og:image" content="https://example.test/api/og-image?m3=${code}">`));
  assert.ok(r.body.includes(`window.location.replace("https://example.test/resonance?c=${code}")`));
  assert.ok(r.body.includes('<title>共鳴診断 — 私に共鳴する人物は「アルレッキーノ」【氷 × 片手剣 × スネージナヤ】</title>'));
  assert.match(r.body, /twitter:card" content="summary_large_image"/);
  assert.doesNotMatch(r.body, /最も近しい|一致|%/);
  for (const bad of ['zzz', '', String(280 * 118)]) {
    const b = await callShare('m3=' + bad);
    assert.ok(b.body.includes('window.location.replace("https://example.test/resonance")'), bad);
    assert.doesNotMatch(b.body, /og-image\?m3=/);
  }
});

test('画像（/api/og-image?m3=）：共鳴診断の下地に人物名を大きく。m3 の判定は本家の p より先・正規形へ転送。新しく描く文字は同梱フォントにある', async () => {
  const src = read('api/og-image.mjs');
  const iM3 = src.indexOf("searchParams.get('m3')"), iP = src.indexOf("searchParams.get('p')");
  assert.ok(iM3 > 0 && iM3 < iP);
  assert.ok(src.includes("hero: { label: 'YOUR RESONANCE', name, element: CHAR_ELEMENT[name] || u.el }"));
  assert.ok(src.includes("bandText: 'ELEMENT DIAGNOSIS PRESENTS — 共鳴診断 RESONANCE'"));
  assert.ok(src.includes('Location: `${origin}/api/og-image?m3=${m3}`'));
  const { buildOgpCardTree } = await imp('js/ogp-card.mjs');
  const texts = (node, out = []) => { if (node == null) return out; if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; } const k = node.props && node.props.children; (Array.isArray(k) ? k : [k]).forEach((c) => texts(c, out)); return out; };
  const d = { code: 'CRSW', typeName: '宿縁者', element: '氷', weapon: '片手剣', nation: 'スネージナヤ', mirrorName: '', match: '', hero: { label: 'YOUR RESONANCE', name: 'アルレッキーノ', element: '炎' }, bandText: 'ELEMENT DIAGNOSIS PRESENTS — 共鳴診断 RESONANCE', header: '共鳴診断 — MY RESULT' };
  for (const o of [{}, { part: 'overlay', baseUrl: 'data:,' }]) {
    const t = texts(buildOgpCardTree(d, o)).join('|');
    assert.match(t, /YOUR RESONANCE\|アルレッキーノ/);
    assert.match(t, /(^|\|)氷\|片手剣\|スネージナヤ\|/);
    assert.match(t, /ELEMENT DIAGNOSIS PRESENTS — 共鳴診断 RESONANCE/);
    assert.doesNotMatch(t, /最も近しい|一致|SELF IMAGE/);
  }
  const D = await imp('api/_og-data.mjs');
  assert.ok(Math.max(...D.CHAR_NAMES.map((n) => n.length)) <= 7);
  assert.ok(54 * 7 + 4 * 7 + 28 * 2 <= 590); // 最長 7 文字でも欄（590px）に収まる大きさ
  const covered = new Set([...Object.keys(D.ELEMENT_CODE), ...Object.keys(D.WEAPON_CODE), ...D.PACK_NATIONS, ...Object.values(D.TYPE_NAME).flatMap(Object.values),
    ...D.CHAR_NAMES, '最も近しいキャラクター', '元素診断 — 私の結果は【】×', '元素診断 — MY RESULT', '0123456789%一致', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ '].join(''));
  for (const str of ['YOUR RESONANCE', 'ELEMENT DIAGNOSIS PRESENTS — 共鳴診断 RESONANCE', '共鳴診断 — MY RESULT']) for (const ch of str) assert.ok(covered.has(ch), `「${ch}」`);
});

test('画像の見出し：共鳴診断（m2）は「共鳴診断 — MY RESULT」の下地35枚を使い、本家・旧 m1 は従来の「元素診断 — MY RESULT」のまま', async () => {
  const D = await imp('api/_og-data.mjs');
  for (const el of D.PACK_ELEMENTS) for (const w of D.PACK_WEAPONS) {
    const code = D.ELEMENT_CODE[el] + D.WEAPON_CODE[w];
    assert.ok(fs.existsSync(path.join(ROOT, `assets/ogp/bases-resonance/${code}.jpg`)), code);
    assert.ok(fs.existsSync(path.join(ROOT, `assets/ogp/bases/${code}.jpg`)), code);
  }
  assert.equal(fs.readdirSync(path.join(ROOT, 'assets/ogp/bases-resonance')).length, 35);
  const B = require('../scripts/build-public.js');
  assert.ok(B.PUBLIC_DIRS.some((d) => d.dir === 'assets/ogp/bases-resonance' && d.ext === '.jpg'));
  const src = read('api/og-image.mjs');
  assert.match(src, /header: '共鳴診断 — MY RESULT',\n    baseDir: 'bases-resonance',/);
  assert.match(src, /\/assets\/ogp\/\$\{data\.baseDir \|\| 'bases'\}\/\$\{code\}\.jpg/);
  assert.match(read('scripts/build-ogp-bases.mjs'), /RESONANCE_HEADER = '共鳴診断 — MY RESULT'/);
  // カードの見出し：省略時は本家と同じ。共鳴診断の値を渡した時だけ変わる（下地が取れず1枚描く時も同じ見出し）
  const { buildOgpCardTree } = await imp('js/ogp-card.mjs');
  const texts = (node, out = []) => { if (node == null) return out; if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; } const k = node.props && node.props.children; (Array.isArray(k) ? k : [k]).forEach((c) => texts(c, out)); return out; };
  const d = { code: 'HYCT', typeName: '深識者', element: '水', weapon: '法器', nation: 'モンド' };
  assert.ok(texts(buildOgpCardTree(d, { part: 'base' })).includes('元素診断 — MY RESULT'));
  assert.ok(texts(buildOgpCardTree({ ...d, header: '共鳴診断 — MY RESULT' }, { part: 'base' })).includes('共鳴診断 — MY RESULT'));
  assert.ok(!texts(buildOgpCardTree({ ...d, header: '共鳴診断 — MY RESULT' }, { part: 'base' })).includes('元素診断 — MY RESULT'));
});
