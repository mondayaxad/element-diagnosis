// 完全解析の画面（index／mypage／report）と Kit 同意欄の表示テスト（Playwright・Preview fixture）。
// Supabase・API・フォントはすべて差し替え。Stripe・Kit・DB へは接続しない。
// Playwright が無い環境では skip する。
//   実行: node --test tests/complete_analysis_ui.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium = null;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { ({ chromium } = require(p)); break; } catch (e) { /* 次を試す */ }
}
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.mjs': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };

// 偽の Supabase：signedIn=false で未ログイン。rows は diagnosis_sessions の行。
function fakeSupabase({ signedIn = true, rows = [], historyError = false } = {}) {
  return `window.supabase = { createClient() {
    const user = ${signedIn ? '{ id: "user-1", email: "owner@example.test" }' : 'null'};
    const rows = ${JSON.stringify(rows)};
    function builder(table) {
      let one = false;
      const q = new Proxy({}, { get(_t, k) {
        if (k === 'then') return (res, rej) => {
          let out;
          if (table === 'diagnosis_sessions') out = ${historyError ? '{ data: null, error: { message: "x" } }' : '{ data: one ? (rows[0] || null) : rows, error: null }'};
          else if (table === 'profiles') out = { data: { newsletter_opted_in: null }, error: null };
          else out = { data: one ? null : [], error: null };
          return Promise.resolve(out).then(res, rej);
        };
        if (k === 'single' || k === 'maybeSingle') return () => { one = true; return q; };
        return () => q;
      } });
      return q;
    }
    return { from: builder, rpc: async () => ({ data: null, error: null }),
      auth: { getUser: async () => ({ data: { user } }), getSession: async () => ({ data: { session: user ? { access_token: "t" } : null } }),
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }, signOut: async () => ({}) } };
  } };`;
}
// 最新版（ETI v2）の記録は、正本エンジンで実際に計算した回答・結果から作る（保存時と同じ形）。
const vm = require('vm');
const V2 = (() => {
  const ctx = { console };
  vm.createContext(ctx);
  for (const f of ['js/ETI_v2_QUESTIONS_100.js', 'js/eti_v2_prototypes.js', 'js/eti_v2_engine.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  vm.runInContext('this.__make = (k) => { const A = {}; ETI_V2_QUESTIONS.forEach((q, i) => { A[q.id] = ((i * k) % 5) - 2; }); const R = ETIv2.computeResultsV2(A, { elementPrototypes: ELEMENT_PROTOTYPES_V2, weaponPrototypes: WEAPON_PROTOTYPES_V2, nationPrototypes: NATION_PROTOTYPES_V2 }); return { code: ETIv2.encodeAnswersV2(A, ETI_V2_QUESTIONS), R: JSON.parse(JSON.stringify(R)) }; };', ctx);
  return ctx.__make;
})();
function v2Row(id, completedAt, k) {
  const { code, R } = V2(k);
  return {
    row: { id, user_id: 'user-1', completed_at: completedAt, diagnosis_type: 'element', diagnosis_version: 'ETI-2.0', item_set_version: 'ETI-ITEM-2.0.0',
      diagnosis_results: [{ primary_result: {}, scores: {}, character_matches: [], diagnosis_code: code, item_set_version: 'ETI-ITEM-2.0.0', scoring_version: 'ETI-SCORE-2.0.0',
        character_profile_version: 'ETI-CHAR-2.1.0', mirror_model_version: 'ETI-MIRROR-2.1.0',
        v2_scores: { personality: R.personality, style: R.style, values: R.values, valuesCentered: R.valuesCentered },
        v2_rankings: { element: R.elementRanking, weapon: R.weaponRanking, nation: R.nationRanking }, mirror_snapshot: [] }],
      diagnosis_answers: [{ encoded_answers: code }] },
    combo: `${R.elementRanking[0].name} × ${R.weaponRanking[0].name} × ${R.nationRanking[0].name}`,
  };
}
const B = v2Row('sess-B', '2026-10-01T10:00:00Z', 7);
const A = v2Row('sess-A', '2026-09-20T10:00:00Z', 3);
const COMBO_B = B.combo;
// 既定：最新版の記録2件（新しい順に B, A）
const ROWS = [B.row, A.row];
// 旧版（element-v1）の記録：設問・保存項目が ETI v2 と異なる
const LEGACY_ROW = { id: 'sess-L', user_id: 'user-1', completed_at: '2026-10-03T10:00:00Z', diagnosis_type: 'element', diagnosis_version: null,
  diagnosis_results: [{ primary_result: { element: '風', weapon: '弓', nation: 'モンド' }, scores: {}, character_matches: [{ name: 'ウェンティ', match: 82, el: '風' }] }],
  diagnosis_answers: [{ encoded_answers: 'codeL' }] };

let server, base, browser;
test.before(async () => {
  if (!chromium) return;
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
});
test.after(async () => { if (browser) await browser.close(); if (server) server.close(); });

async function page(url, { width = 390, height = 844, supa = { rows: ROWS }, reducedMotion } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, reducedMotion });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.route(/supabase-js@2/, (r) => r.fulfill({ contentType: 'application/javascript', body: fakeSupabase(supa) }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.route(/cdnjs\.cloudflare\.com|googletagmanager/, (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await p.route('**/api/my-entitlements', (r) => r.fulfill({ contentType: 'application/json', body: '{"purchased_by_version":{}}' }));
  await p.route('**/api/report-data**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(global.__reportData || {}) }));
  await p.goto(base + url);
  p.__errors = errors; p.__ctx = ctx;
  return p;
}
const skip = () => !chromium;

async function mypage(state, extra = '', opts = {}) {
  const p = await page(`/mypage.html${state ? `?preview_entitlement=${state}${extra}` : ''}`, opts);
  await p.waitForSelector('.mp-latest', { state: 'attached' });
  return p;
}
const sheetText = (p) => p.locator('#mpUpgradeBody').innerText();

test('mypage：右上入口は LATEST RESULT より上・追従しない・間にバナーを足さない・既存集計は維持', { skip: skip() }, async () => {
  const p = await mypage('free');
  const t = p.locator('#mpUpgradeTrigger');
  assert.equal(await t.innerText(), 'アップグレード');
  const tb = await t.boundingBox(), lb = await p.locator('#mp-latest-h').boundingBox();
  assert.ok(tb.y < lb.y);
  assert.equal(await t.evaluate((e) => getComputedStyle(e).position), 'relative');
  assert.ok(tb.height >= 34 && tb.height <= 38, 'height ' + tb.height);
  // 見た目は36px・タップ領域は44px相当（::after）
  assert.equal(await t.evaluate((e) => getComputedStyle(e, '::after').top), '-4px');
  // LATEST RESULT の次の section は YOUR COLLECTION（新規バナーなし）
  assert.equal(await p.evaluate(() => document.querySelector('[aria-labelledby="mp-latest-h"]').nextElementSibling.getAttribute('aria-labelledby')), 'mp-col-h');
  assert.equal(await p.locator('.mp-stat-en').allInnerTexts().then((a) => a.join(',')), 'RECORDS,INSIGHTS');
  assert.ok(await p.locator('.mp-latest .mp-chip.locked').count() === 1, 'LOCKED 体系を維持');
  // スクロールしても追従しない
  await p.mouse.wheel(0, 1200); await p.waitForTimeout(100);
  const after = await t.boundingBox();
  assert.ok(!after || after.y < tb.y - 100);
  assert.deepEqual(p.__errors, []);
  await p.__ctx.close();
});

test('mypage free：解析¥1,000が主（塗り）、完全¥3,000が副（枠線・ダミー）', { skip: skip() }, async () => {
  const p = await mypage('free');
  await p.click('#mpUpgradeTrigger');
  const dlg = p.locator('#latest-upgrade-dialog');
  assert.equal(await dlg.getAttribute('role'), 'dialog');
  assert.equal(await dlg.getAttribute('aria-modal'), 'true');
  assert.equal(await p.evaluate(() => document.activeElement.id), 'mpUpgradeClose');
  const text = await sheetText(p);
  assert.ok(text.indexOf('解析レポート') < text.indexOf('完全解析　') || text.indexOf('STRUCTURE') < text.indexOf('COMPLETE ANALYSIS'));
  for (const s of [...COMBO_B.split(' × '), 'MIRROR', '現在のあなたに近い人物像', 'HIDDEN SHAPE', '表に出にくい一面に近い人物像', 'MENTOR', 'これから伸ばす方向に近い人物像', '10名', 'CHARACTERS', '全46ページ', 'COMPLETE RECORD', '気質', '価値観', '人物像', '近しいキャラクター4名', '解析レポートの内容もすべて含まれます']) assert.ok(text.includes(s), s);
  // 観測項目は箇条書き（li・チェック・鍵）ではなく区画で示す
  assert.equal(await p.locator('#mpUpgradeBody .ca-observation-item').count(), 4);
  assert.ok(!/[✓🔒]/.test(text));
  const primary = p.locator('.ca-card--primary .ca-primary-action');
  assert.equal(await primary.count(), 1);
  assert.equal(await p.locator('.ca-card--primary .ca-price').innerText(), '¥1,000');
  const dummy = p.locator('.ca-card--secondary a[data-preview-dummy="true"]');
  assert.equal(await p.locator('.ca-card--secondary .ca-price').innerText(), '¥3,000');
  assert.ok((await dummy.getAttribute('class')).includes('ca-secondary-action'), '完全解析は枠線型（主CTAより弱い）');
  assert.equal(await dummy.evaluate((e) => getComputedStyle(e).backgroundImage), 'none');
  const href = await dummy.getAttribute('href');
  assert.match(href, /^https:\/\/buy\.stripe\.com\/test_/); assert.ok(!href.includes('client_reference_id'));
  assert.equal(await dummy.getAttribute('data-product-id'), 'core_complete_analysis');
  assert.equal(await dummy.getAttribute('data-diagnosis-session-id'), 'sess-B');
  // 背景スクロール停止
  assert.equal(await p.evaluate(() => getComputedStyle(document.body).overflow), 'hidden');
  for (const banned of ['2/6', '4/6', '6/6', '残り一つ', '完成させる', 'すべて集める']) assert.ok(!text.includes(banned), banned);
  await p.__ctx.close();
});

test('mypage：フォーカストラップ・Escape・外側押下で閉じ、トリガーへ戻る', { skip: skip() }, async () => {
  const p = await mypage('free');
  await p.click('#mpUpgradeTrigger');
  for (let i = 0; i < 12; i++) {
    await p.keyboard.press('Tab');
    assert.ok(await p.evaluate(() => !!document.activeElement.closest('#latest-upgrade-dialog')), 'focus stays in dialog');
  }
  await p.keyboard.press('Shift+Tab');
  assert.ok(await p.evaluate(() => !!document.activeElement.closest('#latest-upgrade-dialog')));
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('#mpUpgradeOverlay').isHidden(), true);
  assert.equal(await p.evaluate(() => document.activeElement.id), 'mpUpgradeTrigger');
  assert.equal(await p.evaluate(() => getComputedStyle(document.body).overflow), 'visible');
  await p.click('#mpUpgradeTrigger');
  await p.click('.ca-sheet-scroll', { position: { x: 30, y: 30 } }); // 内部押下では閉じない
  assert.equal(await p.locator('#mpUpgradeOverlay').isHidden(), false);
  await p.mouse.click(195, 20); // オーバーレイ（外側）
  assert.equal(await p.locator('#mpUpgradeOverlay').isHidden(), true);
  await p.__ctx.close();
});

test('mypage analysis：差額¥2,000だけ（¥1,000・¥3,000カードなし）', { skip: skip() }, async () => {
  const p = await mypage('analysis');
  assert.equal(await p.locator('#mpUpgradeTrigger').innerText(), 'アップグレード');
  await p.click('#mpUpgradeTrigger');
  const text = await sheetText(p);
  assert.ok(text.includes('追加 ¥2,000')); assert.ok(text.includes(`対象：${COMBO_B}／この診断記録`));
  assert.ok(text.includes('構造と解釈まで観測されています'));
  assert.ok(!text.includes('さらに開かれるもの'));
  assert.equal(await p.locator('#mpUpgradeBody .ca-lens').count(), 3);
  assert.ok(!text.includes('¥3,000') && !text.includes('¥1,000'));
  assert.equal(await p.locator('#mpUpgradeBody a[href*="buy.stripe"]').count(), 1);
  assert.equal(await p.locator('#mpUpgradeBody a[data-product-id="core_complete_analysis_upgrade"]').count(), 1);
  await p.__ctx.close();
});

test('mypage generating：追加購入CTAなし・解析レポートは開ける', { skip: skip() }, async () => {
  const p = await mypage('complete-generating');
  assert.equal(await p.locator('#mpUpgradeTrigger').innerText(), '準備中');
  await p.click('#mpUpgradeTrigger');
  const text = await sheetText(p);
  assert.ok(text.includes('完全解析を準備しています')); assert.ok(text.includes('解析レポートを見る'));
  assert.equal(await p.locator('#mpUpgradeBody a[href*="buy.stripe"]').count(), 0);
  await p.__ctx.close();
});

test('mypage ready：解析レポートと完全解析の両方を開ける・COMPLETE表示', { skip: skip() }, async () => {
  const p = await mypage('complete-ready');
  const t = p.locator('#mpUpgradeTrigger');
  assert.equal(await t.innerText(), '完全解析');
  assert.ok((await t.getAttribute('class')).includes('is-ready'));
  assert.equal(await p.locator('.mp-latest.is-complete .mp-chip.complete').count(), 1);
  await p.click('#mpUpgradeTrigger');
  const body = p.locator('#mpUpgradeBody');
  assert.equal(await body.locator('a[href*="buy.stripe"]').count(), 0);
  assert.equal(await body.getByText('解析レポートを見る').count(), 1);
  const open = body.getByText('完全解析を開く');
  assert.equal(await open.getAttribute('data-session-id'), 'sess-B');
  await open.click();
  assert.match(await body.innerText(), /Preview：完全解析の閲覧先はまだ接続していません/);
  await p.__ctx.close();
});

test('mypage unknown：購入CTAを出さない（シート・ページとも）', { skip: skip() }, async () => {
  const p = await mypage('unknown');
  assert.equal(await p.locator('#mpUpgradeTrigger').innerText(), '状態を確認');
  await p.click('#mpUpgradeTrigger');
  assert.match(await sheetText(p), /購入状態を確認できませんでした/);
  assert.equal(await p.locator('a[href*="buy.stripe"]').count(), 0);
  await p.__ctx.close();
});

test('mypage 実データ（Preview指定なし）：完全解析の権利APIが無いので unknown、購入CTAなし', { skip: skip() }, async () => {
  const p = await mypage(null);
  assert.equal(await p.locator('#mpUpgradeTrigger').innerText(), '状態を確認');
  await p.click('#mpUpgradeTrigger');
  assert.equal(await p.locator('#mpUpgradeBody a[href*="buy.stripe"]').count(), 0);
  // 既存の解析レポート導線（LATEST RESULT 内の ¥1,000）はそのまま残る
  assert.ok(await p.locator('.mp-latest a[href*="buy.stripe"]').count() >= 1);
  await p.__ctx.close();
});

test('mypage 記録別の権利：過去Aだけ complete、最新Bは free。BからAを開けない', { skip: skip() }, async () => {
  const p = await mypage('free', '&preview_past=complete-ready');
  assert.equal(await p.locator('#mp-rec-1.is-complete .mp-chip.complete').count(), 1);
  assert.equal(await p.locator('#mp-rec-0.is-complete').count(), 0);
  assert.equal(await p.locator('#mp-rec-0 .mp-chip.locked').count(), 1);
  assert.equal(await p.locator('.mp-badge.is-complete').count(), 1);
  assert.equal(await p.locator('#mpUpgradeTrigger').innerText(), 'アップグレード');
  // 過去Aの完全解析は開ける（Preview では閲覧先未接続の案内）
  await p.click('#mp-rec-1 > summary');
  const openA = p.locator('#mp-rec-1 .ca-rec-complete button');
  assert.equal(await openA.getAttribute('data-session-id'), 'sess-A');
  await openA.click();
  assert.match(await p.locator('#mp-rec-1 .ca-rec-complete').innerText(), /この記録だけが対象/);
  // 最新B の id では完全解析を開けない（Aの状態・URLを参照しない）
  const res = await p.evaluate(async () => {
    const b = document.createElement('button'); const w = document.createElement('div'); w.appendChild(b); document.body.appendChild(w);
    await openPurchasedComplete('sess-B', b);
    return w.innerText;
  });
  assert.match(res, /まだ開けません/);
  await p.__ctx.close();
});

test('mypage：記録なし・未ログイン・読込エラー時は右上入口を出さない', { skip: skip() }, async () => {
  for (const supa of [{ rows: [] }, { signedIn: false }, { historyError: true }]) {
    const p = await page('/mypage.html?preview_entitlement=free', { supa });
    await p.waitForTimeout(400);
    assert.equal(await p.locator('#mpUpgradeTrigger').count(), 0, JSON.stringify(supa));
    await p.__ctx.close();
  }
});

test('mypage：390px／320px ではみ出さない・改行しない・reduced motion', { skip: skip() }, async () => {
  for (const width of [390, 320]) {
    const p = await mypage('free', '', { width, reducedMotion: 'reduce' });
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll ' + width);
    const t = await p.locator('#mpUpgradeTrigger').boundingBox(), e = await p.locator('.archive-header__eyebrow').boundingBox();
    assert.ok(t.height <= 38, 'no wrap'); assert.ok(e.x + e.width <= t.x, 'no overlap');
    assert.equal(await p.locator('#mpUpgradeTrigger').evaluate((el) => getComputedStyle(el).transitionDuration), '0s');
    await p.click('#mpUpgradeTrigger');
    const box = await p.locator('#latest-upgrade-dialog').boundingBox();
    assert.ok(Math.abs(box.y + box.height - p.viewportSize().height) < 1, 'bottom sheet');
    assert.ok(box.height <= p.viewportSize().height * 0.85 + 1);
    await p.__ctx.close();
  }
});

async function indexResult(state, supa) {
  const p = await page('/', supa ? { supa } : {});
  const code = await p.evaluate(() => { const a = {}; ETI_V2_QUESTIONS.forEach((q, i) => { a[q.id] = ((i * 7) % 5) - 2; }); return ETIv2.encodeAnswersV2(a, ETI_V2_QUESTIONS); });
  await p.goto(`${base}/?dv=ETI-2.0&code=${code}${state ? '&preview_entitlement=' + state : ''}`);
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  return p;
}

test('index：¥1,000主導線のあとに折りたたみ。閉じても¥1,000は使え、開くと説明とダミーCTA', { skip: skip() }, async () => {
  const p = await indexResult('free');
  const fold = p.locator('details.ca-fold');
  assert.equal(await fold.count(), 1);
  assert.equal(await fold.evaluate((d) => d.open), false);
  const btnY = (await p.locator('#lockUnlockAllBtn').boundingBox()).y, foldBox = await fold.boundingBox();
  assert.ok(foldBox.y > btnY, '¥1,000 より後');
  assert.ok(foldBox.height >= 44 && foldBox.height <= 52, 'closed height ' + foldBox.height);
  assert.equal(await p.locator('#lockUnlockAllBtn').innerText().then((s) => s.trim()), '全てのロックを解除する →');
  await p.click('details.ca-fold > summary');
  const text = await fold.innerText();
  for (const s of ['COMPLETE ANALYSIS｜完全解析', 'この結果を、46ページの一つの記録として残します。', 'MIRROR', '現在のあなたに近い10名', 'HIDDEN SHAPE', '表に出にくい一面に近い10名', 'MENTOR', 'これから伸ばす方向に近い10名', '解析レポートの内容も含まれます。', 'この記録を完全解析する', '¥3,000']) assert.ok(text.includes(s), s);
  // 決済前のボタンに「見る」「開く」を使わない
  const ctaText = (await fold.locator('a[data-preview-dummy="true"]').innerText()).trim();
  assert.equal(ctaText, 'この記録を完全解析する');
  assert.ok(!/見る|開く/.test(ctaText));
  assert.equal(await fold.locator('.ca-lens').count(), 3);
  const cta = fold.locator('a[data-preview-dummy="true"]');
  assert.match(await cta.getAttribute('href'), /buy\.stripe\.com\/test_/);
  // 料金概要に¥3,000・ナラティブを出さない
  const html = await p.content();
  assert.ok(!html.includes('ナラティブ'));
  assert.ok(!/料金<\/dt><dd[^>]*>[^<]*¥3,000/.test(html));
  await p.__ctx.close();
});

test('index：Preview指定なしでは購入状態不明として¥3,000CTAを出さない／JS無しでも details で到達できる', { skip: skip() }, async () => {
  const p = await indexResult(null);
  await p.click('details.ca-fold > summary');
  assert.equal(await p.locator('details.ca-fold a[href*="buy.stripe"]').count(), 0);
  assert.match(await p.locator('details.ca-fold').innerText(), /購入状態を確認できないため/);
  assert.equal(await p.locator('details.ca-fold > summary').evaluate((s) => s.parentElement.tagName), 'DETAILS');
  await p.__ctx.close();
});

test('index：Kit 同意欄は初期OFF・ラベル全体がタップ領域・44px', { skip: skip() }, async () => {
  // 未ログイン（保存前）の記録カードで確認する。ログイン済みで同じ結果が保存済みなら同意欄は出ない（正しい挙動）
  const p = await indexResult(null, { signedIn: false });
  await p.waitForSelector('#newsletterOptInCheckbox', { state: 'attached', timeout: 5000 });
  const cb = p.locator('#newsletterOptInCheckbox');
  assert.equal(await cb.isChecked(), false);
  await p.locator('label.rs-optin').scrollIntoViewIfNeeded();
  await p.locator('.rs-optin-sub').click();
  assert.equal(await cb.isChecked(), true);
  const lb = await p.locator('label.rs-optin').boundingBox();
  assert.ok(lb.height >= 44);
  assert.ok(parseFloat(await p.locator('label.rs-optin').evaluate((e) => getComputedStyle(e).fontSize)) >= 12);
  await p.__ctx.close();
});

async function report(state) {
  global.__reportData = { diagnosis_version: 'ETI-2.0', entitlements: { core_analysis_access: true, journey_report_access: false }, purchase: null };
  const p0 = await page('/');
  const code = await p0.evaluate(() => { const a = {}; ETI_V2_QUESTIONS.forEach((q, i) => { a[q.id] = ((i * 7) % 5) - 2; }); return ETIv2.encodeAnswersV2(a, ETI_V2_QUESTIONS); });
  await p0.__ctx.close();
  global.__reportData.code = code;
  const p = await page(`/report.html?token=x${state ? '&preview_entitlement=' + state : ''}`);
  await p.waitForSelector('.ca-r-sec', { state: 'attached' });
  return p;
}

test('report：旧ナラティブ欄を置換。解析購入者には追加¥2,000だけ', { skip: skip() }, async () => {
  const p = await report('analysis');
  const html = await p.content();
  for (const gone of ['NARRATIVE REPORT', 'narrativeCodeText', 'narrative_report', 'dRmeV52XU1EV6f62BU3Nm09', 'ナラティブレポート']) assert.ok(!html.includes(gone), gone);
  const sec = p.locator('.ca-r-sec');
  const text = await sec.innerText();
  assert.ok(text.includes('この観測を、三つの人物像とともに統合する。'));
  assert.ok(text.includes('追加 ¥2,000')); assert.ok(!text.includes('¥3,000') && !text.includes('¥1,000'));
  // 購入へ進むCTAは1つだけ。「内容を見る」ボタンは置かない
  assert.equal(await sec.locator('a[href*="buy.stripe"]').count(), 1);
  assert.equal(await sec.locator('a, button, summary').count(), 1);
  assert.equal((await sec.locator('a[data-preview-dummy="true"]').innerText()).trim(), 'この記録を完全解析する');
  assert.ok(!text.includes('完全解析の内容を見る'));
  // 構成順：英語見出し → 三つの人物像 → 統合の説明 → 追加¥2,000 → CTA
  const order = await sec.evaluate((e) => ['.ca-eyebrow', '.ca-lens-list', '.ca-body', '.ca-r-price', 'a.ca-r-btn'].map((q) => e.querySelector(q).getBoundingClientRect().top));
  assert.deepEqual([...order].sort((x, y) => x - y), order);
  await p.__ctx.close();
});

test('report：generating／ready／unknown', { skip: skip() }, async () => {
  let p = await report('complete-generating');
  assert.match(await p.locator('.ca-r-sec').innerText(), /完全解析を生成しています/);
  assert.equal(await p.locator('.ca-r-sec a[href*="buy.stripe"]').count(), 0);
  await p.__ctx.close();
  p = await report('complete-ready');
  assert.match(await p.locator('.ca-r-sec').innerText(), /完全解析が保存されています/);
  assert.equal(await p.locator('.ca-r-sec').getByText('この記録の完全解析を開く').count(), 1);
  await p.__ctx.close();
  p = await report(null);
  assert.equal(await p.locator('.ca-r-sec a[href*="buy.stripe"]').count(), 0);
  await p.__ctx.close();
});

test('report：complete 権だけでも解析レポートを閲覧できる（core_complete_access が analysis を内包）', { skip: skip() }, async () => {
  global.__reportData = { diagnosis_version: 'ETI-2.0', entitlements: { core_analysis_access: false, core_complete_access: true }, purchase: null };
  const p0 = await page('/');
  global.__reportData.code = await p0.evaluate(() => { const a = {}; ETI_V2_QUESTIONS.forEach((q, i) => { a[q.id] = ((i * 7) % 5) - 2; }); return ETIv2.encodeAnswersV2(a, ETI_V2_QUESTIONS); });
  await p0.__ctx.close();
  const p = await page('/report.html?token=x');
  await p.waitForSelector('.ca-r-sec', { state: 'attached' });
  assert.equal(await p.getByText('この商品はまだご覧いただけません').count(), 0);
  await p.__ctx.close();
  global.__reportData = { diagnosis_version: 'ETI-2.0', entitlements: { core_analysis_access: false, journey_report_access: true }, purchase: null };
  const q = await page('/report.html?token=x');
  await q.waitForSelector('.err-box', { state: 'attached' });
  assert.equal(await q.getByText('この商品はまだご覧いただけません').count(), 1);
  await q.__ctx.close();
});

// ---- 視覚面の確認（白一色にしない・人物像の区別・閉じるボタンの重なり） ----
async function colorsOf(p, sel) {
  return p.evaluate((q) => Array.from(document.querySelectorAll(q)).map((e) => getComputedStyle(e).color), sel);
}
test('視覚：シートの文字色が役割で分かれ、三つの人物像が色と説明の両方で区別できる', { skip: skip() }, async () => {
  const p = await mypage('free');
  await p.click('#mpUpgradeTrigger');
  const textColors = new Set(await p.evaluate(() => Array.from(document.querySelectorAll('#mpUpgradeBody *'))
    .filter((e) => e.childNodes.length && Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()))
    .map((e) => getComputedStyle(e).color)));
  assert.ok(textColors.size >= 5, 'text colors ' + [...textColors].join(' '));
  const white = await p.evaluate(() => Array.from(document.querySelectorAll('#mpUpgradeBody *'))
    .filter((e) => Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim()))
    .filter((e) => /^rgb\((2[3-5]\d), (2[3-5]\d), (2[3-5]\d)\)$/.test(getComputedStyle(e).color) && !e.closest('.ca-primary-action')).length);
  assert.equal(white, 0, '塗りCTA以外に白に近い文字を使わない');
  const lensColors = await colorsOf(p, '#mpUpgradeBody .ca-card--secondary .ca-lens-en');
  assert.equal(new Set(lensColors).size, 3);
  const descs = await p.locator('#mpUpgradeBody .ca-card--secondary .ca-lens-desc').allInnerTexts();
  assert.equal(new Set(descs).size, 3);
  assert.equal(await p.locator('.ca-price').first().evaluate((e) => getComputedStyle(e).color), 'rgb(201, 168, 96)');
  // 小さい補足文字も読める明るさ（--ca-muted 以上）・11px以上
  const small = await p.evaluate(() => Array.from(document.querySelectorAll('#mpUpgradeBody .ca-meta, #mpUpgradeBody .ca-preview-note, #mpUpgradeBody .ca-eyebrow')).map((e) => parseFloat(getComputedStyle(e).fontSize)));
  assert.ok(small.every((n) => n >= 10.5), small.join(','));
  await p.__ctx.close();
});

test('視覚：シートをスクロールしても閉じるボタンは本文と重ならない', { skip: skip() }, async () => {
  const p = await mypage('free');
  await p.click('#mpUpgradeTrigger');
  await p.locator('#mpUpgradeBody').evaluate((e) => { e.scrollTop = 300; });
  const close = await p.locator('#mpUpgradeClose').boundingBox(), scroll = await p.locator('#mpUpgradeBody').boundingBox();
  assert.ok(close.y + close.height <= scroll.y + 4, 'close sits above the scroll area');
  await p.__ctx.close();
});

test('視覚：全状態・index・report が 390px／320px で横スクロールしない', { skip: skip() }, async () => {
  for (const width of [390, 320]) {
    for (const st of ['free', 'analysis', 'complete-generating', 'complete-ready', 'unknown']) {
      const p = await mypage(st, '', { width });
      await p.click('#mpUpgradeTrigger');
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth
        && Array.from(document.querySelectorAll('#mpUpgradeBody *')).every((e) => e.getBoundingClientRect().right <= window.innerWidth + 0.5)), `${st} ${width}`);
      await p.__ctx.close();
    }
  }
});

