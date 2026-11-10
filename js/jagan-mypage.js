/* js/jagan-mypage.js — マイページの邪眼診断（2026-11-07・Preview）。マイページは元素診断と共通。
   邪眼診断の記録は、元素診断と同じ欄（RECORDS・INSIGHTS の数、LATEST RESULT、YOUR COLLECTION、THE RECORDS、右上のレポート）に
   並ぶ（描画は mypage.html の MP_KINDS.jagan ほか）。このファイルは、記録・権利の読み込みと、保存・登録・申込だけを受け持つ。
   ・保存待ち（jagan_pending_save_v1）：邪眼の結果ページで、未ログインのまま「マイページに保存」した結果を、ログイン・登録完了の後に保存する。
   ・登録の予定（jagan_register_v1）：購入したレポートの最下部「マイページに登録する」を、ログインの後に行う（固有リンクの秘密値）。
   ・記録は本人の行だけ（RLS）。権利（jagan_entitlements）も本人の行だけ。権利を読めなければ、購入状態は「未確認」（購入済みと誤って見せない）。
   ・申込（¥1,000）：本人の記録の resultId だけを送る（回答・金額は送らない。サーバーが本人の行から決める）。販売中だけ。
   ・本番（appEnv=production）では、邪眼診断の公開判断（DB の適用を含む）が済むまで何もしない。 */
