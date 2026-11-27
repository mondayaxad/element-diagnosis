// スマホ幅（390×844）で、合成ETI経路と簡易質問経路の両方を下書きまで操作する。
// すべてのリクエストを記録し、127.0.0.1 以外への通信が1件も無いことを確かめる。ISA_SAVE_SHOTS=1 のとき画面のキャプチャを docs/screenshots に保存する。
//   実行: node --test alpha/ideal-self/tests/e2e_mobile.test.js   （Playwright と Chromium が必要。無ければ skip）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from '../scripts/serve.js';

const ALPHA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 提出用のキャプチャを更新するときだけ ISA_SAVE_SHOTS=1（ふだんのテストではリポジトリを汚さない）
const SHOTS = process.env.ISA_SAVE_SHOTS === '1' ? path.join(ALPHA, 'docs', 'screenshots') : fs.mkdtempSync(path.join(os.tmpdir(), 'isa-shots-'));
const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { /* skip below */ }

async function withPage(fn) {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const requests = []; const errors = []; const cspViolations = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text()); });
  try {
    await page.goto(base);
    await fn(page, base);
    const external = requests.filter((u) => !u.startsWith(base) && !u.startsWith('data:'));
    assert.deepEqual(external, [], `外部への通信があります: ${external.join(', ')}`);
    assert.deepEqual(cspViolations, []);
    assert.deepEqual(errors, []);
    // 横スクロールが出ない
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `横にはみ出しています: ${overflow}px`);
  } finally { await browser.close(); server.close(); }
}
const tid = (page, id) => page.locator(`[data-testid="${id}"]`);
async function shot(page, name) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false }); }
async function shotFull(page, name) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true }); }

async function answerIdeal(page, plan, onScreen = async () => {}) {
  // plan: { K1: ['inner_focus','curiosity'], ... }。追加質問は「わからない」以外の先頭を選ぶ
  for (let guard = 0; guard < 20; guard++) {
    if (await tid(page, 'build-draft').count()) return;
    const title = await page.locator('main h1').innerText();
    const isFollow = await tid(page, 'followup-reason').count();
    const isMulti = (await tid(page, 'multi-next').count()) > 0;
    await onScreen(page, title);
    // 画面には質問 ID を出さないので、題名から計画を選ぶ
    const entry = Object.entries(plan).find(([, v]) => v.title && title.startsWith(v.title));
    const ids = entry ? entry[1].ids : null;
    if (ids) {
      for (const id of ids) await tid(page, `opt-${id}`).click();
    } else if (isFollow) {
      await page.locator('main button.opt').first().click();
    } else { throw new Error(`計画に無い質問: ${title}`); }
    if (isMulti) await tid(page, 'multi-next').click();
  }
  throw new Error('質問が終わりません');
}
const PLAN = {
  K1: { title: '5年後も変わらずに残したい', ids: ['inner_focus', 'curiosity'] },
  K2: { title: '「あなたらしい」', ids: ['think'] },
  K3: { title: '判断に迷ったとき', ids: ['SD', 'UN'] },
  K4: { title: 'こう変わってしまったら', ids: ['no_alone'] },
  G1: { title: '5年後までにいちばん伸ばしたい', ids: ['clear_expression'] },
  G2: { title: 'いま「もう少しできたら」', ids: ['meeting'] },
  G3: { title: '成長のしかた', ids: ['gradual'] },
  G4: { title: '伸ばしたい力について', ids: ['augment'] },
  E1: { title: '5年後のあなたは、周りから', ids: ['quiet_presence', 'unwavering_conviction'] },
  E2: { title: 'その魅力が表れて', ids: ['small_group'] },
  E3: { title: '大事な話をしたあと', ids: ['core'] },
  E4: { title: 'その魅力を持つ5年後', ids: ['organize'] },
};

