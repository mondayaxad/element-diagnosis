// 登録完了モーダル（js/registration-onboarding.js）の画面テスト（Playwright）。2026-10-07
// Supabase・API はすべて偽物。Playwright が無い環境では skip する。
//   実行: node --test tests/registration_modal_ui.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { previewPublicConfigJs } = require('./fixtures/server_env');

let chromium = null;
for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
  try { ({ chromium } = require(p)); break; } catch (e) { /* 次を試す */ }
}
const skip = () => !chromium;
const ROOT = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml' };
const NOTICE = '登録した方には、診断結果の保存やアカウント管理に必要なご案内のほか、元素診断のアップデート、新しい解析、関連する商品・企画などのお知らせをメールでお届けすることがあります。配信はいつでも停止できます。';

// モーダルだけを開く検証用ページ（サーバー上の仮想ページ。リポジトリには置かない）
const MODAL_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<body style="background:#07070f;color:#e0dcf0;font-family:sans-serif;margin:0"><button id="opener">開く</button>
<script src="/js/registration-onboarding.js"></script>
<script>
  window.__accepts = 0;
  window.__open = function (failFirst) {
    window.__result = undefined;
    return showRegistrationOnboarding({ userId: 'user-1', onAccept: async function () {
      window.__accepts += 1;
      await new Promise(function (r) { setTimeout(r, 150); });
      if (failFirst && window.__accepts === 1) return { ok: false };
      return { ok: true };
    } }).then(function (r) { window.__result = r; return r; });
  };
