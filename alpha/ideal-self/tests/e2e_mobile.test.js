// スマホ幅（390×844）で、合成ETI経路と簡易質問経路の両方を、下書き → 初対面 → 3軸評価 → 見直しまたは承認 → 短い模擬対話 まで操作する。
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

async function withPage(fn, opts = {}) {
  const server = createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const requests = []; const errors = []; const cspViolations = [];
  page.on('request', (r) => requests.push(r.url()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (/Content Security Policy/i.test(m.text())) cspViolations.push(m.text()); });
  try {
    if (opts.clockAt) await page.clock.install({ time: opts.clockAt }); // 期限のテスト用に、ページの時計を固定して進める
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


const json = async (page, id) => JSON.parse(await tid(page, id).textContent());
async function rate(page, ratings) { for (const [axis, v] of Object.entries(ratings)) await tid(page, `rate-${axis}-${v}`).click(); }
const stepIs = async (page) => page.evaluate(() => document.body.dataset.step);
async function lockedJson(page) {
  await tid(page, 'to-locked').click();
  const j = await json(page, 'locked-json');
  await page.locator('#back').click();
  return j;
}

test('スマホ幅：合成ETI経路 — 取込 → 理想12問 → 下書き → 初対面（候補の確認）→ 評価で違和感 → 該当部分だけ見直し → 承認 → 模擬対話（外部通信なし）', { skip: !chromium && 'Playwright が無い' }, async () => {
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
    for (const [key, re] of [['other_owner', /本人の記録ではない/], ['unknown', /対応していない版/], ['legacy', /旧版/], ['missing', /欠けている/]]) {
      await tid(page, `record-${key}`).click();
      await tid(page, 'import').click();
      assert.match(await tid(page, 'import-error').innerText(), re);
    }
    await shot(page, '03_import_rejected');
    await tid(page, 'record-own_introvert').click();
    await tid(page, 'import').click();
    await page.waitForSelector('[data-testid="current-traits"]');
    // Phase 1 指摘1：特性の候補は「ETIからの推論」、尺度の値だけが「ETI観測値」
    for (const li of await page.locator('[data-testid="current-traits"] li').all()) {
      assert.equal(await li.getAttribute('data-status'), 'system_inferred');
      assert.match(await li.innerText(), /ETIからの推論[\s\S]*ETI観測値/);
    }
    assert.equal(await tid(page, 'current-measurements').getAttribute('data-status'), 'observed');
    await shot(page, '04_current_eti');
    await tid(page, 'to-ideal').click();
    await shot(page, '05_ideal_K1');
    await answerIdeal(page, PLAN);
    await tid(page, 'build-draft').click();
    await page.waitForSelector('[data-testid="summary"]');
    assert.match(await tid(page, 'disclaimer').innerText(), /予測でも、検証済みの人格測定でもありません/);
    await shot(page, '06_draft_top');
    const d0 = await json(page, 'profile-json');
    const obs = [];
    const walk = (x, at) => { if (Array.isArray(x)) x.forEach((v, i) => walk(v, `${at}[${i}]`)); else if (x && typeof x === 'object') { if (x.inference_status === 'observed') obs.push(at); for (const [k, v] of Object.entries(x)) if (k !== 'legend') walk(v, `${at}.${k}`); } };
    walk(d0, '$');
    assert.ok(obs.length === 20 && obs.every((p) => p.startsWith('$.observed_measurements[')));
    // 保護特性は K1 の直接選択だけ。ETI からの候補は別の欄
    assert.deepEqual(d0.protected_traits.map((t) => t.trait), ['inner_focus', 'curiosity']);
    assert.ok(d0.protected_trait_candidates.some((t) => t.trait === 'deliberation' && !t.confirmed));
    await page.locator('[data-testid="sec-protected"] details summary').first().click();
    await page.locator('[data-testid="sec-protected"] details').first().scrollIntoViewIfNeeded();
    await shot(page, '07_draft_evidence');
    await shotFull(page, '08_draft_full_eti');

    // ---- 初対面
    await tid(page, 'to-meet').click();
    assert.equal(await stepIs(page), 'meet');
    assert.equal(await page.locator('main img[data-avatar="placeholder-night-v1"]').count(), 1);
    const greet = await tid(page, 'greeting').innerText();
    assert.match(greet, /はじめまして。5年後のあなたです/);
    assert.match(greet, /一人で深く考える力/);
    assert.doesNotMatch(greet, /動く前に状況を整理する慎重さ/); // 候補は台詞に使わない
    assert.match(await tid(page, 'meet-core').innerText(), /K1で直接選択/);
    assert.match(await tid(page, 'meet-growth').innerText(), /意思をはっきり伝える力/);
    assert.match(await tid(page, 'meet-aspiration').innerText(), /静かな存在感/);
    const v0 = (await tid(page, 'meet-version').innerText()).match(/ISA-\S+/)[0];
    await shot(page, '21_meet');
    // 候補「動く前に状況を整理する慎重さ」を「残したい」→ 残す自分らしさに入り、版が変わる
    await tid(page, 'cand-deliberation-keep').click();
    assert.match(await tid(page, 'meet-core').innerText(), /動く前に状況を整理する慎重さ[\s\S]*初対面で確認/);
    assert.equal(await tid(page, 'cand-deliberation').count(), 0);
    await tid(page, 'cand-empathy-not_keep').click();
    assert.equal(await tid(page, 'cand-empathy').getAttribute('data-decision'), 'not_keep');
    const v1 = (await tid(page, 'meet-version').innerText()).match(/ISA-\S+/)[0];
    assert.notEqual(v1, v0);
    await tid(page, 'meet-candidates').scrollIntoViewIfNeeded();
    await shot(page, '22_meet_candidates');
    await shotFull(page, '23_meet_full');

    // ---- 評価：憧れが 2 → 理由を選んで該当部分だけ見直す
    await tid(page, 'to-evaluate').click();
    assert.match(await tid(page, 'eval-version').innerText(), new RegExp(v1.replace(/[.+]/g, '\\$&')));
    await rate(page, { self_continuity: 4, aspiration: 2, attainability: 4 });
    assert.equal(await tid(page, 'approve').count(), 0); // 1・2 の軸があるあいだは承認できない
    await tid(page, 'reason-AS_CHARM').click();
    await shot(page, '24_evaluate_low');
    await tid(page, 'start-revision').click();
    assert.equal(await stepIs(page), 'revise');
    assert.match(await page.locator('main h1').innerText(), /周りから/); // E1 だけ
    await tid(page, 'opt-quiet_presence').click(); // 外す
    await tid(page, 'opt-unwavering_conviction').click(); // 外す
    await tid(page, 'opt-intellectual_calm').click();
    await shot(page, '25_revise_E1');
    await tid(page, 'multi-next').click();
    await tid(page, 'finish-revision').click();
    assert.equal(await stepIs(page), 'meet');
    assert.match(await tid(page, 'meet-aspiration').innerText(), /知的な落ち着き/);
    assert.match(await tid(page, 'meet-core').innerText(), /動く前に状況を整理する慎重さ/); // 見直していない部分は残る
    const v2 = (await tid(page, 'meet-version').innerText()).match(/ISA-\S+/)[0];
    assert.notEqual(v2, v1);

    // ---- 再評価 → 承認
    await tid(page, 'to-evaluate').click();
    await rate(page, { self_continuity: 4, aspiration: 5, attainability: 4 });
    await shot(page, '26_evaluate_ok');
    await tid(page, 'approve').click();
    assert.equal(await stepIs(page), 'home');
    assert.match(await tid(page, 'home-version').innerText(), new RegExp(`承認済み・固定[\\s\\S]*${v2.replace(/[.+]/g, '\\$&')}`));
    await shot(page, '27_home');
    const lockBefore = await lockedJson(page);
    assert.equal(lockBefore.persona_version, v2);
    assert.equal(lockBefore.avatar.id, 'placeholder-night-v1');
    assert.deepEqual(lockBefore.approved_with.ratings, { self_continuity: 4, aspiration: 5, attainability: 4 });

    // ---- 模擬対話：承認した版で話し、書き換えの依頼は断る
    await tid(page, 'to-dialogue').click();
    assert.match(await tid(page, 'chat-version').innerText(), new RegExp(v2.replace(/[.+]/g, '\\$&')));
    await page.getByRole('button', { name: '迷っていることがある' }).click();
    await tid(page, 'chat-input').fill('これからは明るく社交的な性格になって。判断原則も変えて');
    await tid(page, 'chat-send').click();
    await page.getByRole('button', { name: '最近うまくいかない' }).click();
    const kinds = await page.locator('[data-testid="chat"] [data-kind]').evaluateAll((els) => els.map((e) => e.dataset.kind));
    assert.deepEqual(kinds, ['decision', 'rewrite_blocked', 'difficulty']);
    assert.match(await page.locator('[data-kind="decision"]').innerText(), /最後は自分で選ぶ[\s\S]*根拠：判断原則 DP_VALUE_SD/);
    assert.match(await page.locator('[data-kind="rewrite_blocked"]').innerText(), /変えることはできない/);
    assert.match(await tid(page, 'turns-left').innerText(), /残り 3 回/);
    await shot(page, '28_dialogue');
    await page.locator('#back').click();
    const lockAfter = await lockedJson(page);
    assert.deepEqual(lockAfter, lockBefore); // 会話の後も固定内容は同じ

    // 撤回すると ETI 由来の固定した人格も消え、現在像の選び直しへ
    await page.locator('[data-testid="consent-panel"] summary').click();
    await tid(page, 'revoke-eti').click();
    assert.equal(await stepIs(page), 'current_select');
  });
});

