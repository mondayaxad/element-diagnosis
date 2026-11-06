/* js/jagan-mypage.js — マイページの「邪眼診断の記録」（2026-11-02・Preview）。
   ・元素診断（ETI）の記録・購入・ランクの表示には触れない。記録の一覧の後ろ（アカウント欄の前）に別の欄として足す。
   ・邪眼診断の結果ページで、未ログインのまま「マイページ保存」を押した場合の保存待ち（jagan_pending_save_v1）を、
     ログイン・登録完了の後に /api/jagan-save で保存する（サーバーが再計算・本人を確認。24時間で破棄）。
   ・一覧は本人の行だけ（RLS）。削除は本人の行だけ（RLS）。共有の取消は結果ページから行う。
   ・mypage.html の initOnce() が、記録を描いた後（記録なし・ありの両方）に JaganMypage.render(root) を呼ぶ。 */
(function () {
  'use strict';
  var PENDING_KEY = 'jagan_pending_save_v1';
  var PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  var lastOutcome = null;
  var inFlight = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function readPending() {
    try {
      var v = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
      if (!v || !UUID_RE.test(v.resultId || '') || !(Date.now() - Number(v.at) < PENDING_MAX_AGE_MS)) { localStorage.removeItem(PENDING_KEY); return null; }
      return v;
    } catch (e) { return null; }
  }
  function hasPending() { return !!readPending(); }
  async function token() {
    try { var r = await supabaseClient.auth.getSession(); return r.data && r.data.session ? r.data.session.access_token : null; } catch (e) { return null; }
  }

  // 保存待ちの保存（登録完了の後だけ呼ばれる。失敗しても保存待ちは残す＝次に開いたときに再試行）
  async function savePending() {
    var p = readPending();
    if (!p) return null;
    if (inFlight) return inFlight;
    inFlight = (async function () {
      var t = await token();
      if (!t) return null;
      try {
        var res = await fetch('/api/jagan-save', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t },
          body: JSON.stringify({ resultId: p.resultId, itemSetVersion: p.itemSetVersion, answers: p.answers }) });
        var out = await res.json().catch(function () { return {}; });
        if (res.ok && out.ok) {
          localStorage.removeItem(PENDING_KEY);
          if (typeof trackEvent === 'function') trackEvent('jagan_save_success', { source: 'mypage' });
          return { ok: true };
        }
        if (res.status === 400 || res.status === 409) localStorage.removeItem(PENDING_KEY); // 直せない保存待ちは残さない
        return { ok: false, status: res.status };
      } catch (e) { return { ok: false, status: 0 }; }
    })();
    try { return await inFlight; } finally { inFlight = null; }
  }

  async function loadRows() {
    var r = await supabaseClient.from('jagan_results').select('result_id,headline,created_at,interpretation_version').order('created_at', { ascending: false });
    if (r.error) throw r.error;
    return r.data || [];
  }

  // 証：邪眼元素ごとの画像。保存時の見出し（h.element）の漢字から選ぶ。
  //   覚醒前（record）が既定。その記録に有効な購入権限（jagan_entitlements.status='active'）があるときだけ覚醒後（awakened）。
  //   購入権限が読めないとき（取得の失敗・未購入）は覚醒前のまま（購入済みと誤って見せない）。
  var EMBLEM_DIR = 'assets/emblems/jagan/';
  var EMBLEM_FILE = { '炎': 'pyro', '水': 'hydro', '風': 'anemo', '雷': 'electro', '草': 'dendro', '氷': 'cryo', '岩': 'geo' };
  function emblemHtml(label, awakened) {
    var f = EMBLEM_FILE[label];
    return f ? '<span class="jg-mp-emblem' + (awakened ? ' is-awakened' : '') + '" aria-hidden="true"><img src="' + EMBLEM_DIR + (awakened ? 'awakened/' : 'record/') + f + '.png" alt="" width="72" height="72" loading="lazy" decoding="async"></span>' : '';
  }
  async function loadAwakened() {
    // 本人の行だけ（RLS）。失敗しても記録の表示は止めない
    try {
      var r = await supabaseClient.from('jagan_entitlements').select('result_id,status').eq('status', 'active');
      if (r.error || !Array.isArray(r.data)) return {};
      var m = {}; r.data.forEach(function (e) { if (e && e.status === 'active') m[e.result_id] = true; });
      return m;
    } catch (e) { return {}; }
  }

  function rowHtml(row, awakenedMap) {
    var h = row.headline || {};
    // 保存時の見出しをそのまま出す（DTI のコード・呼び名が無い旧版の記録は、読み替えずにコードを出さない）
    var head = (h.element || '—') + ' × ' + (h.type || '—');
    var dti = (h.code && h.name) ? (h.code + '｜' + h.name) : '旧版の記録';
    var fat = h.character ? ('最も近しいファトゥス：' + h.character + '（' + h.matchPercent + '%一致）') : '';
    var d = new Date(row.created_at);
    return '<li class="jg-mp-row">' +
      emblemHtml(h.element, !!(awakenedMap && awakenedMap[row.result_id])) +
      '<div class="jg-mp-body"><div class="jg-mp-head">' + esc(head) + '</div><div class="jg-mp-dti">' + esc(dti) + '</div>' + (fat ? '<div class="jg-mp-sub">' + esc(fat) + '</div>' : '') +
      '<div class="jg-mp-date">' + esc(isNaN(d) ? '' : d.toLocaleDateString('ja-JP')) + '</div></div>' +
      '<div class="jg-mp-ops"><a class="mp-btn" href="/jagan/?saved=' + encodeURIComponent(row.result_id) + '">開く ›</a>' +
      '<button type="button" class="jg-mp-del" data-jagan-del="' + esc(row.result_id) + '">削除</button></div></li>';
  }

  function sectionHtml(inner) {
    return '<section class="mp-sec" id="jagan" aria-labelledby="mp-jagan-h">' +
      '<div class="mp-sec-head" id="mp-jagan-h"><span class="mp-sec-en">DELUSION DIAGNOSIS</span><span class="mp-sec-ja">邪眼診断（DTI）の記録</span></div>' +
      inner + '</section>';
  }

  var STYLE = '.jg-mp-list{list-style:none;padding:0;margin:0}.jg-mp-row{display:flex;justify-content:space-between;gap:12px;align-items:center;' +
    'border:1px solid rgba(165,42,67,.45);border-radius:12px;padding:12px 14px;margin:8px 0;background:rgba(22,13,20,.6)}' +
    '.jg-mp-body{flex:1;min-width:0}.jg-mp-emblem{flex:none;display:inline-flex;width:72px;height:72px}.jg-mp-emblem img{display:block;width:72px;height:72px;object-fit:contain;transform:translateZ(0)}' +
    '.jg-mp-head{font-size:17px}.jg-mp-dti{font-size:13px;letter-spacing:.08em;color:#E2C08C}.jg-mp-sub,.jg-mp-date{font-size:12px;opacity:.75}.jg-mp-ops{display:flex;flex-direction:column;gap:6px;align-items:flex-end}' +
    '.jg-mp-del{background:none;border:0;color:inherit;opacity:.7;text-decoration:underline;font:inherit;font-size:12px;cursor:pointer}' +
    '.jg-mp-note{font-size:13px;opacity:.8;margin:6px 0}';

  async function render(root) {
    if (!root || typeof supabaseClient === 'undefined' || supabaseClient.unavailable) return;
    // 本番では、邪眼診断の公開判断（DB の適用を含む）が済むまで表示しない（Preview の確認用）
    var cfg = window.__ED_PUBLIC_CONFIG__;
    if (!cfg || cfg.appEnv === 'production') return;
    if (!document.getElementById('jaganMpStyle')) {
      var st = document.createElement('style'); st.id = 'jaganMpStyle'; st.textContent = STYLE; document.head.appendChild(st);
    }
    var saved = await savePending();
    if (saved) lastOutcome = saved;
    var rows = null;
    try { rows = await loadRows(); } catch (e) { rows = null; }
    var awakened = rows && rows.length ? await loadAwakened() : {};
    var note = '';
    if (lastOutcome && lastOutcome.ok) note = '<p class="jg-mp-note" role="status">邪眼診断の結果を保存しました。</p>';
    else if (lastOutcome && !lastOutcome.ok) note = '<p class="jg-mp-note" role="alert">邪眼診断の結果を保存できませんでした' + (hasPending() ? '（このページを開き直すと再試行します）' : '') + '。</p>';
    var inner;
    if (rows === null) inner = note + '<p class="jg-mp-note">邪眼診断の記録を読み込めませんでした。</p>';
    else if (!rows.length) inner = note + '<p class="jg-mp-note">まだ保存した結果はありません。<a href="/jagan/">邪眼診断を受ける ›</a></p>';
    else inner = note + '<ul class="jg-mp-list">' + rows.map(function (r) { return rowHtml(r, awakened); }).join('') + '</ul><p class="jg-mp-note"><a href="/jagan/">邪眼診断をもう一度受ける ›</a></p>';
    var old = document.getElementById('jagan');
    if (old) old.remove();
    var acc = root.querySelector('[aria-labelledby="mp-acc-h"]');
    var wrap = document.createElement('div');
    wrap.innerHTML = sectionHtml(inner);
    var sec = wrap.firstChild;
    if (acc) acc.parentNode.insertBefore(sec, acc); else root.appendChild(sec);
    sec.addEventListener('click', onDelete);
    if (location.hash === '#jagan' || (lastOutcome && lastOutcome.ok && /from=jagan/.test(location.search))) sec.scrollIntoView({ block: 'start' });
  }

  async function onDelete(e) {
    var b = e.target.closest('[data-jagan-del]');
    if (!b) return;
    if (!window.confirm('この邪眼診断の結果を削除しますか？（元に戻せません。元素診断の記録には影響しません）')) return;
    b.disabled = true;
    var r = await supabaseClient.from('jagan_results').delete().eq('result_id', b.getAttribute('data-jagan-del'));
    if (r.error) { b.disabled = false; window.alert('削除できませんでした。'); return; }
    lastOutcome = null;
    var root = document.getElementById('root');
    render(root);
  }

  // ログイン画面（未ログイン）での案内
  function gateNote() {
    if (!hasPending()) return;
    var g = document.getElementById('gateMsg');
    if (g && !g.textContent) g.textContent = 'ログイン（または新規登録）すると、邪眼診断の結果をこのマイページに保存します。';
  }

  window.JaganMypage = { render: render, gateNote: gateNote, hasPending: hasPending };
})();
