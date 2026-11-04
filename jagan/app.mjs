// jagan/app.mjs — 邪眼診断の画面（TOP・質問・結果・保存・画像保存・X共有）。
//   採点は jagan/engine（仕様パッケージの runtime.mjs・math.mjs をそのまま使用）。サーバーも同じ版で再計算する。
//   ・回答は 1〜5 の5段階だけ（補助選択肢・スキップなし）。50問すべてに答えると結果へ進める。
//   ・この端末に残すもの（localStorage）：途中の回答、最後の結果（再表示用）、ログイン前の保存待ち、共有の取消用の値。
//     ETI の pending（pendingDiagnosis_v1・v2）とは別のキーにする。
//   ・GA4 へは操作の種類だけを送る（回答・12スコア・結果 ID・公開 ID は送らない）。
import { computeDiagnosis, publicSummary, makeShareText, shareTextFromSummary, RESULT_SCHEMA_VERSION } from './engine/runtime.mjs';
import { BUNDLE } from './engine/data.mjs';
import { renderResultPage, esc, heroGemsHtml } from './view.mjs';
import { cardDataUrl } from './card.mjs';

const ITEMS = BUNDLE.items;
const VERSION = ITEMS.item_set_version;
const ORDER = ITEMS.display_order;
const ITEM_BY_ID = Object.fromEntries(ITEMS.items.map((i) => [i.id, i]));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const K = { progress: 'jagan_progress_v1', last: 'jagan_last_v1', pending: 'jagan_pending_save_v1', shares: 'jagan_shares_v1' };
const PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000; // ETI v2 の保存待ちと同じ 24 時間

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(k); } catch { /* noop */ } },
};
function track(name, params) { try { if (typeof window.gtag === 'function') window.gtag('event', name, params || {}); } catch { /* 計測だけ */ } }
const newResultId = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

// ---- Supabase（ETI と同じ公開設定。本番ホストでは本番の設定だけを使う） ----
function supabaseClient() {
  if (supabaseClient.c !== undefined) return supabaseClient.c;
  const cfg = window.__ED_PUBLIC_CONFIG__;
  let c = null;
  try {
    const ok = cfg && /^[a-z0-9]{20}$/.test(cfg.projectRef || '') && cfg.supabaseUrl === `https://${cfg.projectRef}.supabase.co`
      && typeof cfg.supabaseAnonKey === 'string' && !cfg.supabaseAnonKey.startsWith('sb_secret_')
      && ((location.hostname === 'element-diagnosis-five.vercel.app') === (cfg.appEnv === 'production'));
    if (ok && window.supabase && typeof window.supabase.createClient === 'function') c = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey);
  } catch { c = null; }
  supabaseClient.c = c;
  return c;
}
async function accessToken() {
  const c = supabaseClient();
  if (!c) return null;
  try { const { data } = await c.auth.getSession(); return data && data.session ? data.session.access_token : null; } catch { return null; }
}

// ---- 画面 ----
function show(view) {
  document.querySelectorAll('[data-view]').forEach((el) => { el.hidden = el.id !== `view-${view}`; });
  window.scrollTo(0, 0);
}
function message(text) { $('messageText').textContent = text; show('message'); }

// ---- 回答の状態（途中の回答はこの端末に残す。版が違えば使わない） ----
// 元素診断と同じ形式：5問ずつのページ、1〜5の丸を押す。50問すべてに答えると結果へ進める。
// 同じ丸をもう一度押すと選択を外す（元素診断と同じ）。欠測（null）は画面からは作らない。
const PAGE = 5;
let state = null; // { resultId, answers, page, focus }
function loadProgress() {
  const p = store.get(K.progress);
  if (!p || p.v !== VERSION || !UUID_RE.test(p.resultId || '') || !p.answers || typeof p.answers !== 'object') return null;
  const answers = {};
  for (const [k, v] of Object.entries(p.answers)) if (ITEM_BY_ID[k] && Number.isInteger(v) && v >= 1 && v <= 5) answers[k] = v;
  const page = Math.max(0, Math.min(Math.floor((ORDER.length - 1) / PAGE) * PAGE, Number(p.page) || 0));
  return { resultId: p.resultId, answers, page: page - (page % PAGE), focus: null };
}
function saveProgress() { if (state) store.set(K.progress, { v: VERSION, resultId: state.resultId, answers: state.answers, page: state.page }); }
const answeredCount = (a) => ORDER.filter((id) => Number.isInteger(a[id])).length;
const firstUnanswered = () => ORDER.find((id) => !Number.isInteger(state.answers[id]));
const pad2 = (n) => String(n).padStart(2, '0');