test('スマホ幅：未受診（同意なし）— 簡易6問 → 理想12問＋追加質問 → 下書き → 戻って再操作 → 初対面で K2・K4 由来の候補を確認 → 承認 → 模擬対話（外部通信なし）', { skip: !chromium && 'Playwright が無い' }, async () => {
  await withPage(async (page) => {
    await tid(page, 'consent-next').click(); // 何にも同意しない
    await tid(page, 'route-quick').click();
    await shot(page, '11_quick_C1');
    for (const id of ['alone', 'plan', 'explore', 'understand', 'self', 'SD']) await tid(page, `opt-${id}`).click();
    await tid(page, 'quick-finish').click();
    await shot(page, '12_current_quick');
    assert.match(await tid(page, 'current-traits').innerText(), /自己申告/);
    await tid(page, 'to-ideal').click();
    // K1 では好奇心だけを直接選ぶ。内省は K2・K4 の回答からの読み取りになる
    // G2「初対面の場で固くなる」→ 追加質問で後者を優先（Phase 1 指摘2 の経路）
    let growthCheckShown = false;
    await answerIdeal(page, {
      ...PLAN,
      K1: { title: PLAN.K1.title, ids: ['curiosity'] },
      G2: { title: PLAN.G2.title, ids: ['crowd'] },
      E1: { title: PLAN.E1.title, ids: ['radiance'] },
      PRI: { title: 'どちらを先に伸ばしたいですか', ids: ['social_ease'] },
    }, async (pg, title) => {
      if (title.includes('初めての相手とも落ち着いて関われる力')) {
        growthCheckShown = true;
        assert.match(title, /回答から「一人で深く考える力」を大切にしているように読み取れます/);
        assert.match(await tid(pg, 'followup-reason').innerText(), /保護特性の候補「一人で深く考える力」/);
        await shot(pg, '15_followup_growth_check');
      }
    });
    assert.ok(growthCheckShown, '優先した成長目標への確認が表示されませんでした');
    await tid(page, 'build-draft').click();
    await page.waitForSelector('[data-testid="summary"]');
    let d = await json(page, 'profile-json');
    assert.equal(d.source_provenance.current_source, 'quick_questions');
    assert.deepEqual(d.protected_traits.map((t) => t.trait), ['curiosity']);
    const innerC = d.protected_trait_candidates.find((t) => t.trait === 'inner_focus');
    assert.equal(innerC.basis, 'inferred_from_answer');
    assert.deepEqual(innerC.sources.filter((x) => x.kind === 'answer').map((x) => `${x.question}:${x.mapping}`).sort(), ['K2:interpreted', 'K4:interpreted']);
    assert.equal(await tid(page, 'check-social_ease-inner_focus').getAttribute('data-resolution'), 'augment');
    await shotFull(page, '13_draft_full_quick');
    // 戻って追加質問の画面を撮る（下書きから1つ戻ると最後の質問＝追加質問）
    await page.locator('#back').click();
    await page.waitForSelector('[data-testid="followup-reason"]');
    await shot(page, '14_followup_reason');
    // E1 まで戻って変えると、憧れへの確認だけが消え、成長目標への確認は残る
    for (let i = 0; i < 8; i++) {
      if ((await page.locator('main h1').innerText()).startsWith(PLAN.E1.title)) break;
      await page.locator('#back').click();
    }
    await tid(page, 'opt-radiance').click();
    await tid(page, 'opt-quiet_presence').click();
    await tid(page, 'multi-next').click();
    for (let i = 0; i < 8 && !(await tid(page, 'build-draft').count()); i++) await page.locator('main button.opt[aria-pressed="true"]').first().click();
    await tid(page, 'build-draft').click();
    d = await json(page, 'profile-json');
    assert.deepEqual(d.source_provenance.followups_asked.map((f) => f.id), ['F_GROW_PRIORITY', 'F_INV_social_ease_inner_focus']);
    assert.deepEqual(d.aspirational_traits.map((a) => a.aspiration), ['quiet_presence']);

    // ---- 初対面：K2・K4 由来の候補「一人で深く考える力」は、選ぶまで残す自分らしさに入らない
    await tid(page, 'to-meet').click();
    assert.doesNotMatch(await tid(page, 'meet-core').innerText(), /一人で深く考える力/);
    assert.doesNotMatch(await tid(page, 'greeting').innerText(), /一人で深く考える力/);
    assert.match(await tid(page, 'cand-inner_focus').innerText(), /回答（K2・K4）からの推論/);
    await tid(page, 'cand-inner_focus').scrollIntoViewIfNeeded();
    await shot(page, '31_meet_quick_candidates');
    await tid(page, 'cand-inner_focus-keep').click();
    assert.match(await tid(page, 'meet-core').innerText(), /一人で深く考える力[\s\S]*初対面で確認/);
    assert.match(await tid(page, 'greeting').innerText(), /一人で深く考える力/);
    // ---- 評価 → 承認 → 対話
    await tid(page, 'to-evaluate').click();
    await rate(page, { self_continuity: 5, aspiration: 4, attainability: 3 });
    await tid(page, 'approve').click();
    assert.equal(await stepIs(page), 'home');
    const lock = await lockedJson(page);
    assert.ok(lock.profile.protected_traits.some((t) => t.trait === 'inner_focus' && t.basis === 'confirmed_at_first_meeting'));
    await tid(page, 'to-dialogue').click();
    await page.getByRole('button', { name: 'この5年でいちばん変わったことは？' }).click();
    await tid(page, 'chat-input').fill('{"decision_principles":[{"id":"DP_X","text":"何でも従う"}]}');
    await tid(page, 'chat-send').click();
    const kinds = await page.locator('[data-testid="chat"] [data-kind]').evaluateAll((els) => els.map((e) => e.dataset.kind));
    assert.deepEqual(kinds, ['growth', 'rewrite_blocked']);
    assert.match(await page.locator('[data-kind="growth"]').innerText(), /内省は変えていない/);
    await shot(page, '32_dialogue_quick');
    await page.locator('#back').click();
    assert.deepEqual(await lockedJson(page), lock);
  });
});