// ---- 旧版（element-v1）記録：完全解析の適格性（fail-closed） ----
test('旧版記録：完全解析の購入ボタン（¥3,000・追加¥2,000）とセクションを出さない／解析レポートだけ', { skip: skip() }, async () => {
  for (const st of ['free', 'analysis', 'complete-generating', 'complete-ready']) {
    const p = await page(`/mypage.html?preview_entitlement=${st}`, { supa: { rows: [LEGACY_ROW, A.row] } });
    await p.waitForSelector('.mp-latest', { state: 'attached' });
    // preview_entitlement で complete を指定しても、旧版の最新記録には COMPLETE 表示・完全解析を開く導線を出さない
    assert.equal(await p.locator('.mp-latest.is-complete, .mp-latest .mp-chip.complete, .mp-latest .ca-rec-complete').count(), 0, st);
    const t = p.locator('#mpUpgradeTrigger');
    if (st === 'free') {
      assert.equal(await t.innerText(), 'アップグレード');
      await t.click();
      const body = p.locator('#mpUpgradeBody');
      const text = await body.innerText();
      assert.ok(text.includes('¥1,000'), '解析レポートは表示');
      assert.ok(!text.includes('¥3,000') && !text.includes('¥2,000'), st);
      assert.equal(await body.locator('.ca-card--secondary, .ca-lens-list').count(), 0, '完全解析セクションなし');
      assert.equal(await body.locator('a[data-preview-dummy="true"], a[data-product-id^="core_complete_analysis"]').count(), 0);
      assert.match(text, /最新版の100問で診断した記録が対象/);
      // 既存の RE-DIAGNOSIS へ案内する
      await body.getByText('最新版で診断する（RE-DIAGNOSIS）').click();
      assert.equal(await p.locator('#mpUpgradeOverlay').isHidden(), true);
    } else {
      // 解析レポート購入済み（＝この記録に開ける導線が無い）なら入口を出さない
      assert.equal(await t.count(), 0, st);
    }
    assert.equal(await p.locator('a[data-product-id^="core_complete_analysis"]').count(), 0);
    await p.__ctx.close();
  }
});

