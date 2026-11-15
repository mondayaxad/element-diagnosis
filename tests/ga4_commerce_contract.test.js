'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const read = (p) => fs.readFileSync(require('node:path').join(__dirname, '..', p), 'utf8');
const plain = (x) => JSON.parse(JSON.stringify(x));

function ga() {
  const ctx = { window: {}, location: { hostname: 'element-diagnosis-five.vercel.app', origin: 'https://element-diagnosis-five.vercel.app', pathname: '/mypage', search: '' },
    document: { referrer: '', head: { appendChild() {} }, createElement() { return {}; } }, URLSearchParams };
  vm.createContext(ctx); vm.runInContext(read('js/ga.js'), ctx);
  return ctx.window;
}
test('共通購入イベントは明示の商品IDで分類する。金額だけ・混在した商品は推測しない', () => {
  const w = ga();
  for (const [id, diagnosis, canonical] of [
    ['analysis', 'eti', 'eti_analysis_v1'], ['complete', 'eti', 'eti_complete_v1'],
    ['core1', 'eti', 'eti_core1_legacy'], ['jagan_report_v1', 'jagan', 'jagan_report_v1'],
    ['jagan_complete_v1', 'jagan', 'jagan_complete_v1'],
  ]) {
    w.gtag('event', 'purchase', { transaction_id: '0123456789abcdef0123', value: 1000,
      items: [{ item_id: id, price: 1000, quantity: 1 }], email: 'private@example.com', token: 'private' });
    const p = plain(w.dataLayer.at(-1)[2]);
    assert.equal(p.diagnosis_type, diagnosis); assert.equal(p.product_id, canonical);
    assert.equal(p.items[0].item_id, id, '過去との連続性を保つ');
    assert.ok(p.items[0].item_category); assert.equal(p.email, undefined); assert.equal(p.token, undefined);
  }
  for (const p of [{ value: 1000 }, { items: [{ item_id: 'analysis' }, { item_id: 'jagan_report_v1' }] }]) {
    w.gtag('event', 'purchase', p);
    assert.equal(w.dataLayer.at(-1)[2].diagnosis_type, undefined);
  }
});
test('既存CTA名を維持し、商品と診断を追加する。非購入イベントは変更しない', () => {
  const w = ga();
  for (const [name, diagnosis, product] of [['lock_cta_click', 'eti', 'eti_analysis_v1'], ['complete_offer_click', 'eti', 'eti_complete_v1'], ['jagan_report_cta', 'jagan', 'jagan_report_v1'], ['jagan_complete_cta', 'jagan', 'jagan_complete_v1']]) {
    w.gtag('event', name, { source: 'result', state: 'open' });
    assert.equal(w.dataLayer.at(-1)[1], name);
    assert.deepEqual(plain(w.dataLayer.at(-1)[2]), { source: 'result', state: 'open', diagnosis_type: diagnosis, product_id: product });
  }
  w.gtag('event', 'diagnosis_profile', { p_a: 30 });
  assert.deepEqual(plain(w.dataLayer.at(-1)[2]), { p_a: 30 });
});
test('DTIの結果・サンプル・レポート下部の共通購入処理：開始→作成→遷移、失敗と再送・二重押し', async () => {
  const original = { window: global.window, location: global.location, fetch: global.fetch };
  const sent = [], assigned = [];
  global.window = { __ED_PUBLIC_CONFIG__: { jaganSalesOpen: true }, gtag: (_, n, p) => sent.push([n, p]), sessionStorage: { setItem() {} } };
  global.location = { assign: (url) => assigned.push(url) };
  try {
    const client = await import('../jagan/client.mjs');
    for (const product of ['report', 'complete']) for (const source of ['result', 'report_sample', 'report']) {
      sent.length = 0;
      global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ checkoutUrl: 'https://checkout.stripe.com/c/pay/mock' }) });
      const out = await client.buy({ resultId: 'x', product, source });
      assert.equal(out.ok, true);
      assert.deepEqual(sent.map(([n]) => n), ['checkout_start', 'begin_checkout', 'checkout_session_created', 'checkout_redirect']);
      for (const [, p] of sent) {
        assert.equal(p.diagnosis_type, 'jagan'); assert.equal(p.source, source);
        assert.equal(p.product_id, product === 'report' ? 'jagan_report_v1' : 'jagan_complete_v1');
      }
    }
    sent.length = 0;
    let attempts = 0;
    global.fetch = async () => { attempts++; throw new Error('network'); };
    const out = await client.buy({ resultId: 'x', source: 'result' });
    assert.equal(out.error, 'network'); assert.equal(attempts, 2);
    assert.deepEqual(sent.map(([n]) => n), ['checkout_start', 'begin_checkout', 'checkout_failed']);
    sent.length = 0;
    let release;
    global.fetch = () => new Promise((r) => { release = r; });
    const a = client.buy({ resultId: 'x', source: 'result' });
    const b = client.buy({ resultId: 'x', source: 'result' });
    await new Promise((r) => setImmediate(r));
    release({ ok: true, status: 200, json: async () => ({ checkoutUrl: 'https://checkout.stripe.com/c/pay/mock' }) });
    assert.equal((await a).ok, true); assert.equal((await b).error, 'in_progress');
    assert.equal(sent.filter(([n]) => n === 'checkout_start').length, 1);
  } finally { Object.assign(global, original); }
});
test('ETIの申込は商品・診断種別付きで、決済画面作成と遷移を区別する', async () => {
  const sent = [];
  const w = { gtag: (_, n, p) => sent.push([n, p]), __ED_PUBLIC_CONFIG__: { completeSalesOpen: true }, crypto: webcrypto,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'), sessionStorage: { getItem() {}, setItem() {}, removeItem() {} },
    location: { assign() {} }, document: { readyState: 'loading', addEventListener() {} } };
  const ctx = { window: w, setTimeout, clearTimeout, AbortController,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ checkoutUrl: 'https://checkout.stripe.com/c/pay/mock' }) }) };
  vm.createContext(ctx); vm.runInContext(read('js/report-purchase.js'), ctx);
  assert.equal((await w.EdBuy.start({ context: 'x'.repeat(80), product: 'analysis', source: 'mypage_history' })).ok, true);
  assert.deepEqual(sent.map(([n]) => n), ['checkout_start', 'begin_checkout', 'checkout_session_created', 'checkout_redirect']);
  for (const [, p] of sent) { assert.equal(p.diagnosis_type, 'eti'); assert.equal(p.product_id, 'eti_analysis_v1'); }
});