test('スマホ幅：合成ETI経路で、拒否の確認 → 取込 → 理想12問 → 下書き（外部通信なし）', { skip: !chromium && 'Playwright が無い' }, async () => {
  await withPage(async (page) => {
    await shot(page, '01_consent');
    await tid(page, 'consent-eti_import').check();
    await tid(page, 'consent-next').click();
    await shot(page, '02_current_select');
    await tid(page, 'route-eti').click();
    // 本人確認前は拒否
    await tid(page, 'record-own_introvert').click();
    await tid(page, 'import').click();
    assert.match(await tid(page, 'import-error').innerText(), /本人確認/);
    await tid(page, 'identity').check();
    // 別の所有者・未知版は拒否
    for (const [key, re] of [['other_owner', /本人の記録ではない/], ['unknown', /対応していない版/], ['legacy', /旧版/], ['missing', /欠けている/]]) {
      await tid(page, `record-${key}`).click();
      await tid(page, 'import').click();
      assert.match(await tid(page, 'import-error').innerText(), re);
    }
    await shot(page, '03_import_rejected');
    await tid(page, 'record-own_introvert').click();
    await tid(page, 'import').click();
    await page.waitForSelector('[data-testid="current-traits"]');
    // 指摘1：特性の候補は「ETIからの推論」、尺度の値だけが「ETI観測値」
    const curItems = page.locator('[data-testid="current-traits"] li');
    assert.ok((await curItems.count()) >= 6);
    for (const li of await curItems.all()) {
      assert.equal(await li.getAttribute('data-status'), 'system_inferred');
      const text = await li.innerText();
      assert.match(text, /ETIからの推論/);
      assert.match(text, /ETI観測値/); // 根拠として観測値を併記
    }
    assert.match(await tid(page, 'cur-trait-inner_focus').innerText(), /一人で深く考える力\s*ETIからの推論.*外向性 24／規則 E <= 35/s);
    assert.equal(await tid(page, 'current-measurements').getAttribute('data-status'), 'observed');
    assert.equal(await page.locator('[data-testid="current-traits"] [data-status="observed"]').count(), 0);
    await shot(page, '04_current_eti');
    await tid(page, 'to-ideal').click();
    await shot(page, '05_ideal_K1');
    await answerIdeal(page, PLAN);
    await tid(page, 'build-draft').click();
    await page.waitForSelector('[data-testid="summary"]');
    const summary = await tid(page, 'summary').innerText();
    assert.match(summary, /一人で深く考える力/);
    assert.doesNotMatch(summary, /社交的|誰とでも/);
    assert.match(await tid(page, 'disclaimer').innerText(), /予測でも、検証済みの人格測定でもありません/);
    await shot(page, '06_draft_top');
    // 根拠を開いて確かめられる
    await page.locator('[data-testid="sec-protected"] details summary').first().click();
    // 指摘1：本人の選択（K1）と、ETIの値からの推論（観測値つき）が別の根拠として並ぶ
    const ev1 = page.locator('[data-testid="sec-protected"] details').first();
    assert.match(await ev1.innerText(), /本人の選択\s*K1/);
    assert.match(await ev1.innerText(), /アプリの推論.*ETI観測値.*外向性（E）= 24/s);
    assert.ok((await ev1.locator('li[data-status="user_answer"]').count()) >= 1); // K1・K2・K4

    assert.equal(await ev1.locator('li[data-status="system_inferred"]').count(), 1);
    assert.equal(await tid(page, 'draft-measurements').getAttribute('data-status'), 'observed');
    await page.locator('[data-testid="sec-protected"] details').first().scrollIntoViewIfNeeded();
    await shot(page, '07_draft_evidence');
    await shotFull(page, '08_draft_full_eti');
    const json = JSON.parse(await tid(page, 'profile-json').textContent());
    assert.equal(json.source_provenance.eti.diagnosis_version, 'ETI-2.0');
    assert.equal(json.approval_status, 'unconfirmed');
    const obsPaths = [];
    const walk = (x, at) => { if (Array.isArray(x)) x.forEach((v, i) => walk(v, `${at}[${i}]`)); else if (x && typeof x === 'object') { if (x.inference_status === 'observed') obsPaths.push(at); for (const [k, v] of Object.entries(x)) if (k !== 'legend') walk(v, `${at}.${k}`); } };
    walk(json, '$');
    assert.equal(obsPaths.length, 20);
    assert.ok(obsPaths.every((p) => p.startsWith('$.observed_measurements[')), obsPaths.join(','));
    await tid(page, 'approve').click();
    assert.match(await tid(page, 'approval').innerText(), /承認済み/);
    // 撤回すると下書きが消え、現在像の選び直しへ
    await page.locator('[data-testid="consent-panel"] summary').click();
    await tid(page, 'revoke-eti').click();
    assert.equal(await page.evaluate(() => document.body.dataset.step), 'current_select');
  });
});