(function () {
  'use strict';
  var PENDING_KEY = 'jagan_pending_save_v1';
  var REGISTER_KEY = 'jagan_register_v1';
  var FRESH_KEY = 'jagan_buy_fresh_v1';
  var PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  var REGISTER_MAX_AGE_MS = 2 * 60 * 60 * 1000;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
  var SCHEMA = 'jagan-result-3';
  // 共有の URL（jagan/engine/runtime.mjs の shareQuery と同じ。テストで一致を確かめる）
  var SHARE_PATH = '/jagan/share';
  var OG_DESIGN_VERSION = 'dti-og-3';
  // 色（jagan/site-copy.mjs の ISOU_COLOR・ELEMENT_COLOR・CHARACTER_ELEMENTS と同じ値。テストで一致を確かめる）
  var ISOU_COLOR = { ANX: '#B59AD8', SEP: '#7FA7D8', SUS: '#9FB0C8', WDR: '#8FC0D0', IMP: '#E0A050', PSV: '#B8A27A', PRF: '#D8C27A',
    HOS: '#E0694F', ATT: '#E08AA8', MAN: '#C88AD8', RSK: '#E07A5A', CAL: '#9AA7B5' };
  var ELEMENT_MAIN = { PY: '#C9503C', HY: '#3F82BC', CR: '#7DB3C6', EL: '#9563CF', AN: '#4FAE98', GE: '#C9A04E', DE: '#78A84A' };
  // ファトゥスの色（マイページの円グラフ・名前）。課金前は1つ目の色の単色、課金後は黒寄りのグラデーション（オーナー指定・2026-11-07）
  //   ピエロ＝雷と氷、スカラマシュ＝雷と風、カピターノ＝氷と白、サンドローネ＝氷と岩、タルタリヤ＝水と雷、コロンビーナ＝水と白、
  //   ドットーレ＝炎と草、シニョーラ＝氷と炎、パンタローネ＝草と雷、アルレッキーノ＝炎と黒、プルチネッラ＝氷と水
  var WHITE = '#ECE8F2';
  var FATUI_TONE = { pierro: ['EL', 'CR'], scaramouche: ['EL', 'AN'], capitano: ['CR', 'WHITE'], sandrone: ['CR', 'GE'], tartaglia: ['HY', 'EL'],
    columbina: ['HY', 'WHITE'], dottore: ['PY', 'DE'], signora: ['CR', 'PY'], pantalone: ['DE', 'EL'], arlecchino: ['PY', 'BLACK'], pulcinella: ['CR', 'HY'] };
  var BLACK = '#2a1016'; // 「黒」：暗い地の上でも円周が消えない、ごく暗い赤黒
  function hexOf(k) { return k === 'WHITE' ? WHITE : k === 'BLACK' ? BLACK : ELEMENT_MAIN[k]; }
  // a と b を t（0〜1）で混ぜる（#RRGGBB）
  function mix(a, b, t) {
    var x = [1, 3, 5].map(function (i) { return parseInt(a.slice(i, i + 2), 16); });
    var y = [1, 3, 5].map(function (i) { return parseInt(b.slice(i, i + 2), 16); });
    return '#' + x.map(function (v, i) { return ('0' + Math.round(v + (y[i] - v) * t).toString(16)).slice(-2); }).join('');
  }
  var INK = '#0B0306'; // 黒寄りの赤黒（邪眼の地色）
  // { base：課金前の単色, ring：[始, 終]（円グラフ）, text：[始, 終]（名前の文字。暗い地で読める明るさ） }
  function fatuiTone(id) {
    var t = FATUI_TONE[id];
    if (!t) return { base: '#C99AA7', ring: [mix('#C99AA7', INK, 0.5), '#C99AA7'], text: ['#C99AA7', '#E2C08C'] };
    var a = hexOf(t[0]), b = hexOf(t[1]);
    var same = t[0] === t[1];
    // 「黒」で終わる（アルレッキーノ）：色から黒へ沈む。名前の文字は読める暗さまで
    if (t[1] === 'BLACK') return { base: a, ring: [mix(a, INK, 0.1), b], text: [mix(a, INK, 0.05), mix(a, INK, 0.5)] };
    return {
      base: a,
      ring: [mix(a, INK, 0.55), same ? mix(a, INK, 0.08) : mix(b, INK, 0.12)],
      text: [mix(a, INK, 0.12), same ? mix(a, WHITE, 0.25) : mix(b, INK, 0.05)],
    };
  }
  // 三つの土台（jagan/site-copy.mjs の GROUPS と同じ。テストで一致を確かめる）。note はマイページの一行説明
  var GROUPS = [
    { id: 'inner', short: '不安と距離', color: '#C98A5A', traits: ['ANX', 'SEP', 'SUS', 'WDR'], note: '他者との距離や安心感をめぐって、心が揺れやすいところ' },
    { id: 'action', short: '行動のくせ', color: '#8E7CD0', traits: ['IMP', 'RSK', 'PSV', 'PRF'], note: '動き出す速さ、切り替え方、基準の高さ' },
    { id: 'relating', short: '他者との向き合い', color: '#C8405C', traits: ['HOS', 'ATT', 'MAN', 'CAL'], note: '他者への振る舞い方と、働きかけ方' },
  ];
  // 購入済みの記録だけ：マイページで開示する内容（三つの土台の上位2特性・ファトゥス上位4名）。未購入には作らない
  function insightOf(snap) {
    var traits = snap.traits || {};
    var groups = GROUPS.map(function (g) {
      var top = g.traits.map(function (id) { var t = traits[id]; return t && typeof t.score === 'number' ? { id: id, label: t.label, score: Math.max(0, Math.min(100, Math.round(t.score))), color: ISOU_COLOR[id] } : null; })
        .filter(Boolean).sort(function (a, b) { return b.score - a.score || g.traits.indexOf(a.id) - g.traits.indexOf(b.id); }).slice(0, 2);
      return { id: g.id, short: g.short, color: g.color, note: g.note, top: top };
    });
    var ch = snap.character && snap.character.status === 'available' ? snap.character : null;
    var order = Array.isArray(snap.characterOrder) ? snap.characterOrder : [];
    var fatui = order.slice(0, 4).map(function (c, i) {
      // 1位は結果ページと同じ一致度（character.match）
      var m = i === 0 && ch && ch.id === c.id ? ch.match : Math.round(c.displayScore);
      return { id: c.id, name: c.name, match: m, tone: fatuiTone(c.id) };
    });
    return { groups: groups, fatui: fatui };
  }
  // 完全解析を購入済みの記録だけ：マイページで開示する内容（邪眼の上位3つの得点・四つの反応領域の全特性）。未購入には作らない
  var DOMAINS = [
    { id: 'anx', label: '不安と対人警戒', color: '#A493C9', traits: ['ANX', 'SEP', 'SUS', 'WDR'] },
    { id: 'imp', label: '衝動と刺激', color: '#D0704A', traits: ['IMP', 'RSK'] },
    { id: 'per', label: '固執と基準', color: '#C2A35E', traits: ['PSV', 'PRF'] },
    { id: 'rel', label: '他者への働きかけ', color: '#C8405C', traits: ['HOS', 'ATT', 'MAN', 'CAL'] },
  ];
  function completeOf(snap) {
    var traits = snap.traits || {};
    var rk = snap.element && Array.isArray(snap.element.ranking) ? snap.element.ranking : [];
    var elements = rk.slice(0, 3).map(function (e) { return { id: e.id, label: e.label, score: Math.max(0, Math.min(100, Math.round(e.score))), color: ELEMENT_MAIN[e.id] || '#C99AA7' }; });
    var domains = DOMAINS.map(function (d) {
      return { id: d.id, label: d.label, color: d.color, traits: d.traits.map(function (id) { var t = traits[id]; return t && typeof t.score === 'number' ? { id: id, label: t.label, score: Math.max(0, Math.min(100, Math.round(t.score))), color: ISOU_COLOR[id] } : null; }).filter(Boolean) };
    });
    return { elements: elements, domains: domains };
  }
  var notes = [];
  var inFlight = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function enabled() {
    var cfg = window.__ED_PUBLIC_CONFIG__;
    return !!(cfg && cfg.appEnv !== 'production' && typeof supabaseClient !== 'undefined' && !supabaseClient.unavailable);
  }
  function salesOpen() { var c = window.__ED_PUBLIC_CONFIG__; return !!(c && c.jaganSalesOpen === true); }
  function store(kind, fn) { try { return fn(kind === 'local' ? window.localStorage : window.sessionStorage); } catch (e) { return null; } }
  function readPending() {
    return store('local', function (s) {
      var v = JSON.parse(s.getItem(PENDING_KEY) || 'null');
      if (!v || !UUID_RE.test(v.resultId || '') || !(Date.now() - Number(v.at) < PENDING_MAX_AGE_MS)) { s.removeItem(PENDING_KEY); return null; }
      return v;
    });
  }
  function hasPending() { return !!readPending(); }
  function readRegister() {
    return store('session', function (s) {
      var v = JSON.parse(s.getItem(REGISTER_KEY) || 'null');
      if (!v || !TOKEN_RE.test(v.t || '') || !(Date.now() - Number(v.at) < REGISTER_MAX_AGE_MS)) { s.removeItem(REGISTER_KEY); return null; }
      return v.t;
    });
  }
  function hasRegister() { return !!readRegister(); }
  async function token() {
    try { var r = await supabaseClient.auth.getSession(); return r.data && r.data.session ? r.data.session.access_token : null; } catch (e) { return null; }
  }
  async function api(path, body, t) {
    var headers = { 'Content-Type': 'application/json' };
    if (t) headers.Authorization = 'Bearer ' + t;
    try {
      var res = await fetch(path, { method: 'POST', headers: headers, body: JSON.stringify(body) });
      var out = await res.json().catch(function () { return {}; });
      return { ok: res.ok, status: res.status, body: out || {} };
    } catch (e) { return { ok: false, status: 0, body: { error: 'network' } }; }
  }
  function track(name, params) { try { if (typeof trackEvent === 'function') trackEvent(name, params || {}); } catch (e) { /* 計測だけ */ } }

  // 保存待ちの保存（登録完了の後だけ呼ばれる。失敗しても保存待ちは残す＝次に開いたときに再試行）
  async function savePending(t) {
    var p = readPending();
    if (!p) return;
    if (inFlight) return inFlight;
    inFlight = (async function () {
      var r = await api('/api/jagan-save', { resultId: p.resultId, itemSetVersion: p.itemSetVersion, answers: p.answers }, t);
      if (r.ok && r.body.ok) {
        store('local', function (s) { s.removeItem(PENDING_KEY); });
        track('jagan_save_success', { source: 'mypage' });
        notes.push({ ok: true, text: '邪眼診断の結果を保存しました。' });
        return;
      }
      if (r.status === 400 || r.status === 409) store('local', function (s) { s.removeItem(PENDING_KEY); }); // 直せない保存待ちは残さない
      notes.push({ ok: false, text: '邪眼診断の結果を保存できませんでした' + (hasPending() ? '（このページを開き直すと再試行します）' : '') + '。' });
    })();
    try { return await inFlight; } finally { inFlight = null; }
  }
  // 購入したレポートの登録（ログインの後）。直せない結果（リンクが無い・止まっている）は予定を消す
  async function registerPending(t) {
    var tok = readRegister();
    if (!tok) return;
    var r = await api('/api/jagan-report?op=link-register', { token: tok }, t);
    if (r.ok || r.status === 404 || r.status === 409) store('session', function (s) { s.removeItem(REGISTER_KEY); });
    if (r.ok) {
      track('jagan_report_register_done', { result: r.body.result, source: 'mypage' });
      notes.push({ ok: true, text: r.body.result === 'already' ? '購入した邪眼解析レポートは、すでにこのマイページに登録されています。' : '購入した邪眼解析レポートを、このマイページに登録しました。' });
    } else {
      notes.push({ ok: false, text: r.status === 404 || r.status === 409 ? '購入した邪眼解析レポートを登録できませんでした（リンクが正しくない、または返金などで停止しています）。'
        : r.status === 403 ? '登録（利用規約への同意）を完了してから、レポートのページでもう一度「マイページに登録する」を押してください。'
        : '購入した邪眼解析レポートを登録できませんでした。時間をおいて、このページを開き直してください。' });
    }
  }

  function top3(snap) {
    var tr = snap && Array.isArray(snap.traitRanking) ? snap.traitRanking : [];
    return tr.slice(0, 3).filter(function (t) { return t && typeof t.label === 'string' && typeof t.score === 'number' && isFinite(t.score); })
      .map(function (t) { return { id: t.id, label: t.label, score: Math.max(0, Math.min(100, Math.round(t.score))), color: ISOU_COLOR[t.id] || '#C99AA7' }; });
  }
  // マイページの記録の元（mypage.html の MP_KINDS.jagan.normalize が描画用の形に直す）
  function toSession(row, ent) {
    var snap = row.snapshot || {};
    var dtiOk = snap.schemaVersion === SCHEMA;
    var ch = dtiOk && snap.character && snap.character.status === 'available' ? snap.character : null;
    return {
      diagnosisType: 'jagan', id: row.result_id, completedAt: row.created_at, headline: row.headline || {},
      isDti: dtiOk,
      elementId: dtiOk && snap.element ? snap.element.id : null,
      isouId: dtiOk && snap.isou ? snap.isou.id : null,
      namingVersion: dtiOk && snap.versions ? snap.versions.naming : null,
      top3: dtiOk ? top3(snap) : [],
      character: ch ? { id: ch.id, name: ch.name, match: ch.match, tone: fatuiTone(ch.id) } : null,
      // 商品ごとの権利：解析レポート（¥1,000）＝purchased、完全解析「DIPPER」（¥3,000）＝completeOwned。片方だけ INSIGHT、両方 COMPLETE
      entKnown: ent.ok, purchased: ent.ok && !!(ent.set[row.result_id] && ent.set[row.result_id].report),
      completeOwned: ent.ok && !!(ent.set[row.result_id] && ent.set[row.result_id].complete),
      insight: dtiOk && ent.ok && ent.set[row.result_id] && ent.set[row.result_id].report ? insightOf(snap) : null,
      complete: dtiOk && ent.ok && ent.set[row.result_id] && ent.set[row.result_id].complete ? completeOf(snap) : null,
    };
  }

  // マイページの描画の前に呼ぶ：保存待ち・登録の予定を片付けてから、本人の邪眼の記録と権利を読む。
  //   { ok, sessions, notes }。記録を読めなければ ok=false（元素診断の表示は止めない）
  async function load() {
    notes = [];
    if (!enabled()) return { ok: true, sessions: [], notes: [] };
    var t = await token();
    if (!t) return { ok: true, sessions: [], notes: [] };
    await savePending(t);
    await registerPending(t);
    var rows;
    try {
      var r = await supabaseClient.from('jagan_results').select('result_id,headline,created_at,snapshot').order('created_at', { ascending: false });
      if (r.error) throw r.error;
      rows = r.data || [];
    } catch (e) {
      return { ok: false, sessions: [], notes: notes.concat([{ ok: false, text: '邪眼診断の記録を読み込めませんでした。時間をおいて、ページを読み込み直してください。' }]) };
    }
    var ent = { ok: false, set: {} };
    if (rows.length) {
      try {
        var e = await supabaseClient.from('jagan_entitlements').select('result_id,status,product_key').eq('status', 'active');
        if (!e.error && Array.isArray(e.data)) {
          ent.ok = true;
          e.data.forEach(function (x) {
            if (!x || x.status !== 'active') return;
            var o = ent.set[x.result_id] || (ent.set[x.result_id] = { report: false, complete: false });
            if (x.product_key === 'jagan_complete_v1') o.complete = true; else o.report = true;
          });
        }
      } catch (err) { ent.ok = false; }
    }
    return { ok: true, sessions: rows.map(function (row) { return toSession(row, ent); }), notes: notes.slice() };
  }

  function notesHtml(list) {
    return (list || []).map(function (n) { return '<p class="mp-jg-note' + (n.ok ? '' : ' is-error') + '" role="' + (n.ok ? 'status' : 'alert') + '">' + esc(n.text) + '</p>'; }).join('');
  }

  // 共有（結果ページの共有と同じ文・同じ URL。公開してよい値だけ）
  function shareUrlOf(s) {
    if (!s || !s.isDti || !s.elementId || !s.isouId || !s.namingVersion) return null;
    var q = new URLSearchParams();
    q.set('e', s.elementId);
    q.set('t', s.isouId);
    if (s.character) { q.set('c', s.character.id); q.set('m', String(s.character.match)); }
    q.set('v', s.namingVersion + '.' + OG_DESIGN_VERSION);
    return location.origin + SHARE_PATH + '?' + q.toString();
  }
  function shareTextOf(s, url) {
    var h = s.headline || {};
    var head = '私の結果は【' + h.element + ' × ' + h.type + '】';
    var fat = s.character ? '\nあなたのファトゥス：' + s.character.name + '（' + s.character.match + '%一致）' : '';
    var tags = ['#邪眼診断', '#' + h.code].concat(s.character ? ['#' + s.character.name] : []).join(' ');
    return '邪眼診断をやってみました。\n\n' + head + fat + '\n\n' + url + '\n\n' + tags;
  }
  function share(s) {
    var url = shareUrlOf(s);
    if (!url) return false;
    track('mypage_share_click', { diagnosis_type: 'jagan', share_mode: 'jagan_share' });
    window.open('https://x.com/intent/post?text=' + encodeURIComponent(shareTextOf(s, url)), '_blank', 'noopener');
    return true;
  }

  // 申込（マイページの全ての入口で共通：最新の結果・過去の記録・右上のレポート）
  var buying = false;
  function randomAttempt() {
    var b = new Uint8Array(18);
    crypto.getRandomValues(b);
    return btoa(String.fromCharCode.apply(null, Array.prototype.slice.call(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  var BUY_ERRORS = {
    sales_closed: '現在、お申し込みを受け付けていません（準備中）。',
    purchase_completed: 'この記録のレポートは、お支払いが完了しています。表示を更新します。',
    record_not_found: 'この記録を確認できませんでした。ページを読み込み直してください。',
    not_authenticated: 'ログインの有効期限が切れました。もう一度ログインしてください。',
    too_many_attempts: 'お申し込みが続いたため、しばらく時間をおいてからお試しください。',
    network: '通信できませんでした。電波の良い場所で、もう一度お試しください。',
  };
  async function startBuy(btn) {
    if (buying) return;
    var id = btn.getAttribute('data-jagan-buy');
    if (!UUID_RE.test(id || '') || !salesOpen()) return;
    buying = true;
    var label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = '決済の画面を準備しています…';
    var old = btn.parentElement && btn.parentElement.querySelector('.mp-jg-buy-error');
    if (old) old.remove();
    var source = btn.getAttribute('data-source') || 'mypage';
    var isC = btn.getAttribute('data-product') === 'complete';
    var prod = isC ? 'jagan_complete' : 'jagan_report', value = isC ? 3000 : 1000;
    track('checkout_start', { product: prod, value: value, currency: 'JPY', source: source });
    var t = await token();
    var body = { resultId: id, attempt: randomAttempt(), source: /^[a-z_]{1,32}$/.test(source) ? source : 'mypage' };
    if (isC) body.product = 'complete';
    var r = t ? await api('/api/jagan-report?op=buy', body, t) : { ok: false, body: { error: 'not_authenticated' } };
    if (r.ok && typeof r.body.checkoutUrl === 'string' && /^https:\/\/checkout\.stripe\.com\//.test(r.body.checkoutUrl)) {
      store('session', function (s) { s.setItem(FRESH_KEY, String(Date.now())); });
      track('checkout_redirect', { product: prod, value: value, currency: 'JPY', source: source });
      location.assign(r.body.checkoutUrl);
      return;
    }
    buying = false;
    btn.disabled = false;
    btn.innerHTML = label;
    var code = (r.body && r.body.error) || 'unknown';
    track('checkout_failed', { product: prod, reason: code, source: source });
    var p = document.createElement('p');
    p.className = 'mp-jg-buy-error';
    p.setAttribute('role', 'alert');
    p.textContent = BUY_ERRORS[code] || 'お手続きを開始できませんでした。時間をおいて、もう一度お試しください。';
    btn.insertAdjacentElement('afterend', p);
    if (code === 'purchase_completed' && typeof init === 'function') setTimeout(function () { init(); }, 1200);
  }
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('[data-jagan-buy]');
    if (!b || b.disabled) return;
    e.preventDefault();
    startBuy(b);
  });

  // ログイン画面（未ログイン）での案内
  function gateNote() {
    var g = document.getElementById('gateMsg');
    if (!g || g.textContent) return;
    if (hasRegister()) g.textContent = 'ログイン（または新規登録）すると、購入した邪眼解析レポートをこのマイページに登録します。';
    else if (hasPending()) g.textContent = 'ログイン（または新規登録）すると、邪眼診断の結果をこのマイページに保存します。';
  }

  window.JaganMypage = { load: load, notesHtml: notesHtml, gateNote: gateNote, hasPending: hasPending, hasRegister: hasRegister,
    salesOpen: salesOpen, share: share, shareUrlOf: shareUrlOf, shareTextOf: shareTextOf, esc: esc, fatuiTone: fatuiTone, mix: mix,
    GROUPS: GROUPS, COLORS: { ISOU_COLOR: ISOU_COLOR, ELEMENT_MAIN: ELEMENT_MAIN, FATUI_TONE: FATUI_TONE, WHITE: WHITE, BLACK: BLACK, INK: INK } };
})();