test('旧版記録：完全解析用の関数を直接呼んでも購入先・閲覧先へ進めない', { skip: skip() }, async () => {
  const p = await page('/mypage.html?preview_entitlement=complete-ready', { supa: { rows: [LEGACY_ROW, A.row] } });
  await p.waitForSelector('.mp-latest', { state: 'attached' });
  const r = await p.evaluate(async () => {
    const rec = window.__mpRecords[0];
    const st = caStateOf(rec);
    const b = document.createElement('button'); const w = document.createElement('div'); w.appendChild(b); document.body.appendChild(w);
    await openPurchasedComplete('sess-L', b);
    const html = caSheetBodyHtml(rec);
    return { href: caCompleteCheckoutHref(rec), eligible: st.completeEligible, completeAccess: st.completeAccess,
      offer: CompleteAnalysis.completeCheckoutHref(st), msg: w.innerText, buy: /data-product-id="core_complete_analysis/.test(html) };
  });
  assert.equal(r.href, null); assert.equal(r.offer, null);
  assert.equal(r.eligible, false); assert.equal(r.completeAccess, false);
  assert.match(r.msg, /まだ開けません/);
  assert.equal(r.buy, false);
  await p.__ctx.close();
});

test('旧版記録：unknown は従来どおり購入ボタンを出さない', { skip: skip() }, async () => {
  const p = await page('/mypage.html?preview_entitlement=unknown', { supa: { rows: [LEGACY_ROW, A.row] } });
  await p.waitForSelector('.mp-latest', { state: 'attached' });
  await p.click('#mpUpgradeTrigger');
  assert.equal(await p.locator('a[href*="buy.stripe"]').count(), 0);
  await p.__ctx.close();
});

test('旧版の結果：index と report に完全解析の購入導線を出さない', { skip: skip() }, async () => {
  // index：旧版コード（?code=）の結果
  const p = await page('/');
  const legacyCode = await p.evaluate(() => { const a = {}; for (let i = 0; i < QUESTIONS.length; i++) a[i] = (i % 5) - 2; return encodeAnswers(a); });
  await p.goto(`${base}/?code=${legacyCode}&preview_entitlement=free`);
  await p.waitForSelector('#lockUnlockAllBtn', { state: 'attached' });
  assert.equal(await p.locator('details.ca-fold').count(), 0);
  assert.equal(await p.locator('#lockUnlockAllBtn').count(), 1, '¥1,000 の主導線はそのまま');
  await p.__ctx.close();
  // report：旧版の解析レポート
  global.__reportData = { diagnosis_version: 'element-v1', entitlements: { core_analysis_access: true }, purchase: null, code: legacyCode };
  const q = await page('/report.html?token=x&preview_entitlement=analysis');
  await q.waitForSelector('#pdfSaveBtn', { state: 'attached' });
  assert.equal(await q.locator('.ca-r-sec').count(), 0);
  assert.equal(await q.locator('a[data-product-id^="core_complete_analysis"]').count(), 0);
  await q.__ctx.close();
});

test('適格性は表示文字ではなく保存データで判定する（版・設問版・回答の検証）', { skip: skip() }, async () => {
  // 版は ETI-2.0 でも、設問版が違う／回答が復元できない記録は不適格
  const badItem = JSON.parse(JSON.stringify(B.row)); badItem.id = 'sess-X'; badItem.item_set_version = 'ETI-ITEM-1.9.0'; badItem.diagnosis_results[0].item_set_version = 'ETI-ITEM-1.9.0';
  const badCode = JSON.parse(JSON.stringify(B.row)); badCode.id = 'sess-Y'; badCode.diagnosis_answers = [{ encoded_answers: 'zz!!' }];
  for (const row of [badItem, badCode]) {
    const p = await page('/mypage.html?preview_entitlement=free', { supa: { rows: [row, A.row] } });
    await p.waitForSelector('.mp-latest', { state: 'attached' });
    await p.click('#mpUpgradeTrigger');
    assert.equal(await p.locator('#mpUpgradeBody a[data-product-id^="core_complete_analysis"]').count(), 0, row.id);
    await p.__ctx.close();
  }
});