test('スマホ幅：未受診（同意なし）→ 簡易6問 → 理想12問＋追加質問（優先した成長目標への確認を含む）→ 下書き → 戻って再操作（外部通信なし）', { skip: !chromium && 'Playwright が無い' }, async () => {
  await withPage(async (page) => {
    await tid(page, 'consent-next').click(); // 何にも同意しない
    await tid(page, 'route-quick').click();
    await shot(page, '11_quick_C1');
    for (const id of ['alone', 'plan', 'explore', 'understand', 'self', 'SD']) await tid(page, `opt-${id}`).click();
    await tid(page, 'quick-finish').click();
    await shot(page, '12_current_quick');
    assert.match(await tid(page, 'current-traits').innerText(), /自己申告/);
    await tid(page, 'to-ideal').click();
    // 憧れに「場を明るくする力」、G2 に「初対面の場で固くなる」を入れ、追加質問で後者（初対面でも落ち着いて関わる力）を優先する。
    // 指摘2：追加回答で確定した成長目標にも、保護特性（内省）との確認が出ること
    let growthCheckShown = false;
    await answerIdeal(page, {
      ...PLAN,
      G2: { title: PLAN.G2.title, ids: ['crowd'] },
      E1: { title: PLAN.E1.title, ids: ['radiance'] },
      PRI: { title: 'どちらを先に伸ばしたいですか', ids: ['social_ease'] },
    }, async (pg, title) => {
      if (title.includes('初めての相手とも落ち着いて関われる力')) {
        growthCheckShown = true;
        assert.match(await tid(pg, 'followup-reason').innerText(), /保護特性「一人で深く考える力」/);
        await shot(pg, '15_followup_growth_check');
      }
    });
    // ↑ 計画に無い追加質問は先頭の選択肢（＝保ったまま加える）を選んでいる
    assert.ok(growthCheckShown, '優先した成長目標への確認が表示されませんでした');
    await tid(page, 'build-draft').click();
    await page.waitForSelector('[data-testid="summary"]');
    const json = JSON.parse(await tid(page, 'profile-json').textContent());
    assert.equal(json.source_provenance.current_source, 'quick_questions');
    assert.ok(json.source_provenance.followups_asked.some((f) => f.kind === 'inversion'));
    assert.ok(json.protected_traits.some((t) => t.trait === 'inner_focus' && t.confirmed));
    assert.deepEqual(json.source_provenance.followups_asked.map((f) => f.id), ['F_INV_radiance_inner_focus', 'F_GROW_PRIORITY', 'F_INV_social_ease_inner_focus']);
    assert.equal(await tid(page, 'check-social_ease-inner_focus').getAttribute('data-resolution'), 'augment');
    await shotFull(page, '13_draft_full_quick');
    // 戻って追加質問の画面を撮る（下書きから1つ戻ると最後の質問＝追加質問）
    await page.locator('#back').click();
    await page.waitForSelector('[data-testid="followup-reason"]');
    await shot(page, '14_followup_reason');
    // E1 まで戻って変えると、憧れへの確認だけが消え、成長目標への確認は残る。下書きは作り直しになる
    for (let i = 0; i < 8; i++) {
      if ((await page.locator('main h1').innerText()).startsWith(PLAN.E1.title)) break;
      await page.locator('#back').click();
    }
    await tid(page, 'opt-radiance').click();
    await tid(page, 'opt-quiet_presence').click();
    await tid(page, 'multi-next').click();
    for (let i = 0; i < 8 && !(await tid(page, 'build-draft').count()); i++) await page.locator('main button.opt[aria-pressed="true"]').first().click();
    await tid(page, 'build-draft').click();
    const json2 = JSON.parse(await tid(page, 'profile-json').textContent());
    assert.deepEqual(json2.source_provenance.followups_asked.map((f) => f.id), ['F_GROW_PRIORITY', 'F_INV_social_ease_inner_focus']);
    assert.deepEqual(json2.aspirational_traits.map((a) => a.aspiration), ['quiet_presence']);
  });
});