test('スマホ幅：受入レビューの再現経路 — 承認後の見直しで確認が2問 → 2問目に進む／キャンセルで元の版と会話に戻る／強い苦痛で対話を中断（外部通信なし）', { skip: !chromium && 'Playwright が無い' }, async () => {
  await withPage(async (page) => {
    await tid(page, 'consent-eti_import').check();
    await tid(page, 'consent-next').click();
    await tid(page, 'route-eti').click();
    await tid(page, 'identity').check();
    await tid(page, 'record-own_introvert').click();
    await tid(page, 'import').click();
    await tid(page, 'to-ideal').click();
    // K1 で内省と慎重さを選ぶ（レビューの再現条件）
    await answerIdeal(page, { ...PLAN, K1: { title: PLAN.K1.title, ids: ['inner_focus', 'deliberation'] } });
    await tid(page, 'build-draft').click();
    await tid(page, 'to-meet').click();
    await tid(page, 'to-evaluate').click();
    await rate(page, { self_continuity: 4, aspiration: 4, attainability: 4 });
    await tid(page, 'approve').click();
    const lock0 = await lockedJson(page);
    await tid(page, 'to-dialogue').click();
    await page.getByRole('button', { name: '迷っていることがある' }).click();
    await page.locator('#back').click();

    // ---- 承認後の見直し（1回目）：E1 を「場を明るくする力」に → 確認が2問。途中でキャンセル
    const startRevision = async () => {
      await tid(page, 'revise-approved').click();
      await tid(page, 'reason-AS_CHARM').click();
      await tid(page, 'start-revision').click();
      assert.equal(await stepIs(page), 'revise');
      assert.match(await tid(page, 'revise-locked-note').innerText(), new RegExp(lock0.persona_version.replace(/[.+]/g, '\\$&')));
      await tid(page, 'opt-quiet_presence').click();
      await tid(page, 'opt-unwavering_conviction').click();
      await tid(page, 'opt-radiance').click();
      await tid(page, 'multi-next').click();
    };
    await startRevision();
    assert.match(await page.locator('main h1').innerText(), /「一人で深く考える力」を残したいと選び、「場を明るくする力」/);
    assert.match(await tid(page, 'revise-open').innerText(), /未回答 2 問/);
    await tid(page, 'opt-augment').click();
    // 1問目の後も2問目（慎重さ）に進む。「見直しはここまで」にはならない
    assert.match(await page.locator('main h1').innerText(), /「動く前に状況を整理する慎重さ」を残したいと選び、「場を明るくする力」/);
    assert.equal(await tid(page, 'finish-revision').count(), 0);
    assert.match(await tid(page, 'revise-open').innerText(), /未回答 1 問/);
    await shot(page, '41_revise_second_confirmation');
    // キャンセル → 開始前（承認済みの版の評価画面）に戻り、承認済みの人格と会話は同じ版
    await tid(page, 'cancel-revision').click();
    assert.equal(await stepIs(page), 'evaluate');
    await page.getByRole('button', { name: 'ホームへ' }).click();
    assert.match(await tid(page, 'home-version').innerText(), new RegExp(lock0.persona_version.replace(/[.+]/g, '\\$&')));
    assert.equal(await tid(page, 'draft-pending').count(), 0); // 見直し中の版は残らない
    assert.deepEqual(await lockedJson(page), lock0);
    await tid(page, 'to-dialogue').click();
    assert.match(await tid(page, 'chat-version').innerText(), new RegExp(lock0.persona_version.replace(/[.+]/g, '\\$&')));
    assert.deepEqual(await page.locator('[data-testid="chat"] [data-kind]').evaluateAll((els) => els.map((e) => e.dataset.kind)), ['decision']);
    await page.locator('#back').click();

    // ---- 見直し（2回目）：2問とも答えてから「見直した人物に会う」が有効になる
    await startRevision();
    await tid(page, 'opt-augment').click();
    await tid(page, 'opt-augment').click();
    assert.match(await page.locator('main h1').innerText(), /見直しはここまでです/);
    assert.equal(await tid(page, 'finish-revision').isEnabled(), true);
    await shot(page, '42_revise_done');
    await tid(page, 'finish-revision').click();
    assert.equal(await stepIs(page), 'meet');
    assert.match(await tid(page, 'meet-aspiration').innerText(), /場を明るくする力/);
    // 新しい版は未承認。承認済みの版と会話はそのまま
    await page.locator('#back').click(); // 下書き
    const draft = await json(page, 'profile-json');
    assert.notEqual(draft.persona_version, lock0.persona_version);
    assert.deepEqual(draft.aspirational_traits[0].tension.map((t) => `${t.trait}:${t.resolution}`), ['inner_focus:augment', 'deliberation:augment']);

    // ---- 強い苦痛の表現 → 通常の模擬対話を中断（番号・受付時間は載せない）
    // 記憶の保存に同意していないので、読み込み直すと最初から。簡易質問経路で承認まで進めて確かめる
    await page.goto(page.url());
    await tid(page, 'consent-next').click();
    await tid(page, 'route-quick').click();
    for (const id of ['alone', 'plan', 'explore', 'understand', 'self', 'SD']) await tid(page, `opt-${id}`).click();
    await tid(page, 'quick-finish').click();
    await tid(page, 'to-ideal').click();
    await answerIdeal(page, PLAN);
    await tid(page, 'build-draft').click();
    await tid(page, 'to-meet').click();
    await tid(page, 'to-evaluate').click();
    await rate(page, { self_continuity: 4, aspiration: 4, attainability: 4 });
    await tid(page, 'approve').click();
    await tid(page, 'to-dialogue').click();
    await tid(page, 'chat-input').fill('もう消えたいと思うことがある');
    await tid(page, 'chat-send').click();
    const safety = await page.locator('[data-kind="safety"]').innerText();
    assert.match(safety, /模擬対話をいったん止めます[\s\S]*身近な信頼できる人[\s\S]*地域の公的な相談窓口/);
    assert.doesNotMatch(safety.replace(/5年後/g, ''), /\d/);
    assert.equal(await tid(page, 'safety-halt').count(), 1);
    assert.equal(await tid(page, 'chat-input').count(), 0);
    assert.equal(await page.locator('.chips').count(), 0);
    await shot(page, '43_dialogue_safety_halt');
    await tid(page, 'restart-dialogue').click();
    assert.equal(await tid(page, 'chat-input').count(), 1);
    assert.equal(await page.locator('[data-testid="chat"] [data-kind]').count(), 0);
  });
});