</script></body>`;

let server, base, browser;
test.before(async () => {
  if (!chromium) return;
  server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/__modal.html') { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(MODAL_PAGE); }
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

async function modalPage({ width = 390, height = 844 } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(5000);
  await p.goto(base + '/__modal.html');
  p.__ctx = ctx;
  return p;
}
async function open(p, failFirst) {
  await p.evaluate((f) => { window.__open(f); }, !!failFirst);
  await p.waitForSelector('.ro-dialog');
}

test('表示：見出し・必須の2項目・一括チェック・説明文（ボタン直前）・ボタン2つ。メール専用チェックは無い', { skip: skip() }, async () => {
  const p = await modalPage();
  await open(p);
  const d = p.locator('.ro-dialog');
  assert.equal(await d.getAttribute('role'), 'dialog');
  assert.equal(await d.getAttribute('aria-modal'), 'true');
  assert.equal(await p.locator('#roTitle').innerText(), '利用規約とプライバシーポリシー');
  assert.equal(await p.locator('input[type=checkbox]').count(), 3);
  assert.equal((await p.locator('.ro-all').innerText()).trim(), '下記の規約にすべて同意する');
  assert.match(await p.locator('label:has(#roTerms)').innerText(), /利用規約（必須）/);
  assert.match(await p.locator('label:has(#roPrivacy)').innerText(), /プライバシーポリシー（必須）/);
  assert.equal(await p.locator('#roNotice').innerText(), NOTICE);
  assert.equal(await p.locator('#roNo').innerText(), 'いいえ');
  assert.equal(await p.locator('#roYes').innerText(), '同意して登録を完了する');
  // 説明文はボタンの直前（間にあるのはエラー表示欄だけ）
  const order = await p.evaluate(() => Array.from(document.querySelector('.ro-dialog').children).map((e) => e.id || e.className));
  assert.ok(order.indexOf('roNotice') < order.indexOf('ro-actions'));
  assert.deepEqual(order.slice(order.indexOf('roNotice')), ['roNotice', 'roErr', 'ro-actions']);
  // リンクは新しいタブ
  for (const [sel, href] of [['label:has(#roTerms) a', '/terms.html'], ['label:has(#roPrivacy) a', '/privacy.html']]) {
    assert.equal(await p.locator(sel).getAttribute('href'), href);
    assert.equal(await p.locator(sel).getAttribute('target'), '_blank');
    assert.match(await p.locator(sel).getAttribute('rel'), /noopener/);
  }
  await p.__ctx.close();
});

test('説明文は読める大きさ（13px以上）とコントラスト（4.5:1以上）', { skip: skip() }, async () => {
  const p = await modalPage();
  await open(p);
  const r = await p.evaluate(() => {
    const parse = (c) => c.match(/[\d.]+/g).map(Number);
    const n = document.getElementById('roNotice');
    const cs = getComputedStyle(n);
    const fg = parse(cs.color);
    const box = parse(cs.backgroundColor); // rgba
    const dlg = parse(getComputedStyle(document.querySelector('.ro-dialog')).backgroundColor);
    const a = box.length > 3 ? box[3] : 1;
    const bg = [0, 1, 2].map((i) => box[i] * a + dlg[i] * (1 - a));
    const lum = (c) => { const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
    const L1 = lum(fg), L2 = lum(bg);
    return { size: parseFloat(cs.fontSize), ratio: (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05) };
  });
  assert.ok(r.size >= 13, String(r.size));
  assert.ok(r.ratio >= 4.5, String(r.ratio));
  await p.__ctx.close();
});

test('必須2項目がそろうまで同意ボタンは押せない。一括チェックは2項目を切り替え、片方だけなら中間表示', { skip: skip() }, async () => {
  const p = await modalPage();
  await open(p);
  const yes = p.locator('#roYes');
  assert.equal(await yes.isDisabled(), true);
  await p.locator('#roTerms').check();
  assert.equal(await yes.isDisabled(), true);
  assert.equal(await p.locator('#roAll').evaluate((e) => e.indeterminate), true);
  await p.locator('#roPrivacy').check();
  assert.equal(await yes.isDisabled(), false);
  assert.equal(await p.locator('#roAll').isChecked(), true);
  await p.locator('#roAll').uncheck();
  assert.equal(await p.locator('#roTerms').isChecked(), false);
  assert.equal(await p.locator('#roPrivacy').isChecked(), false);
  assert.equal(await yes.isDisabled(), true);
  await p.locator('#roAll').check();
  assert.equal(await p.locator('#roTerms').isChecked(), true);
  assert.equal(await p.locator('#roPrivacy').isChecked(), true);
  await p.__ctx.close();
});

test('キーボード：初期フォーカスは一括チェック、Space で選べる、Tab／Shift+Tab はモーダル内で循環、Esc では閉じない', { skip: skip() }, async () => {
  const p = await modalPage();
  await open(p);
  const activeId = () => p.evaluate(() => document.activeElement.id || document.activeElement.getAttribute('href') || document.activeElement.tagName);
  assert.equal(await activeId(), 'roAll');
  await p.keyboard.press('Space');
  assert.equal(await p.locator('#roYes').isDisabled(), false);
  // 前へ・後ろへ1周しても、フォーカスはモーダルの外へ出ない
  const seen = [];
  for (let i = 0; i < 10; i++) { await p.keyboard.press('Tab'); seen.push(await activeId()); }
  assert.ok(seen.every((id) => id !== 'opener' && id !== 'BODY'), JSON.stringify(seen));
  assert.ok(seen.includes('roYes') && seen.includes('roNo') && seen.includes('/terms.html'));
  await p.locator('#roAll').focus();
  await p.keyboard.press('Shift+Tab');
  assert.equal(await activeId(), 'roYes');
  await p.keyboard.press('Escape');
  assert.equal(await p.locator('.ro-dialog').count(), 1);
  assert.equal(await p.evaluate(() => window.__result), undefined);
  await p.__ctx.close();
});

test('390px：横にはみ出さない・ボタンは44px以上・320pxでも収まる', { skip: skip() }, async () => {
  for (const width of [390, 320]) {
    const p = await modalPage({ width, height: 700 });
    await open(p);
    const m = await p.evaluate(() => {
      const r = document.querySelector('.ro-dialog').getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, vw: window.innerWidth, left: r.left, right: r.right,
        yesH: document.getElementById('roYes').getBoundingClientRect().height, noH: document.getElementById('roNo').getBoundingClientRect().height };
    });
    assert.ok(m.sw <= m.vw, JSON.stringify(m));
    assert.ok(m.left >= 0 && m.right <= m.vw, JSON.stringify(m));
    assert.ok(m.yesH >= 44 && m.noH >= 44, JSON.stringify(m));
    await p.__ctx.close();
  }
});

test('規約リンクを開いて戻っても選択を維持（新しいタブ・再読込のどちらでも）', { skip: skip() }, async () => {
  const p = await modalPage();
  await open(p);
  await p.locator('#roTerms').check();
  const [tab] = await Promise.all([p.__ctx.waitForEvent('page'), p.locator('label:has(#roPrivacy) a').click()]);
  await tab.waitForLoadState();
  assert.match(tab.url(), /\/privacy\.html$/);
  await tab.close();
  await p.bringToFront();
  assert.equal(await p.locator('#roTerms').isChecked(), true);
  assert.equal(await p.locator('#roPrivacy').isChecked(), false, 'リンクを押しただけでは選択を変えない');
  // 同じタブで再読込してから開き直しても、同じユーザーなら選択が戻る
  await p.reload();
  await open(p);
  assert.equal(await p.locator('#roTerms').isChecked(), true);
  await p.__ctx.close();
});

test('二重クリックでも記録は1回。完了したら閉じて accepted、一時保持は消える', { skip: skip() }, async () => {
  const p = await modalPage();
  await open(p);
  await p.locator('#roAll').check();
  await p.locator('#roYes').dblclick();
  await p.waitForFunction(() => window.__result !== undefined);
  assert.equal(await p.evaluate(() => window.__accepts), 1);
  assert.equal(await p.evaluate(() => window.__result), 'accepted');
  assert.equal(await p.locator('.ro-dialog').count(), 0);
  assert.equal(await p.evaluate(() => sessionStorage.getItem('registrationOnboardingDraft_v1:user-1')), null);
  await p.__ctx.close();
});

test('記録に失敗したらモーダル内にエラーを出し、閉じずに再試行できる', { skip: skip() }, async () => {
  const p = await modalPage();
  await open(p, true);
  await p.locator('#roAll').check();
  await p.locator('#roYes').click();
  await p.waitForFunction(() => document.getElementById('roErr').textContent.length > 0);
  assert.match(await p.locator('#roErr').innerText(), /登録を完了できませんでした/);
  assert.equal(await p.locator('#roYes').isDisabled(), false);
  assert.equal(await p.evaluate(() => window.__result), undefined);
  await p.locator('#roYes').click();
  await p.waitForFunction(() => window.__result === 'accepted');
  assert.equal(await p.evaluate(() => window.__accepts), 2);
  await p.__ctx.close();
});

test('いいえ：declined で閉じる', { skip: skip() }, async () => {
  const p = await modalPage();
  await open(p);
  await p.locator('#roNo').click();
  await p.waitForFunction(() => window.__result !== undefined);
  assert.equal(await p.evaluate(() => window.__result), 'declined');
  assert.equal(await p.locator('.ro-dialog').count(), 0);
  await p.__ctx.close();
});

// ---- マイページでの通し確認（偽の Supabase。onboarding_status は __status で決める） ----
function fakeSupabase(status) {
  return `window.__log = []; window.supabase = { createClient() {
    let user = { id: "user-1", email: "owner@example.test" };
    let status = ${JSON.stringify(status)};
    const cbs = [];
    function builder(table) {
      let one = false;
      const q = new Proxy({}, { get(_t, k) {
        if (k === 'then') return (res, rej) => {
          let out;
          if (table === 'profiles') out = { data: { onboarding_status: status, newsletter_sync_status: status === 'completed' ? 'synced' : null, newsletter_sync_attempts: status === 'completed' ? 1 : 0, newsletter_sync_attempted_at: null }, error: null };
          else out = { data: one ? null : [], error: null };
          return Promise.resolve(out).then(res, rej);
        };
        if (k === 'single' || k === 'maybeSingle') return () => { one = true; return q; };
        return () => q;
      } });
      return q;
    }
    return { from: builder,
      rpc: async (name) => { window.__log.push('rpc:' + name); if (name === 'complete_registration_onboarding') { status = 'completed'; return { data: { onboarding_status: 'completed', newsletter_sync_status: 'pending' }, error: null }; } return { data: null, error: status === 'required' ? { message: 'onboarding_required' } : null }; },
      auth: { getUser: async () => ({ data: { user } }), getSession: async () => ({ data: { session: user ? { access_token: "t" } : null } }),
        onAuthStateChange(cb) { cbs.push(cb); setTimeout(() => cb('INITIAL_SESSION', user ? { access_token: 't' } : null), 0); return { data: { subscription: { unsubscribe() {} } } }; },
        signOut: async () => { window.__log.push('signOut'); user = null; cbs.forEach((cb) => cb('SIGNED_OUT', null)); return {}; },
        signInWithOAuth: async () => ({ error: null }) } };
  } };`;
}

async function mypageWith(status) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  const pageErrors = [];
  p.on('pageerror', (e) => pageErrors.push(String(e)));
  const subscribeCalls = [];
  await p.route(/supabase-js@2/, (r) => r.fulfill({ contentType: 'application/javascript', body: fakeSupabase(status) }));
  await p.route(/\/api\/public-config\?format=js$/, (r) => r.fulfill({ contentType: 'application/javascript', body: previewPublicConfigJs() }));
  await p.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await p.route(/cdnjs\.cloudflare\.com|googletagmanager/, (r) => r.fulfill({ contentType: 'application/javascript', body: '' }));
  await p.route('**/api/my-entitlements', (r) => r.fulfill({ contentType: 'application/json', body: '{"purchased_by_version":{}}' }));
  await p.route('**/api/subscribe', (r) => { subscribeCalls.push(1); r.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"kit_error"}' }); });
  await p.addInitScript(() => {
    // 未保存の v2 診断（OAuth 往復前に一時保存されたもの）
    if (!localStorage.getItem('__seeded')) {
      localStorage.setItem('__seeded', '1');
      localStorage.setItem('pendingDiagnosis_v2', JSON.stringify({ diagnosisType: 'element', diagnosisVersion: 'ETI-2.0', clientSessionId: 'c-1',
        answersV2: [1], encodedAnswers: 'X', results: { personality: {}, style: {}, values: {}, valuesCentered: {}, elementRanking: [], weaponRanking: [], nationRanking: [] }, createdAt: Date.now() }));
    }
  });
  await p.goto(base + '/mypage.html');
  p.__ctx = ctx; p.__subscribeCalls = subscribeCalls; p.__pageErrors = pageErrors;
  return p;
}

test('マイページ：新規ユーザーは登録完了モーダル → いいえでサインアウト・ログイン画面・pending は残る', { skip: skip() }, async () => {
  const p = await mypageWith('required');
  await p.waitForSelector('.ro-dialog');
  assert.equal(await p.locator('.ro-dialog').count(), 1, 'モーダルは1つだけ');
  await p.locator('#roNo').click();
  await p.waitForSelector('#gateAuth');
  assert.match(await p.locator('#gateMsg').innerText(), /登録を完了していないため、ログアウトしました/);
  const log = await p.evaluate(() => window.__log);
  assert.ok(log.includes('signOut'));
  assert.ok(!log.some((x) => x.startsWith('rpc:')), JSON.stringify(log));
  assert.ok(await p.evaluate(() => !!localStorage.getItem('pendingDiagnosis_v2')));
  assert.equal(p.__subscribeCalls.length, 0);
  // ログイン画面は新規／既存を断定しない
  const gate = await p.locator('#gateAuth').innerText();
  assert.match(gate, /Googleで続ける/); assert.match(gate, /Xで続ける/); assert.match(gate, /メールで続ける/);
  assert.doesNotMatch(gate, /新規登録|再ログイン/);
  assert.deepEqual(p.__pageErrors, [], 'ページの JS エラーなし');
  await p.__ctx.close();
});

test('マイページ：同意 → 記録 → 保存 → Kit 同期（Kit 障害でも記録は表示まで進む）', { skip: skip() }, async () => {
  const p = await mypageWith('required');
  await p.waitForSelector('.ro-dialog');
  await p.locator('#roAll').check();
  await p.locator('#roYes').click();
  await p.waitForFunction(() => !document.querySelector('.ro-dialog'));
  await p.waitForFunction(() => window.__log.includes('rpc:save_diagnosis_session_v2'));
  await p.waitForFunction(() => !localStorage.getItem('pendingDiagnosis_v2'));
  const log = await p.evaluate(() => window.__log);
  assert.ok(log.indexOf('rpc:complete_registration_onboarding') < log.indexOf('rpc:save_diagnosis_session_v2'), JSON.stringify(log));
  await p.waitForFunction(() => document.querySelector('#root') && !document.querySelector('#gateAuth'));
  assert.equal(p.__subscribeCalls.length, 1, 'Kit 同期は1回（障害は画面のエラーにしない）');
  assert.equal(await p.locator('.ro-dialog').count(), 0);
  assert.deepEqual(p.__pageErrors, [], 'ページの JS エラーなし');
  await p.__ctx.close();
});

test('マイページ：既存ユーザー（completed／legacy_exempt）にはモーダルを出さない', { skip: skip() }, async () => {
  for (const status of ['completed', 'legacy_exempt']) {
    const p = await mypageWith(status);
    await p.waitForFunction(() => window.__log.includes('rpc:save_diagnosis_session_v2'));
    assert.equal(await p.locator('.ro-dialog').count(), 0, status);
    assert.ok(!(await p.evaluate(() => window.__log)).includes('rpc:complete_registration_onboarding'));
    assert.deepEqual(p.__pageErrors, [], 'ページの JS エラーなし');
  await p.__ctx.close();
  }
});