// ---- 質問 ----
let prevFocus = null;
let popId = null; // 押した丸を「ポワン」と光らせる
function renderQuiz() {
  const ids = ORDER.slice(state.page, state.page + PAGE);
  if (!state.focus || !ids.includes(state.focus)) state.focus = ids.find((id) => !Number.isInteger(state.answers[id])) || ids[0];
  const n = answeredCount(state.answers);
  const all = n === ORDER.length;
  const last = state.page + PAGE >= ORDER.length;
  const moved = prevFocus !== null && prevFocus !== state.focus && ids.includes(prevFocus);
  const opt = ITEMS.options;
  $('quizRoot').innerHTML = `
    <div class="qz-prog">
      <div class="qz-prog-top"><span class="qz-range">Q${pad2(state.page + 1)}—${pad2(Math.min(state.page + PAGE, ORDER.length))} <span class="of">/ ${ORDER.length}</span></span><span class="qz-count">回答済 <b>${n}</b></span></div>
      <div class="qz-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${ORDER.length}" aria-valuenow="${n}"><i style="width:${(n / ORDER.length) * 100}%"></i></div>
    </div>
    ${ids.map((id, i) => {
      const cur = state.answers[id];
      const st = id === state.focus ? 'is-active' : (Number.isInteger(cur) ? 'is-done' : 'is-next');
      const mo = moved ? (id === state.focus ? ' is-arriving' : (id === prevFocus && Number.isInteger(cur) ? ' is-settling' : '')) : '';
      return `<div class="qz-card ${st}${mo}" data-qid="${id}">
        <div class="qz-no">Q${state.page + i + 1}</div>
        <p class="qz-text">${esc(ITEM_BY_ID[id].text)}</p>
        <div class="qz-scale" role="radiogroup" aria-label="Q${state.page + i + 1}の回答">
          ${opt.map((o) => `<button type="button" data-v="${o.value}" role="radio" aria-label="${esc(o.label)}" aria-checked="${cur === o.value}" class="qz-dot${cur === o.value ? ' is-on' : ''}${cur === o.value && popId === id ? ' is-pop' : ''}">${o.value}</button>`).join('')}
        </div>
        <div class="qz-labels"><span>${esc(opt[0].label)}</span><span>${esc(opt[opt.length - 1].label)}</span></div>
      </div>`;
    }).join('')}
    <div class="qz-pager">
      <button type="button" id="qPrev" ${state.page === 0 ? 'disabled' : ''}>← 前の5問</button>
      ${last ? '<span></span>' : '<button type="button" id="qNext">次の5問 →</button>'}
    </div>
    ${all ? '<button type="button" class="qz-result" id="qResult">結果を見る →</button>' : ''}
    ${!all && last ? '<button type="button" class="qz-jump" id="qJump">未回答の設問へ →</button>' : ''}`;
  popId = null;
  if (moved) {
    const card = $('quizRoot').querySelector('.qz-card.is-active');
    if (card) requestAnimationFrame(() => {
      const r = card.getBoundingClientRect(), vh = window.innerHeight;
      if (r.top >= 12 && r.bottom <= vh - 12) return;
      const dy = r.top < 12 ? r.top - 16 : Math.min(r.bottom - vh + 24, r.top - 72);
      if (Math.abs(dy) >= 8) window.scrollBy({ top: dy, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  }
  prevFocus = state.focus;
}
function gotoPage(page) { state.page = page; state.focus = null; prevFocus = null; saveProgress(); renderQuiz(); window.scrollTo({ top: 0 }); }
let pageLock = false; // ページ送りの直後の連打で次のページの設問に答えない
function choose(id, v) {
  if (pageLock) return;
  const wasFocused = id === state.focus;
  if (state.answers[id] === v) { delete state.answers[id]; state.focus = id; saveProgress(); renderQuiz(); return; } // 選択を外す
  state.answers[id] = v;
  popId = id;
  state.focus = id;
  const ids = ORDER.slice(state.page, state.page + PAGE);
  if (wasFocused) {
    const after = ids.slice(ids.indexOf(id) + 1).find((x) => !Number.isInteger(state.answers[x]));
    if (after) state.focus = after;
  }
  saveProgress();
  const pageDone = ids.every((x) => Number.isInteger(state.answers[x]));
  const last = state.page + PAGE >= ORDER.length;
  renderQuiz();
  if (pageDone && !last) {
    pageLock = true;
    setTimeout(() => { pageLock = false; if (state && ORDER.slice(state.page, state.page + PAGE).every((x) => Number.isInteger(state.answers[x]))) gotoPage(state.page + PAGE); }, 320);
  }
}
function startQuiz(resume) {
  state = resume || { resultId: newResultId(), answers: {}, page: 0, focus: null };
  prevFocus = null;
  saveProgress();
  if (!resume) track('jagan_start', {});
  show('quiz'); renderQuiz();
}
function finish() {
  if (answeredCount(state.answers) !== ORDER.length) return;
  const answers = {};
  for (const id of ORDER) answers[id] = state.answers[id];
  const last = { v: VERSION, resultId: state.resultId, answers, completedAt: new Date().toISOString() };
  store.set(K.last, last);
  store.del(K.progress);
  track('jagan_complete', {});
  showResult(last, { mode: 'fresh' });
  try { history.replaceState(null, '', '/jagan/#result'); } catch { /* noop */ }
}

// ---- 結果 ----
let current = null; // { result, answers, mode }
function showResult(record, { mode, savedAt } = {}) {
  let result;
  if (mode === 'saved') result = record.snapshot;
  else {
    try { result = computeDiagnosis({ answers: record.answers, resultId: record.resultId, itemSetVersion: VERSION }, BUNDLE); }
    catch (e) { message('結果を表示できませんでした。もう一度診断してください。'); return; }
  }
  current = { result, answers: mode === 'saved' ? result.answers : record.answers, mode };
  $('resultBody').innerHTML = renderResultPage(result, BUNDLE);
  bindResult();
  const banner = $('savedBanner');
  banner.hidden = mode !== 'saved';
  if (mode === 'saved') banner.textContent = `マイページに保存した結果です（${new Date(savedAt).toLocaleString('ja-JP')}・保存時の版 ${result.versions.interpretation}）。`;
  const shareable = summaryOf(result) !== null;
  $('imageBtn').disabled = !shareable;
  $('shareBtn').disabled = !shareable;
  $('pendingFix').hidden = true;
  setStatus(shareable ? '' : 'この結果は画像保存・共有できません。');
  const saveBtn = $('saveBtn');
  if (mode === 'saved') { saveBtn.textContent = '✓ 保存済み'; saveBtn.disabled = true; }
  else if (store.get(K.pending) && store.get(K.pending).resultId === result.resultId) { saveBtn.textContent = 'マイページに保存する（ログイン待ち）'; saveBtn.disabled = false; }
  else { saveBtn.textContent = 'マイページに保存する'; saveBtn.disabled = false; }
  show('result');
}
function summaryOf(result) { try { return publicSummary(result); } catch { return null; } }
function setStatus(text, isError) { const s = $('actionStatus'); s.textContent = text || ''; s.classList.toggle('is-error', !!isError); }

// 保存：ログイン中ならサーバーへ（サーバーが再計算して保存）。未ログインなら保存待ちを残してマイページでログイン
let saving = false;
async function save() {
  if (!current || current.mode === 'saved' || saving) return;
  track('jagan_save_click', {});
  const r = current.result;
  const payload = { resultId: r.resultId, itemSetVersion: r.versions.itemSet, answers: current.answers };
  const btn = $('saveBtn');
  const token = await accessToken();
  if (!token) {
    if (!supabaseClient()) { setStatus('ログイン・保存は現在ご利用いただけません。', true); return; }
    store.set(K.pending, { ...payload, at: Date.now() });
    // ETI の「保存後に結果ページへ戻る」印が残っていると、マイページから ETI の結果へ移るため消す
    try { localStorage.removeItem('ed_save_return_v1'); } catch { /* noop */ }
    setStatus('マイページでログインすると、この結果を保存します。');
    location.href = '/mypage?from=jagan';
    return;
  }
  saving = true; btn.disabled = true; btn.textContent = '保存中…'; setStatus('');
  try {
    const res = await fetch('/api/jagan-save', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(payload) });
    const out = await res.json().catch(() => ({}));
    if (res.ok && out.ok) {
      store.del(K.pending);
      btn.textContent = '✓ 保存しました';
      $('actionStatus').innerHTML = 'マイページに保存しました。<a href="/mypage#jagan">マイページで見る ›</a>';
      track('jagan_save_success', {});
      return;
    }
    if (res.status === 403 && out.error === 'registration_required') {
      store.set(K.pending, { ...payload, at: Date.now() });
      $('actionStatus').innerHTML = '保存の前に、マイページで登録（利用規約への同意）を完了してください。完了すると自動で保存します。<a href="/mypage?from=jagan">マイページへ ›</a>';
      btn.disabled = false; btn.textContent = 'マイページに保存する';
      return;
    }
    const why = res.status === 503 ? '保存は現在ご利用いただけません（準備中）。' : res.status === 409 ? 'この結果は保存できません（別のアカウントで保存済みです）。' : '保存に失敗しました。';
    setStatus(`${why}もう一度押すと再試行します。`, true);
    btn.disabled = false; btn.textContent = 'マイページに保存する（再試行）';
  } catch {
    setStatus('通信に失敗しました。もう一度押すと再試行します。', true);
    btn.disabled = false; btn.textContent = 'マイページに保存する（再試行）';
  } finally { saving = false; }
}

// 画像保存：押したときに描く（生成中・失敗でも他の操作は止めない）
let imaging = false;
async function saveImage() {
  if (!current || imaging) return;
  const s = summaryOf(current.result);
  if (!s) return;
  imaging = true;
  track('jagan_image_save', {});
  try {
    // 元素診断と同じ：その場に画像を表示し、長押し（PCは右クリック）で保存してもらう
    const url = cardDataUrl(s);
    let overlay = $('saveImgOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'saveImgOverlay';
      overlay.className = 'jg-img-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-label', '結果の画像');
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<p>画像を長押しして「写真に保存」を選んでください<br><small>パソコンでは右クリックで保存できます</small></p>
      <img src="${url}" alt="邪眼診断の結果画像">
      <button type="button" id="closeImgOverlay">閉じる</button>`;
    overlay.hidden = false;
    $('closeImgOverlay').onclick = () => { overlay.hidden = true; };
  } catch {
    setStatus('画像を作成できませんでした。もう一度押すと再試行します。', true);
  } finally { imaging = false; }
}

// X共有：本人の操作で共有ページを作り、内容を確認してから X の投稿画面を開く（自動投稿しない）
let sharing = false;
let currentShare = null;
async function share() {
  if (!current || sharing) return;
  const r = current.result;
  track('jagan_share_click', {});
  const known = (store.get(K.shares) || {})[r.resultId];
  sharing = true; const shareLabel = $('shareBtn').innerHTML; $('shareBtn').textContent = '共有ページを作成中…';
  try {
    let publicId = known && known.publicId;
    if (!publicId) {
      const token = await accessToken();
      const res = await fetch('/api/jagan-share', { method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ resultId: r.resultId, itemSetVersion: r.versions.itemSet, answers: current.answers }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok || !out.publicId) {
        setStatus(res.status === 503 ? '共有は現在ご利用いただけません（準備中）。' : '共有ページを作成できませんでした。もう一度押すと再試行します。', true);
        return;
      }
      publicId = out.publicId;
      const all = store.get(K.shares) || {};
      all[r.resultId] = { publicId, revokeToken: out.revokeToken || (known && known.revokeToken) || null };
      store.set(K.shares, all);
    }
    const url = `${location.origin}/jagan/s/${publicId}`;
    let text;
    try { text = makeShareText(r, url, `${location.origin}/`); } catch { text = shareTextFromSummary(publicSummary(r), url); }
    currentShare = { publicId, url, resultId: r.resultId };
    $('shareText').textContent = text;
    $('shareOpenX').href = `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
    $('shareStatus').textContent = '';
    $('shareDialog').showModal();
  } catch {
    setStatus('通信に失敗しました。もう一度押すと再試行します。', true);
  } finally { sharing = false; $('shareBtn').innerHTML = shareLabel; }
}
async function revokeShare() {
  if (!currentShare) return;
  const all = store.get(K.shares) || {};
  const rec = all[currentShare.resultId] || {};
  const token = await accessToken();
  try {
    const res = await fetch('/api/jagan-share', { method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ publicId: currentShare.publicId, revokeToken: rec.revokeToken || undefined }) });
    if (res.ok) {
      delete all[currentShare.resultId]; store.set(K.shares, all);
      $('shareStatus').textContent = '共有を取り消しました。このURLでは結果が表示されなくなります。';
      currentShare = null;
    } else {
      $('shareStatus').textContent = res.status === 403 ? 'この端末からは取り消せません（共有を作成した端末・アカウントで操作してください）。' : '取り消しに失敗しました。';
    }
  } catch { $('shareStatus').textContent = '通信に失敗しました。'; }
}

// ---- 保存した結果の再表示（/jagan/?saved=<結果ID>。本人の行だけ RLS で読める） ----
async function openSaved(resultId) {
  const c = supabaseClient();
  if (!c) { message('ログイン・保存は現在ご利用いただけません。'); return; }
  const token = await accessToken();
  if (!token) { message('保存した結果を見るには、マイページでログインしてください。'); return; }
  try {
    const { data, error } = await c.from('jagan_results').select('result_id,snapshot,created_at').eq('result_id', resultId).maybeSingle();
    if (error || !data) { message('保存した結果が見つかりませんでした（削除された、または別のアカウントの結果です）。'); return; }
    // 保存時の判定のまま表示する。旧版の記録は今回の判定へ読み替えない（再判定しない）
    if (!data.snapshot || data.snapshot.schemaVersion !== RESULT_SCHEMA_VERSION) {
      const h = data.snapshot || {};
      message(`この記録は旧版の判定（${h.schemaVersion || '版不明'}）で保存されています。現在の邪眼診断（DTI）とは判定の方法が異なるため、ここでは表示しません。新しく診断すると、DTIの結果として残せます。`);
      return;
    }
    showResult({ snapshot: data.snapshot }, { mode: 'saved', savedAt: data.created_at });
  } catch { message('読み込みに失敗しました。時間をおいて再度お試しください。'); }
}

// 結果ページの操作（結果を描くたびに結び直す）
function bindResult() {
  $('saveBtn').addEventListener('click', save);
  $('imageBtn').addEventListener('click', saveImage);
  $('shareBtn').addEventListener('click', share);
  document.querySelectorAll('#resultBody [data-buy]').forEach((b) => b.addEventListener('click', () => track('jagan_report_cta', { state: 'closed' })));
  $('fixAnswersBtn').addEventListener('click', () => {
    if (!current || current.mode !== 'fresh') return;
    const answers = {};
    for (const [k, v] of Object.entries(current.answers)) if (Number.isInteger(v)) answers[k] = v;
    state = { resultId: current.result.resultId, answers, page: 0, focus: null };
    const id = firstUnanswered(); if (id) { const i = ORDER.indexOf(id); state.page = i - (i % PAGE); }
    saveProgress(); show('quiz'); renderQuiz();
  });
  document.querySelectorAll('#resultBody .rx-more').forEach((d) => d.addEventListener('toggle', () => { if (d.open) track('jagan_detail_open', {}); }));
}

// ---- 起動 ----
function wire() {
  document.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', () => startQuiz(null)));
  document.querySelectorAll('[data-track]').forEach((a) => a.addEventListener('click', () => track(a.dataset.track, {})));
  $('resumeBtn').addEventListener('click', () => { const p = loadProgress(); if (p) startQuiz(p); });
  $('lastResultBtn').addEventListener('click', (e) => {
    const l = store.get(K.last);
    if (l && l.v === VERSION && UUID_RE.test(l.resultId || '')) { e.preventDefault(); showResult(l, { mode: 'fresh' }); history.replaceState(null, '', '/jagan/#result'); }
    // この端末に前回の結果が無いときは、リンク先（マイページの邪眼診断の記録）へ進む
  });
  $('quizRoot').addEventListener('click', (e) => {
    const dot = e.target.closest('.qz-dot');
    const card = e.target.closest('.qz-card');
    if (dot && card) { choose(card.dataset.qid, Number(dot.dataset.v)); return; }
    if (card && card.dataset.qid !== state.focus) { state.focus = card.dataset.qid; renderQuiz(); return; }
    if (e.target.id === 'qPrev' && state.page > 0) gotoPage(state.page - PAGE);
    else if (e.target.id === 'qNext') gotoPage(state.page + PAGE);
    else if (e.target.id === 'qResult') finish();
    else if (e.target.id === 'qJump') { const id = firstUnanswered(); if (id) { const i = ORDER.indexOf(id); gotoPage(i - (i % PAGE)); state.focus = id; renderQuiz(); } }
  });
  $('shareCopy').addEventListener('click', async () => {
    if (!currentShare) return;
    try { await navigator.clipboard.writeText(currentShare.url); $('shareStatus').textContent = 'URLをコピーしました。'; } catch { $('shareStatus').textContent = currentShare.url; }
  });
  $('shareRevoke').addEventListener('click', revokeShare);
  $('shareClose').addEventListener('click', () => $('shareDialog').close());
  $('shareOpenX').addEventListener('click', () => track('jagan_share_open_x', {}));
  $('retryBtn').addEventListener('click', () => { store.del(K.progress); history.replaceState(null, '', '/jagan/'); startQuiz(null); });
  document.addEventListener('keydown', (e) => {
    if ($('view-quiz').hidden || !state || e.target.closest('input,textarea')) return;
    if (/^[1-5]$/.test(e.key) && state.focus) choose(state.focus, Number(e.key));
  });
}

function boot() {
  wire();
  try { $('heroGems').innerHTML = heroGemsHtml(); } catch { /* 装飾だけ */ }
  document.querySelectorAll('[data-operator]').forEach((b) => b.addEventListener('click', () => $('operatorDialog').showModal()));
  document.querySelectorAll('[data-operator-close]').forEach((b) => b.addEventListener('click', () => $('operatorDialog').close()));
  const params = new URLSearchParams(location.search);
  const saved = params.get('saved');
  if (saved && UUID_RE.test(saved)) { openSaved(saved); return; }
  const last = store.get(K.last);
  const validLast = last && last.v === VERSION && UUID_RE.test(last.resultId || '') ? last : null;
  if (location.hash === '#result' && validLast) { showResult(validLast, { mode: 'fresh' }); return; }
  const p = loadProgress();
  $('resumeBtn').hidden = !(p && answeredCount(p.answers) > 0);

  show('top');
}
boot();