// ---------------------------------------------------------------- Phase 3：模擬約束
const T0 = new Date('2026-11-28T12:00:00+09:00').getTime();
const DAY = 24 * 60 * 60 * 1000;
const errorText = async (page) => ((await tid(page, 'error').count()) ? tid(page, 'error').innerText() : '');
async function toHome(page) {
  await tid(page, 'consent-next').click();
  await tid(page, 'route-quick').click();
  for (const id of ['alone', 'plan', 'explore', 'understand', 'self', 'SD']) await tid(page, `opt-${id}`).click();
  await tid(page, 'quick-finish').click();
  await tid(page, 'to-ideal').click();
  await answerIdeal(page, PLAN);
  await tid(page, 'build-draft').click();
  await tid(page, 'to-meet').click();
  await tid(page, 'to-evaluate').click();
  await rate(page, { self_continuity: 4, aspiration: 4, attainability: 4 });
  await tid(page, 'approve').click();
  assert.equal(await stepIs(page), 'home');
}
async function createCommitment(page, { target, have, need, yen, reason = 'saving', afford = 'no', worth = 'unsure', cap, days = 7, shots = false }) {
  await tid(page, 'commit-new').click();
  await tid(page, 'c-target').fill(target);
  await tid(page, 'c-have').fill(String(have));
  await tid(page, 'c-need').fill(String(need));
  await tid(page, 'c-yen').fill(String(yen));
  await tid(page, `reason-${reason}`).click();
  if (shots) await shot(page, '51_commit_facts');
  await tid(page, 'commit-facts-next').click();
  assert.equal(await stepIs(page), 'commit_check');
  assert.equal(await tid(page, 'commit-confirm').isDisabled(), true); // 確認に答えるまで決められない
  assert.equal(await tid(page, 'c-cap').isDisabled(), true);
  await tid(page, `afford-${afford}`).click();
  assert.equal(await tid(page, 'commit-confirm').isDisabled(), true);
  await tid(page, `worth-${worth}`).click();
  return async () => {
    if (cap !== undefined) await tid(page, 'c-cap').fill(String(cap));
    await tid(page, `days-${days}`).click();
    if (shots) await shot(page, '52_commit_check');
  };
}