test('DTIマイページでも同じ順序。失敗時は画面作成・遷移を数えず、ボタンを戻す', async () => {
  for (const product of ['report', 'complete']) for (const ok of [true, false]) {
    const sent = [], assigned = [], listeners = {};
    const w = { __ED_PUBLIC_CONFIG__: { jaganSalesOpen: true }, sessionStorage: { setItem() {} } };
    const btn = { disabled: false, innerHTML: '申込', parentElement: { querySelector() { return null; } },
      getAttribute(k) { return { 'data-jagan-buy': '11111111-1111-4111-8111-111111111111', 'data-product': product, 'data-source': 'mypage_history' }[k]; }, insertAdjacentElement() {} };
    const ctx = { window: w, crypto: webcrypto, btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
      location: { assign: (url) => assigned.push(url) }, trackEvent: (n, p) => sent.push([n, p]),
      supabaseClient: { auth: { getSession: async () => ({ data: { session: { access_token: 'test-auth' } } }) } },
      document: { addEventListener(n, fn) { listeners[n] = fn; }, createElement() { return { setAttribute() {} }; } },
      fetch: async () => ({ ok, status: ok ? 200 : 503, json: async () => ok ? { checkoutUrl: 'https://checkout.stripe.com/c/pay/mock' } : { error: 'service_unavailable' } }) };
    vm.createContext(ctx); vm.runInContext(read('js/jagan-mypage.js'), ctx);
    listeners.click({ target: { closest: () => btn }, preventDefault() {} });
    await new Promise((r) => setImmediate(r));
    assert.deepEqual(sent.map(([n]) => n), ok ? ['checkout_start', 'begin_checkout', 'checkout_session_created', 'checkout_redirect'] : ['checkout_start', 'begin_checkout', 'checkout_failed']);
    for (const [, p] of sent) { assert.equal(p.diagnosis_type, 'jagan'); assert.equal(p.product_id, product === 'complete' ? 'jagan_complete_v1' : 'jagan_report_v1'); assert.equal(p.source, 'mypage_history'); }
    assert.equal(assigned.length, ok ? 1 : 0);
    if (!ok) { assert.equal(btn.disabled, false); assert.equal(btn.innerHTML, '申込'); }
  }
});

test('ETIの通信失敗は同じ申込を再送し、計測が例外を出しても購入を妨げない', async () => {
  let calls = 0; const sent = [];
  const w = { gtag: (_, n, p) => sent.push([n, p]), __ED_PUBLIC_CONFIG__: { completeSalesOpen: true }, crypto: webcrypto,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'), sessionStorage: { getItem() {}, setItem() {}, removeItem() {} },
    location: { assign() {} }, document: { readyState: 'loading', addEventListener() {} } };
  const attempts = [];
  const ctx = { window: w, setTimeout, clearTimeout, AbortController, fetch: async (_, init) => { calls++; attempts.push(JSON.parse(init.body).attempt); throw Error('network'); } };
  vm.createContext(ctx); vm.runInContext(read('js/report-purchase.js'), ctx);
  assert.equal((await w.EdBuy.start({ context: 'x'.repeat(80), product: 'analysis', source: 'result' })).error, 'network');
  assert.equal(calls, 2); assert.equal(attempts[0], attempts[1]);
  assert.deepEqual(sent.map(([n]) => n), ['checkout_start', 'begin_checkout', 'checkout_failed']);
  w.gtag = () => { throw Error('analytics unavailable'); };
  ctx.fetch = async () => ({ ok: true, status: 200, json: async () => ({ checkoutUrl: 'https://checkout.stripe.com/c/pay/mock' }) });
  assert.equal((await w.EdBuy.start({ context: 'x'.repeat(80), product: 'analysis', source: 'result' })).ok, true);
});