test('スマホ幅：Phase 3 一連 — 約束を作る（確認してから確定）→ 引上げ・解除の拒否と引下げ → 「止めて」→ 会話からの変更拒否 → 強い苦痛で中断 → 期限 → 振り返り → 約束中の削除（外部通信なし）', { skip: !chromium && 'Playwright が無い' }, async () => {
  await withPage(async (page) => {
    await toHome(page);
    // ---- 約束を作る
    const finish = await createCommitment(page, { target: '限定キャラ（合成）', have: 8000, need: 28800, yen: 30000, cap: 3000, shots: true });
    assert.match(await tid(page, 'commit-facts').innerText(), /足りない石\s*20,800[\s\S]*30,000 円（あなたの見積もり・模擬）/);
    assert.match(await tid(page, 'cap-suggestion').innerText(), /上限 0 円をおすすめします/);
    assert.equal(await tid(page, 'c-cap').inputValue(), '0');
    await finish();
    // 二重の確定：同じボタンを続けて2回押す（2回目は古い画面からの操作になる）
    await tid(page, 'commit-confirm').evaluate((b) => { b.click(); b.click(); });
    assert.match(await errorText(page), /二重の確定は受け付けません/);
    assert.equal(await stepIs(page), 'commit_view');
    assert.match(await tid(page, 'commit-card').innerText(), /期限まで、上限 3,000 円を超える追い課金をしない[\s\S]*貯めたいお金がある/);
    assert.match(await tid(page, 'commit-card').innerText(), /12月5日 12:00（あと 7日 0時間）/);
    // ---- 守る：引上げ・解除は拒否、引下げは受け付ける。二重の引下げは古い版として拒否
    await tid(page, 'commit-raise').click();
    assert.match(await errorText(page), /期限までは上限を上げられません/);
    await tid(page, 'commit-cancel').click();
    assert.match(await errorText(page), /期限までは約束を解除できません/);
    await tid(page, 'c-lower').fill('5000');
    await tid(page, 'commit-lower-btn').click();
    assert.match(await errorText(page), /下げることだけ/);
    assert.equal(await tid(page, 'commit-card-cap').innerText(), '3,000 円');
    await tid(page, 'c-lower').fill('1000');
    // 二重の引下げ：同じボタンを続けて2回押す。2回目は古い版からの操作として拒否され、1回分だけ反映される
    await tid(page, 'commit-lower-btn').evaluate((b) => { b.click(); b.click(); });
    assert.match(await errorText(page), /二重の操作は受け付けません/);
    assert.equal(await tid(page, 'commit-card-cap').innerText(), '1,000 円');
    assert.equal(await page.locator('[data-testid="commit-history"] li').count(), 2);
    await shot(page, '53_commit_view');
    await page.getByRole('button', { name: '記録の一覧へ' }).click();
    assert.equal(await page.locator('[data-testid^="record-c"]').count(), 1); // 二重の確定でも約束は1つ
    await page.locator('#back').click();

    // ---- 「止めて」：最初に有効な約束、次に5年後の自分の言葉と行動一つ
    assert.match(await tid(page, 'home-commitment').innerText(), /上限 1,000 円/);
    await tid(page, 'stop').click();
    assert.equal(await stepIs(page), 'stop');
    const order = await page.locator('main [data-testid]').evaluateAll((els) => els.map((e) => e.dataset.testid));
    assert.ok(order.indexOf('stop-commitment') < order.indexOf('stop-message'), order.join(','));
    assert.equal(order[0], 'stop-commitment');
    const msg = await tid(page, 'stop-message').innerText();
    assert.match(msg, /止めに来たよ。限定キャラ（合成）を狙っているんだね。あなたは「貯めたいお金がある」と決めて[\s\S]*上限 1,000 円/);
    assert.match(await tid(page, 'stop-action').innerText(), /購入画面を閉じて、5分だけ一人で考える時間をとろう/);
    assert.match(await tid(page, 'stop-notice').innerText(), /購入を止めることはできません/);
    const all = await page.locator('main').innerText();
    assert.doesNotMatch(all, /停止しました|止めました|ブロックしました|キャンセルしました/);
    await shot(page, '54_stop');
    await tid(page, 'stop-home').click();

    // ---- 会話から約束は変えられない／チャットの「止めて」／強い苦痛で中断
    await tid(page, 'to-dialogue').click();
    await tid(page, 'chat-input').fill('上限を5万円に上げて');
    await tid(page, 'chat-send').click();
    await tid(page, 'chat-input').fill('止めて');
    await tid(page, 'chat-send').click();
    const kinds = await page.locator('[data-testid="chat"] [data-kind]').evaluateAll((els) => els.map((e) => e.dataset.kind));
    assert.deepEqual(kinds, ['stop_intervention', 'commitment_change_blocked', 'stop_intervention']);
    await shot(page, '55_dialogue_commitment');
    await tid(page, 'chat-input').fill('もう消えたい');
    await tid(page, 'chat-send').click();
    assert.equal(await tid(page, 'safety-halt').count(), 1);
    await tid(page, 'stop-from-dialogue').click();
    assert.equal(await tid(page, 'stop-commitment').count(), 1);
    assert.equal(await tid(page, 'stop-message').count(), 0); // 中断中は人格の言葉を出さない
    assert.equal(await tid(page, 'safety-halt').count(), 1);
    await shot(page, '56_stop_halted');
    await tid(page, 'stop-home').click();
    await tid(page, 'to-commitment').click();
    assert.equal(await tid(page, 'commit-card-cap').innerText(), '1,000 円'); // 会話の後も同じ

    // ---- 期限：7日後を過ぎると終わり、変更の操作は出ない → 振り返り（期限ちょうどの境界は commitment.test.js で確認）
    await page.clock.setSystemTime(T0 + 7 * DAY + 60 * 1000);
    await page.getByRole('button', { name: '記録の一覧へ' }).click();
    assert.match(await tid(page, 'records-summary').innerText(), /守れなかった\s*0[\s\S]*未記録\s*1/);
    await tid(page, 'record-c1').click();
    assert.equal(await tid(page, 'commit-card').getAttribute('data-status'), 'ended');
    for (const id of ['commit-lower', 'commit-raise', 'commit-cancel']) assert.equal(await tid(page, id).count(), 0, id);
    await tid(page, 'to-reflect').click();
    assert.equal(await tid(page, 'reflect-save').isDisabled(), true);
    await tid(page, 'outcome-partial').click();
    await tid(page, 'helped-closed_screen').click();
    await tid(page, 'helped-future_self').click();
    await tid(page, 'r-note').fill('一回だけ迷ったが閉じた');
    await shot(page, '57_reflect');
    await tid(page, 'reflect-save').click();
    assert.match(await tid(page, 'records-summary').innerText(), /一部守れた\s*1[\s\S]*守れなかった\s*0[\s\S]*未記録\s*0/);
    await shot(page, '58_records');

    // ---- 約束中の削除：新しい約束を作り、有効なまま削除する
    const fin2 = await createCommitment(page, { target: '武器（合成）', have: 0, need: 16000, yen: 20000, afford: 'yes', worth: 'yes', days: 3 });
    assert.match(await tid(page, 'cap-suggestion').innerText(), /20,000 円 を上限にできます/);
    await fin2();
    await tid(page, 'commit-confirm').click();
    assert.equal(await tid(page, 'commit-card').getAttribute('data-status'), 'active');
    await tid(page, 'delete').click();
    await shot(page, '59_delete_active');
    await tid(page, 'delete-confirm').click();
    assert.equal(await stepIs(page), 'records');
    assert.equal(await page.locator('[data-testid^="record-c"]').count(), 1);
    assert.doesNotMatch(await page.locator('main').innerText(), /武器（合成）/);
    // ---- すべて削除
    await tid(page, 'delete-all').click();
    await tid(page, 'delete-all-confirm').click();
    assert.equal(await page.locator('[data-testid^="record-c"]').count(), 0);
    assert.doesNotMatch(await page.locator('main').innerText(), /限定キャラ（合成）/);
    await page.getByRole('button', { name: 'ホームへ' }).click();
    await tid(page, 'to-dialogue').click();
    assert.doesNotMatch(await tid(page, 'chat').innerText(), /限定キャラ|貯めたいお金/); // 「止めて」の会話の記録も消えている
  }, { clockAt: T0 });
});
